/*
 * schematic.js — 原理图编辑器 + 网表提取 + 布线诊断
 * ==================================================================
 * 需求对应：
 *   · "引脚要严格准确"   → 每个元件引脚按真实封装定义（详见 circuit.js 的
 *                          DEVICE_DEFS，MCU 为 DIP-40 物理引脚号）
 *   · "不能出现线与线交叉" → 正交布线 + 候选路径搜索：
 *                          对每条新导线枚举 L 形 / Z 形（中段可在多个轨道偏移上
 *                          搜索）共 2 + 2×N 条候选路径，按"与既有导线交叉数"
 *                          排序，优先选择零交叉路径；无零交叉解时报告并高亮。
 *   · "不能移动"          → 导线一经生成即为独立实体（含顶点序列），
 *                          仅可通过拖动顶点显式修改；元件移动时导线端点重新
 *                          绑定到引脚，不会错位。
 *   · 智能诊断            → 规则引擎（Diagnostics）覆盖 20+ 条常见接线错误
 *
 * 渲染：SVG（矢量、可缩放、可导出）
 */

import { DEVICE_DEFS, CATEGORIES, Netlist, CircuitSim } from '../core/circuit.js';

export const GRID = 12;                 // 1 格 = 12px
const g2p = (g) => g * GRID;

let _idSeq = 1;
export const newId = (prefix = 'c') => `${prefix}${(_idSeq++).toString(36)}${Date.now().toString(36).slice(-4)}`;

/* ================================================================ 元件实例 */
export class Part {
  constructor(type, x, y) {
    const def = DEVICE_DEFS[type];
    if (!def) throw new Error('未知元件类型: ' + type);
    this.id = newId(def.isMcu ? 'u' : 'x');
    this.type = type;
    this.x = x; this.y = y;              // 原点格坐标
    this.rot = 0;                        // 0/90/180/270
    this.mirror = false;
    this.props = { ...(def.props || {}) };
    this.label = def.label;
    this.pins = def.pins;
    this.netNames = {};
  }
  get def() { return DEVICE_DEFS[this.type]; }
  get w() { return this.rot % 180 === 0 ? this.def.w : this.def.h; }
  get h() { return this.rot % 180 === 0 ? this.def.h : this.def.w; }
  /** 引脚在画布上的格坐标（含旋转/镜像） */
  pinGrid(i) {
    const p = this.def.pins[i];
    let dx = p.dx, dy = p.dy;
    const W = this.def.w, H = this.def.h;
    if (this.mirror) dx = W - dx;
    for (let r = 0; r < (this.rot / 90); r++) { const t = dx; dx = H - dy; dy = t; }
    return { x: this.x + dx, y: this.y + dy, side: p.side, name: p.name, num: p.num };
  }
  pinPx(i) { const g = this.pinGrid(i); return { x: g2p(g.x), y: g2p(g.y), name: g.name, num: g.num }; }
  /** 元件占据的格矩形 */
  bbox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  overlaps(other) {
    const a = this.bbox(), b = other.bbox();
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
}

/* ================================================================ 导线 */
export class Wire {
  constructor(vertices, color) {
    // vertices: [{comp, pin, x, y}]  —— 首尾必须落在元件引脚上
    this.id = 'w' + (_idSeq++).toString(36);
    this.vertices = vertices;
    this.color = color || '#1a7f37';
    this.bus = false;
  }
  get a() { return this.vertices[0]; }
  get b() { return this.vertices[this.vertices.length - 1]; }
  segments() {
    const out = [];
    for (let i = 0; i + 1 < this.vertices.length; i++) {
      out.push({ x1: this.vertices[i].x, y1: this.vertices[i].y, x2: this.vertices[i + 1].x, y2: this.vertices[i + 1].y });
    }
    return out;
  }
  length() {
    let L = 0;
    for (const s of this.segments()) L += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    return L;
  }
}

/* ---------------------------------------------------------------- 几何工具 */
function horiz(s) { return s.y1 === s.y2; }
function overlapRange(a1, a2, b1, b2) { return Math.max(Math.min(a1, a2), Math.min(b1, b2)) < Math.min(Math.max(a1, a2), Math.max(b1, b2)); }
/** 两条轴对齐线段是否真正相交（共线重叠算相交；仅在端点相触不算） */
export function segsCross(s1, s2) {
  const h1 = horiz(s1), h2 = horiz(s2);
  if (h1 && h2) {
    if (s1.y1 !== s2.y1) return false;
    return overlapRange(s1.x1, s1.x2, s2.x1, s2.x2);
  }
  if (!h1 && !h2) {
    if (s1.x1 !== s2.x1) return false;
    return overlapRange(s1.y1, s1.y2, s2.y1, s2.y2);
  }
  const hs = h1 ? s1 : s2, vs = h1 ? s2 : s1;
  const hy = hs.y1, vx = vs.x1;
  const hx1 = Math.min(hs.x1, hs.x2), hx2 = Math.max(hs.x1, hs.x2);
  const vy1 = Math.min(vs.y1, vs.y2), vy2 = Math.max(vs.y1, vs.y2);
  return vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2;
}

/* ================================================================ 编辑器 */
export class Schematic {
  constructor(opts = {}) {
    this.parts = [];
    this.wires = [];
    this.netlist = new Netlist();
    this.sel = new Set();
    this.tool = 'select';           // select | wire | delete | pan
    this.hoverPin = null;
    this.pendingWire = null;        // 布线中的起点
    this.wirePreview = null;
    this.onChange = opts.onChange || (() => { });
    this.onStatus = opts.onStatus || (() => { });
    this.lastRouteReport = null;
    this.showGrid = true;
    this.gridSize = 1;              // 元件对齐到 1 格；引脚本身在 0.5 格网格上
    this.vccNetName = 'VCC';
    this.gndNetName = 'GND';
  }

  /* ---------------------------------------------------- 增删改 */
  addPart(type, x, y, { snap = true, checkOverlap = true } = {}) {
    const part = new Part(type, x, y);
    if (snap) { part.x = Math.round(part.x); part.y = Math.round(part.y); }
    if (checkOverlap) {
      const clash = this.parts.find(p => p.overlaps(part));
      if (clash) { this.onStatus(`放置失败：与 ${clash.label} 重叠（原理图中元件不可重叠）`, 'warn'); return null; }
    }
    this.parts.push(part);
    this.refresh(); this.changed();
    return part;
  }
  removeParts(ids) {
    const set = new Set(ids);
    this.wires = this.wires.filter(w => !w.vertices.some(v => set.has(v.comp)));
    this.parts = this.parts.filter(p => !set.has(p.id));
    for (const id of ids) this.sel.delete(id);
    this.refresh(); this.changed();
  }
  moveParts(ids, dx, dy) {
    const set = new Set(ids);
    const parts = this.parts.filter(p => set.has(p.id));
    // 边界与重叠保护
    for (const p of parts) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0) return;
      const test = new Part(p.type, nx, ny); test.rot = p.rot; test.mirror = p.mirror;
      if (this.parts.some(q => !set.has(q.id) && q.overlaps(test))) { this.onStatus('移动失败：与其它元件重叠', 'warn'); return; }
    }
    for (const p of parts) { p.x += dx; p.y += dy; }
    this.rebindWireEndpoints(set);
    this.refresh(); this.changed();
  }
  rotateParts(ids) {
    const set = new Set(ids);
    for (const p of this.parts) if (set.has(p.id) && !p.def.isMcu) p.rot = (p.rot + 90) % 360;
    this.refresh(); this.changed();
  }
  /** 元件移动后把导线端点重新吸附到引脚（保证"引脚严格准确"） */
  /**
   * 元件移动/旋转后，把所有"绑在该元件引脚上"的导线端点重新吸附到新位置。
   *
   * 修复要点：
   *  1) 参数既可能是 Set 也可能是数组（拖动传数组、旋转传 Set），
   *     旧代码直接 .has() —— 数组没有这个方法是会抛异常的，
   *     结果就是"画布上一有导线，拖动元件就整个中断"，表现成导线不跟随。
   *  2) 正交化时不能动"已绑在引脚上"的端点，否则会把导线从引脚上拽走。
   */
  rebindWireEndpoints(movedIds) {
    const ids = movedIds instanceof Set ? movedIds : new Set(movedIds || []);
    for (const w of this.wires) {
      for (const v of w.vertices) {
        if (v.comp && ids.has(v.comp)) {
          const part = this.parts.find(p => p.id === v.comp);
          if (!part) continue;
          const pp = part.pinGrid(v.pin);
          v.x = pp.x; v.y = pp.y;
        }
      }
      /*
       * 两端都绑在引脚上、但两个引脚不在同一行/列时，既不能挪端点（会脱离引脚），
       * 也不该画成斜线。办法是维护一个"自动拐点"：先横后竖，
       * 并在每次重绑时把拐点同步到最新坐标，于是导线始终横平竖直且两端咬住引脚。
       * 用户手动拖过这个拐点（auto 置 false）之后就不再自动调整，交还给人。
       */
      const last = w.vertices.length - 1;
      const a0 = w.vertices[0], b0 = w.vertices[last];
      if (a0 && b0 && a0.comp && b0.comp && a0.x !== b0.x && a0.y !== b0.y) {
        if (w.vertices.length === 2) {
          w.vertices.splice(1, 0, { x: b0.x, y: a0.y, auto: true });
        } else if (w.vertices[1] && w.vertices[1].auto) {
          w.vertices[1].x = b0.x; w.vertices[1].y = a0.y;
        }
      }

      // 其余相邻段：只修正"有自由端"的，两端都绑死的段落不动
      for (let i = 0; i + 1 < w.vertices.length; i++) {
        const a = w.vertices[i], b = w.vertices[i + 1];
        if (a.x === b.x || a.y === b.y) continue;
        if (!b.comp) b.y = a.y;
        else if (!a.comp) a.y = b.y;
      }
    }
  }

  /* ---------------------------------------------------- 布线 */
  /**
   * 生成从 (ax,ay) 到 (bx,by) 的正交候选路径。
   * 候选：2 条 L 形 + 4 组 Z 形（中段轨道在 ±k 格上搜索）
   */
  candidatePaths(a, b, tracks = [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
    const out = [];
    // L 形：先横后竖 / 先竖后横
    out.push([a, { x: b.x, y: a.y }, b]);
    out.push([a, { x: a.x, y: b.y }, b]);
    // Z 形：竖直中段位于 x = mid + t
    const midX = Math.round((a.x + b.x) / 2);
    for (const t of tracks) out.push([a, { x: midX + t, y: a.y }, { x: midX + t, y: b.y }, b]);
    // Z 形：水平中段位于 y = mid + t
    const midY = Math.round((a.y + b.y) / 2);
    for (const t of tracks) out.push([a, { x: a.x, y: midY + t }, { x: b.x, y: midY + t }, b]);
    return out;
  }
  /** 去重并规范化为正交折线 */
  normalizePath(pts) {
    const p = [];
    for (const q of pts) {
      if (!p.length || p[p.length - 1].x !== q.x || p[p.length - 1].y !== q.y) p.push({ x: q.x, y: q.y });
    }
    // 去掉共线中间点
    const out = [];
    for (let i = 0; i < p.length; i++) {
      if (i > 0 && i < p.length - 1) {
        const a = p[i - 1], b = p[i], c = p[i + 1];
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
      }
      out.push(p[i]);
    }
    // 强制正交
    for (let i = 0; i + 1 < out.length; i++) {
      if (out[i].x !== out[i + 1].x && out[i].y !== out[i + 1].y) out[i + 1].x = out[i].x;
    }
    return out;
  }
  /**
   * 选择与既有导线交叉最少的路径。
   * 返回 { path, crossings, candidates }
   */
  routePath(a, b, excludeWireIds = []) {
    const exists = this.wires.filter(w => !excludeWireIds.includes(w.id)).flatMap(w => w.segments());
    let best = null;
    for (const cand of this.candidatePaths(a, b)) {
      const path = this.normalizePath(cand);
      const segs = [];
      for (let i = 0; i + 1 < path.length; i++) segs.push({ x1: path[i].x, y1: path[i].y, x2: path[i + 1].x, y2: path[i + 1].y });
      let cross = 0;
      for (const s of segs) for (const e of exists) if (segsCross(s, e)) cross++;
      // 长度作为次级代价，避免绕远
      let len = 0; for (const s of segs) len += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
      const active = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const detour = len - active;
      const score = cross * 1000 + detour;
      if (!best || score < best.score) best = { path, segs, crossings: cross, detour, score };
    }
    return best;
  }
  /** 连接两个引脚；返回导线或 null */
  connectPin(from, to) {
    const A = { comp: from.comp, pin: from.pin, x: from.gx, y: from.gy };
    const B = { comp: to.comp, pin: to.pin, x: to.gx, y: to.gy };
    if (from.comp === to.comp && from.pin === to.pin) { this.onStatus('不能把引脚连到自身', 'warn'); return null; }
    // 已连接则忽略
    const dup = this.wires.find(w => (w.a.comp === A.comp && w.a.pin === A.pin && w.b.comp === B.comp && w.b.pin === B.pin)
      || (w.a.comp === B.comp && w.a.pin === B.pin && w.b.comp === A.comp && w.b.pin === A.pin));
    if (dup) { this.onStatus('这两个引脚已存在直连导线', 'warn'); return null; }
    const r = this.routePath(A, B);
    const verts = r.path.map((p, i) => i === 0 ? A : (i === r.path.length - 1 ? B : { x: p.x, y: p.y }));
    const wire = new Wire(verts);
    wire.crossings = r.crossings;
    this.wires.push(wire);
    this.refresh(); this.changed();
    if (r.crossings > 0) {
      this.onStatus(`已连接，但有 ${r.crossings} 处与既有导线交叉（无零交叉路径可达）。建议移动元件或改用其它引脚。`, 'warn');
    } else {
      this.onStatus('已连接（自动布线：无交叉）', 'ok');
    }
    return wire;
  }

  /* ---------------------------------------------------- 网表 */
  refresh() {
    this.netlist.build(this.parts, this.wires);
    this.assignNetNames();
    this.diagnostics = Diagnostics.run(this);
  }
  assignNetNames() {
    let vccNet = -1, gndNet = -1;
    for (const n of this.netlist.nets) {
      if (n.hasVcc && vccNet < 0) vccNet = n.index;
      if (n.hasGnd && gndNet < 0) gndNet = n.index;
    }
    this.vccNet = vccNet; this.gndNet = gndNet;
    for (const p of this.parts) p.netNames = {};
    for (const c of this.parts) {
      const def = DEVICE_DEFS[c.type];
      for (let i = 0; i < def.pins.length; i++) {
        const nIdx = this.netlist.netOf(this.netlist.pinNet, c.id, i);
        if (nIdx === undefined) continue;
        c.netNames[def.pins[i].name] = this.netLabel(nIdx);
      }
    }
  }
  netLabel(idx) {
    if (idx === undefined) return '-';
    if (idx === this.vccNet) return this.vccNetName;
    if (idx === this.gndNet) return this.gndNetName;
    // 以第一个 MCU 端口引脚命名
    const n = this.netlist.nets[idx];
    if (!n) return 'N' + idx;
    for (const m of n.members) {
      const mm = (m.name || '').match(/^P([0-4])\.([0-7])$/);
      if (mm) return m.name;
    }
    return 'N' + idx;
  }
  /** 某网络的所有成员 */
  netMembers(idx) { return idx === undefined ? [] : (this.netlist.nets[idx]?.members || []); }

  pinAt(gx, gy) {
    for (const p of this.parts) {
      const def = p.def;
      for (let i = 0; i < def.pins.length; i++) {
        const g = p.pinGrid(i);
        if (g.x === gx && g.y === gy) return { comp: p.id, pin: i, gx, gy, name: g.name };
      }
    }
    return null;
  }
  partAt(gx, gy) {
    return this.parts.find(p => { const b = p.bbox(); return gx >= b.x && gx < b.x + b.w && gy >= b.y && gy < b.y + b.h; }) || null;
  }

  changed() { this.onChange(this); }

  /* ---------------------------------------------------- 序列化 */
  toJSON() {
    return {
      version: 2,
      parts: this.parts.map(p => ({ id: p.id, type: p.type, x: p.x, y: p.y, rot: p.rot, mirror: p.mirror, props: p.props })),
      wires: this.wires.map(w => ({ id: w.id, color: w.color, vertices: w.vertices }))
    };
  }
  loadJSON(j) {
    this.parts = []; this.wires = []; this.sel.clear();
    for (const q of j.parts || []) {
      const p = new Part(q.type, q.x, q.y);
      p.id = q.id; p.rot = q.rot || 0; p.mirror = !!q.mirror;
      Object.assign(p.props, q.props || {});
      this.parts.push(p);
    }
    for (const q of j.wires || []) {
      const w = new Wire(q.vertices, q.color); w.id = q.id;
      this.wires.push(w);
    }
    this.refresh(); this.changed();
  }

  /* ---------------------------------------------------- 自动布局模板 */
  static preset(name) { return PRESETS[name] ? PRESETS[name]() : null; }
}

/* ================================================================ 诊断规则引擎
 * 覆盖常见接线错误。每条规则返回 {level, msg, targets[]}。
 */
export const Diagnostics = {
  run(sch) {
    const issues = [];
    const mcu = sch.parts.find(p => p.def.isMcu);
    const add = (level, code, msg, targets = []) => issues.push({ level, code, msg, targets });

    if (!mcu) { add('error', 'NO_MCU', '原理图中没有单片机。请先从"单片机"分类中放置 STC89C52。'); return issues; }
    const idxOf = (nm) => mcu.def.pins.findIndex(p => p.name === nm);
    const netOfPin = (nm) => { const i = idxOf(nm); return i < 0 ? undefined : sch.netlist.netOf(sch.netlist.pinNet, mcu.id, i); };
    const labelOf = (nm) => sch.netLabel(netOfPin(nm));
    const isPower = (nm) => netOfPin(nm) === sch.vccNet;
    const isGround = (nm) => netOfPin(nm) === sch.gndNet;

    // 1. 电源
    const vccNet = netOfPin('VCC'), gndNet = netOfPin('GND');
    if (vccNet === undefined || vccNet !== sch.vccNet) add('error', 'NO_VCC', '单片机 VCC（第 40 脚）未连接到电源。请放置 VCC 符号并连线。', [mcu.id]);
    if (gndNet === undefined || gndNet !== sch.gndNet) add('error', 'NO_GND', '单片机 GND（第 20 脚）未接地。所有电路必须共地，否则电平无参考。', [mcu.id]);
    // VCC 与 GND 短路
    for (const n of sch.netlist.nets) if (n.hasVcc && n.hasGnd) add('fatal', 'SHORT_VCC_GND', '电源与地短路！请检查是否有器件引脚同时接到了 VCC 和 GND。');

    // 2. EA 引脚
    const eaNet = netOfPin('EA');
    if (eaNet === undefined) add('error', 'EA_FLOAT', 'EA（第 31 脚）悬空。STC89C52 使用内部 Flash，EA 必须接高电平（VCC），否则不执行程序。', [mcu.id]);
    else if (eaNet === sch.gndNet) add('error', 'EA_LOW', 'EA（第 31 脚）接了 GND。这会强制从外部存储器取指，而本实验没有外部 ROM，程序不会运行。', [mcu.id]);

    // 3. 复位
    const rstNet = netOfPin('RST');
    if (rstNet !== undefined && rstNet === sch.vccNet) add('error', 'RST_HIGH', 'RST（第 9 脚）直接接 VCC 会导致单片机一直处于复位状态。应用 10kΩ 上拉 + 0.1µF 到地，或接复位按键。', [mcu.id]);

    // 4. 晶振
    const hasCrystal = sch.parts.some(p => p.type === 'crystal');
    if (!hasCrystal) add('warn', 'NO_XTAL', '未看到晶振。仿真中会使用默认 11.0592MHz；实际电路必须外接晶振（XTAL1/XTAL2）或使用内部振荡器。', [mcu.id]);
    else {
      const x1 = netOfPin('XTAL1'), x2 = netOfPin('XTAL2');
      const xc = sch.parts.find(p => p.type === 'crystal');
      const cn = [0, 1].map(i => sch.netlist.netOf(sch.netlist.pinNet, xc.id, i));
      if (!(cn.includes(x1) && cn.includes(x2))) add('warn', 'XTAL_MISWIRE', '晶振未正确连接到 XTAL1(第 19 脚) 与 XTAL2(第 18 脚)。', [xc.id, mcu.id]);
      if (!isGround(x1) && x1 !== undefined) {
        // 检查是否串了电容到地（正确做法）
        const capsOnX1 = sch.parts.filter(p => p.type.startsWith('capacitor') &&
          [0, 1].some(i => sch.netlist.netOf(sch.netlist.pinNet, p.id, i) === x1));
        if (capsOnX1.length === 0) add('warn', 'XTAL_NO_CAP', '晶振两端通常各接一只 20–33pF 电容到地，用于稳定起振。');
      }
    }

    // 5. P0 口上拉（教学重点：P0 为开漏）
    const p0Nodes = [];
    for (let b = 0; b < 8; b++) {
      const nm = 'P0.' + b;
      const nIdx = netOfPin(nm);
      if (nIdx === undefined || nIdx === sch.vccNet || nIdx === sch.gndNet) continue;
      const members = sch.netMembers(nIdx);
      if (members.length > 1) p0Nodes.push({ nm, nIdx, members });
    }
    if (p0Nodes.length) {
      const hasPull = p0Nodes.some(n => sch.parts.some(p => p.type === 'resistor_net' || p.type === 'resistor'));
      if (!hasPull) add('warn', 'P0_NO_PULLUP', `P0 口（${p0Nodes.map(x => x.nm).join('/')}）已接负载但未接上拉电阻。P0 是开漏输出，驱动 LED 等负载时必须外接 10kΩ 上拉（或负载采用灌电流接法）。`, [mcu.id]);
    }

    // 6. LED 接法检查
    for (const led of sch.parts.filter(p => p.def.sim === 'led')) {
      const aNet = sch.netlist.netOf(sch.netlist.pinNet, led.id, 0);
      const kNet = sch.netlist.netOf(sch.netlist.pinNet, led.id, 1);
      const aVcc = aNet === sch.vccNet, kVcc = kNet === sch.vccNet;
      const aGnd = aNet === sch.gndNet, kGnd = kNet === sch.gndNet;
      if (aGnd && kGnd) add('error', 'LED_SHORT', `发光二极管 ${led.label} 两端都接到 GND，不会发光。`, [led.id]);
      if (aVcc && kVcc) add('error', 'LED_SHORT2', `发光二极管 ${led.label} 两端都接到 VCC，不会发光。`, [led.id]);
      if (aGnd && !kVcc) add('error', 'LED_REVERSE', `发光二极管 ${led.label} 阳极接了 GND、阴极接 I/O —— 极性反接，不会点亮。请把阳极（长脚）接限流电阻。`, [led.id]);
      if (aNet !== undefined && kNet !== undefined && aNet === kNet) add('error', 'LED_SAMENET', `发光二极管 ${led.label} 两个引脚在同一网络上（被短路）。`, [led.id]);
      // 限流电阻
      const hasSeriesR = [aNet, kNet].some(n => n !== undefined && sch.netMembers(n).some(m => {
        const q = sch.parts.find(p => p.id === m.comp);
        return q && (q.type === 'resistor' || q.type === 'resistor_net');
      }));
      if (!hasSeriesR) add('warn', 'LED_NO_R', `发光二极管 ${led.label} 没有串联限流电阻。实际电路中会因过流烧毁 LED 或损伤 I/O 口。`, [led.id]);
    }

    // 7. 数码管接法
    for (const seg of sch.parts.filter(p => p.def.sim === 'seg7' || p.def.sim === 'seg7x4')) {
      const isCommonCathode = (seg.props?.type || 'cc') === 'cc';
      const comName = seg.def.sim === 'seg7x4' ? null : 'COM';
      const comIdx = comName ? seg.def.pins.findIndex(p => p.name === comName) : -1;
      if (comIdx >= 0) {
        const cNet = sch.netlist.netOf(sch.netlist.pinNet, seg.id, comIdx);
        if (cNet === undefined) add('warn', 'SEG_COM_OPEN', `${seg.label} 的公共端未接线。共阴须接地，共阳须接 VCC。`, [seg.id]);
        else if (isCommonCathode && cNet === sch.vccNet) add('error', 'SEG_COM_WRONG', `${seg.label} 是共阴数码管，公共端接了 VCC。共阴数码管的公共端必须接 GND。`, [seg.id]);
        else if (!isCommonCathode && cNet === sch.gndNet) add('error', 'SEG_COM_WRONG2', `${seg.label} 是共阳数码管，公共端接了 GND。共阳数码管的公共端必须接 VCC。`, [seg.id]);
      }
      // 段码串限流电阻
      const segNet = sch.netlist.netOf(sch.netlist.pinNet, seg.id, 0);
      const hasR = segNet !== undefined && sch.netMembers(segNet).some(m => {
        const q = sch.parts.find(p => p.id === m.comp);
        return q && q.type.startsWith('resistor');
      });
      if (!hasR) add('warn', 'SEG_NO_R', `${seg.label} 的段码线未串限流电阻（建议每段 220–470Ω），否则电流过大会缩短器件寿命。`, [seg.id]);
    }

    // 8. LCD1602
    for (const lcd of sch.parts.filter(p => p.type === 'lcd1602')) {
      const g = (nm) => sch.netlist.netOf(sch.netlist.pinNet, lcd.id, lcd.def.pins.findIndex(x => x.name === nm));
      if (g('RS') === undefined || g('E') === undefined) add('error', 'LCD_CTRL_OPEN', 'LCD1602 的 RS / E 控制线必须连接（否则无法区分指令与数据、也无法产生使能脉冲）。', [lcd.id]);
      if (g('RW') === undefined) add('warn', 'LCD_RW_OPEN', 'LCD1602 的 RW 建议接地（只写模式）。若悬空，仿真中按只写处理。', [lcd.id]);
      if (g('VDD') === undefined || g('VSS') === undefined) add('error', 'LCD_POWER', 'LCD1602 的 VDD/VSS 未接电源与地。', [lcd.id]);
      const dataNets = [];
      for (let i = 0; i < 8; i++) { const n = g('D' + i); if (n !== undefined) dataNets.push(n); }
      const used4 = [g('D4'), g('D5'), g('D6'), g('D7')].filter(x => x !== undefined).length;
      const used8 = dataNets.length;
      if (used8 === 0) add('error', 'LCD_NO_DATA', 'LCD1602 的数据线（D0–D7 或 D4–D7）一条都没接。', [lcd.id]);
      else if (used4 === 4 && used8 === 4) add('info', 'LCD_4BIT', '检测到 LCD1602 采用 4 位总线接法（只接 D4–D7），程序需相应地初始化 0x28。', [lcd.id]);
      else if (used8 < 8 && used8 > 4) add('warn', 'LCD_PARTIAL_DATA', `LCD1602 数据线只接了 ${used8} 条，不构成合法的 4 位或 8 位总线。`, [lcd.id]);
    }

    // 9. 矩阵键盘
    for (const kp of sch.parts.filter(p => p.type === 'keypad4x4')) {
      let conn = 0;
      for (let i = 0; i < 8; i++) if (sch.netlist.netOf(sch.netlist.pinNet, kp.id, i) !== undefined) conn++;
      if (conn < 8) add('warn', 'KEYPAD_OPEN', `矩阵键盘只接了 ${conn}/8 条线。行列必须全部接入 I/O 口，否则部分按键无法识别。`, [kp.id]);
    }

    // 10. 按键：一端必须接地
    for (const k of sch.parts.filter(p => p.def.sim === 'key')) {
      const n0 = sch.netlist.netOf(sch.netlist.pinNet, k.id, 0);
      const n1 = sch.netlist.netOf(sch.netlist.pinNet, k.id, 1);
      const hasGnd = n0 === sch.gndNet || n1 === sch.gndNet;
      if (!hasGnd) add('warn', 'KEY_NO_GND', `按键 ${k.label} 没有一端接地，按下时无法产生低电平。`, [k.id]);
      if (n0 !== undefined && n0 === n1) add('error', 'KEY_SHORT', `按键 ${k.label} 两端被短接。`, [k.id]);
    }

    // 11. 悬空引脚（只提示被连接的端口引脚情况）
    const floating = [];
    for (let b = 0; b < 8; b++) for (const port of [1, 2, 3]) {
      const nm = `P${port}.${b}`;
      const n = netOfPin(nm);
      if (n === undefined) floating.push(nm);
    }
    if (floating.length >= 24) add('info', 'ALL_OPEN', '所有 I/O 口都未接线。请先从左侧元件库放置器件并连线。', [mcu.id]);

    // 12. 导线交叉（布线器无法避免时）
    const crossing = sch.wires.filter(w => w.crossings > 0);
    if (crossing.length) add('warn', 'WIRE_CROSS', `有 ${crossing.length} 条导线与其它导线交叉。原理图中十字交叉（无实心节点）表示"不连接"，容易引起误读，建议移动元件或改走线层。`, crossing.map(w => w.id));

    // 13. 同一端口引脚被接到多个强驱动源
    for (const n of sch.netlist.nets) {
      const portPins = n.members.filter(m => /^P[0-4]\.[0-7]$/.test(m.name || ''));
      if (portPins.length > 1) add('warn', 'MULTI_PORT', `网络 ${sch.netLabel(n.index)} 上接了多个 I/O 引脚（${portPins.map(m => m.name).join(', ')}）。除总线实验外，多个推挽输出互连会造成电平冲突。`, [mcu.id]);
    }

    // 14. 三极管驱动
    for (const q of sch.parts.filter(p => p.def.sim === 'npn')) {
      const cN = sch.netlist.netOf(sch.netlist.pinNet, q.id, 1);
      const eN = sch.netlist.netOf(sch.netlist.pinNet, q.id, 2);
      if (cN !== undefined && cN === eN) add('error', 'Q_SHORT', `三极管 ${q.label} 的集电极与发射极被短接。`, [q.id]);
      if (eN !== sch.gndNet && q.type === 'npn') add('warn', 'Q_NO_EMITTER_GND', 'NPN 三极管发射极通常接地（低边驱动）。', [q.id]);
    }

    // 15. 上拉电阻缺失（P3.2/P3.3 外部中断按键）
    for (const nm of ['P3.2', 'P3.3']) {
      const n = netOfPin(nm);
      if (n === undefined) continue;
      const members = sch.netMembers(n);
      const hasKey = members.some(m => {
        const q = sch.parts.find(p => p.id === m.comp);
        return q && (q.def.sim === 'key' || q.def.sim === 'keypad');
      });
      if (hasKey && !isPower(nm)) {
        add('info', 'INT_PULLUP', `${nm} 上接了按键。若用作外部中断输入，建议加 10kΩ 上拉电阻，避免悬空引起误触发。`, [mcu.id]);
      }
    }

    return issues;
  },

  summary(issues) {
    const by = { fatal: 0, error: 0, warn: 0, info: 0 };
    for (const i of issues) by[i.level] = (by[i.level] || 0) + 1;
    return by;
  }
};

/* ================================================================ 元件绘制 */
const C = {
  body: '#f7f8fa', bodyStroke: '#3a4250', pin: '#8a94a6', label: '#1f2937',
  accent: '#1a73e8', ledOn: '#ff3b30', segOn: '#ff3b30'
};

function pinDots(part, highlight = null) {
  let s = '';
  const def = part.def;
  for (let i = 0; i < def.pins.length; i++) {
    const g = part.pinGrid(i);
    const x = g2p(g.x), y = g2p(g.y);
    const hl = highlight && highlight.comp === part.id && highlight.pin === i;
    s += `<circle class="pin-hit" data-part="${part.id}" data-pin="${i}" cx="${x}" cy="${y}" r="${hl ? 5 : 3.2}"
           fill="${hl ? C.accent : '#ffffff'}" stroke="${hl ? C.accent : C.pin}" stroke-width="1.2"/>`;
  }
  return s;
}

export function renderPart(part, sim) {
  const def = part.def;
  const st = sim?.devices?.get(part.id);
  const X = g2p(part.x), Y = g2p(part.y);
  const W = g2p(part.w), H = g2p(part.h);
  let body = '';
  const rot = `transform="rotate(${part.rot} ${X + W / 2} ${Y + H / 2})"`;

  switch (part.type) {
    case 'mcu': case 'mcu51': {
      body = `
        <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="4" fill="#2b3038" stroke="#11151a" stroke-width="1.5"/>
        <rect x="${X + 10}" y="${Y - 12}" width="${W - 20}" height="14" rx="7" fill="#3d4652" stroke="#11151a"/>
        <circle cx="${X + W - 16}" cy="${Y - 5}" r="3.2" fill="#8a94a6"/>
        <text x="${X + W / 2}" y="${Y + H / 2 - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#e6e9ef">${def.props.model}</text>
        <text x="${X + W / 2}" y="${Y + H / 2 + 8}" text-anchor="middle" font-size="8" fill="#9aa4b2">${(def.props.fosc / 1e6).toFixed(4)} MHz</text>
        <text x="${X + W / 2}" y="${Y + H - 10}" text-anchor="middle" font-size="7.5" fill="#7b8494">${sim?.cpu ? 'RUNNING' : 'STOPPED'}</text>`;
      // 引脚名 + 物理引脚号
      for (let i = 0; i < def.pins.length; i++) {
        const g = part.pinGrid(i), px = g2p(g.x), py = g2p(g.y);
        const left = g.side === 'left';
        const isPort = /^P\d\.\d$/.test(def.pins[i].name);
        let col = isPort ? '#cfe3ff' : '#ffd9a8';
        let txt = def.pins[i].name;
        if (def.pins[i].alt) txt += ' /' + def.pins[i].alt;
        body += `<text x="${px + (left ? 6 : -6)}" y="${py + 3}" text-anchor="${left ? 'start' : 'end'}"
                   font-size="7.5" fill="${col}" font-family="ui-monospace,Consolas,monospace">${txt}</text>`;
        body += `<text x="${px + (left ? 5 : -5)}" y="${py - 6}" text-anchor="${left ? 'start' : 'end'}"
                   font-size="6" fill="#6b7484" font-family="ui-monospace,monospace">${def.pins[i].num}</text>`;
        body += `<line x1="${px}" y1="${py}" x2="${px + (left ? 8 : -8)}" y2="${py}" stroke="#8a94a6" stroke-width="1"/>`;
      }
      break;
    }
    case 'led': case 'diode': {
      const on = st?.on;
      const col = on ? (part.props?.color === 'green' ? '#00c853' : part.props?.color === 'blue' ? '#2979ff' : C.ledOn) : '#d7dbe2';
      /*
       * 关键：二极管的两个引脚在 def 里是 dy=1（第 2 行），
       * 但旧代码把符号画在 Y+18，与引脚行（Y+12）差 6px，
       * 造成"引脚不在元件身上"。这里统一以 pinGrid 的真实坐标为准。
       */
      const pinY = g2p(part.pinGrid(0).y);
      body = `
        <g ${rot}>
          <line x1="${X}" y1="${pinY}" x2="${X + 14}" y2="${pinY}" stroke="#5a6474" stroke-width="1.6"/>
          <polygon points="${X + 14},${pinY - 8} ${X + 14},${pinY + 8} ${X + 28},${pinY}" fill="${col}" stroke="#3a4250" stroke-width="1.2"/>
          <line x1="${X + 28}" y1="${pinY - 8}" x2="${X + 28}" y2="${pinY + 8}" stroke="#3a4250" stroke-width="2"/>
          <line x1="${X + 28}" y1="${pinY}" x2="${X + 36}" y2="${pinY}" stroke="#5a6474" stroke-width="1.6"/>
          ${on ? `<circle cx="${X + 21}" cy="${pinY}" r="11" fill="${col}" opacity="0.18"/>` : ''}
          ${on ? `<path d="M${X + 6},${pinY - 14} L${X + 16},${pinY - 24} M${X + 12},${pinY - 14} L${X + 22},${pinY - 24}" stroke="${col}" stroke-width="1.4" opacity="0.7"/>` : ''}
        </g>`;
      break;
    }
    case 'seg7': case 'seg7_ca': {
      body = renderSeg7Body(part, X, Y, [st?.segments || 0], st?.enabled ? [1] : [0], false);
      break;
    }
    case 'seg7x4': {
      body = renderSeg7Body(part, X, Y, st?.segments || [0, 0, 0, 0], st?.active || [0, 0, 0, 0], true);
      break;
    }
    case 'buzzer': case 'speaker': {
      const on = st?.effective;
      body = `
        <g ${rot}>
          <path d="M${X + 8},${Y + 12} L${X + 22},${Y + 12} L${X + 22},${Y + 34} L${X + 8},${Y + 34} Z" fill="${on ? '#ffd166' : '#e7eaf0'}" stroke="#3a4250" stroke-width="1.2"/>
          <path d="M${X + 22},${Y + 14} L${X + 38},${Y + 4} L${X + 38},${Y + 42} L${X + 22},${Y + 32} Z" fill="${on ? '#ffb703' : '#cfd6e0'}" stroke="#3a4250" stroke-width="1.2"/>
          ${on ? `<text x="${X + 8}" y="${Y + 50}" font-size="8" fill="#a06000">♪ ${st.freq || ''}Hz</text>` : ''}
        </g>`;
      break;
    }
    case 'key': {
      const pressed = st?.pressed;
      body = `
        <g ${rot}>
          <circle cx="${X + 18}" cy="${Y + 18}" r="14" fill="${pressed ? '#c8d6e5' : '#e7eaf0'}" stroke="#3a4250" stroke-width="1.3"/>
          <circle cx="${X + 18}" cy="${Y + (pressed ? 20 : 17)}" r="9" fill="${pressed ? '#8aa0b8' : '#fbfcfe'}" stroke="#5a6474"/>
          <line x1="${X}" y1="${Y + 18}" x2="${X + 6}" y2="${Y + 18}" stroke="#5a6474" stroke-width="1.6"/>
          <line x1="${X + 30}" y1="${Y + 18}" x2="${X + 36}" y2="${Y + 18}" stroke="#5a6474" stroke-width="1.6"/>
          <text x="${X + 18}" y="${Y + 2}" text-anchor="middle" font-size="7.5" fill="#5a6474">${part.props?.name || 'K'}</text>
        </g>`;
      break;
    }
    case 'keypad4x4': {
      let cells = '';
      const keys = (part.props?.keys || '123A456B789C*0#D');
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const i = r * 4 + c;
        const on = st?.pressed === i;
        cells += `<rect x="${X + 12 + c * 26}" y="${Y + 12 + r * 26}" width="22" height="22" rx="4"
           fill="${on ? '#8ab4f8' : '#f2f4f8'}" stroke="#3a4250" stroke-width="1"/>
          <text x="${X + 23 + c * 26}" y="${Y + 27 + r * 26}" text-anchor="middle" font-size="12" font-weight="600" fill="#26303c">${keys[i] || ''}</text>`;
      }
      body = `<rect x="${X + 6}" y="${Y + 6}" width="${W - 12}" height="${H - 12}" rx="5" fill="#eef1f5" stroke="#3a4250"/>${cells}`;
      for (let i = 0; i < 4; i++) {
        body += `<text x="${X + 2}" y="${Y + 27 + i * 26}" font-size="7" fill="#5a6474">R${i + 1}</text>`;
        body += `<text x="${X + W - 20}" y="${Y + 27 + i * 26}" font-size="7" fill="#5a6474">C${i + 1}</text>`;
      }
      break;
    }
    case 'dipswitch': {
      let sw = '';
      for (let i = 0; i < 6; i++) {
        const on = (st?.value ?? 0) & (1 << i);
        sw += `<rect x="${X + 14}" y="${Y + 8 + i * 14}" width="30" height="10" rx="3" fill="${on ? '#8ab4f8' : '#dfe4ea'}" stroke="#5a6474"/>
               <circle cx="${X + (on ? 38 : 20)}" cy="${Y + 13 + i * 14}" r="4" fill="#3a4250"/>`;
      }
      body = `<rect x="${X + 6}" y="${Y + 4}" width="${W - 12}" height="${H - 8}" rx="4" fill="#eef1f5" stroke="#3a4250"/>${sw}`;
      break;
    }
    case 'vcc': {
      body = `<g><line x1="${X + 18}" y1="${Y + 4}" x2="${X + 18}" y2="${Y + 48}" stroke="#c0392b" stroke-width="2"/>
        <path d="M${X + 6},${Y + 4} L${X + 18},${Y - 8} L${X + 30},${Y + 4} Z" fill="none" stroke="#c0392b" stroke-width="1.8"/>
        <text x="${X + 18}" y="${Y - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="#c0392b">VCC</text></g>`;
      break;
    }
    case 'gnd': {
      body = `<g><line x1="${X + 18}" y1="${Y}" x2="${X + 18}" y2="${Y + 34}" stroke="#34495e" stroke-width="2"/>
        <line x1="${X + 6}" y1="${Y + 34}" x2="${X + 30}" y2="${Y + 34}" stroke="#34495e" stroke-width="2"/>
        <line x1="${X + 11}" y1="${Y + 40}" x2="${X + 25}" y2="${Y + 40}" stroke="#34495e" stroke-width="2"/>
        <line x1="${X + 15}" y1="${Y + 46}" x2="${X + 21}" y2="${Y + 46}" stroke="#34495e" stroke-width="2"/></g>`;
      break;
    }
    case 'resistor': case 'resistor_net': case 'inductor': case 'crystal':
    case 'capacitor': case 'capacitor_pol': {
      body = renderPassive(part, X, Y, W, H);
      break;
    }
    case 'lcd1602': {
      const lines = st?.ctrl ? st.ctrl.getText() : ['', ''];
      const on = st?.ctrl?.displayOn !== false;
      body = `
        <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="4" fill="#0f5132" stroke="#1a3a2a" stroke-width="2"/>
        <rect x="${X + 10}" y="${Y + 12}" width="${W - 20}" height="${H - 34}" rx="2" fill="${on ? '#9fdb8a' : '#3d6b50'}" stroke="#0a3a24"/>
        ${[0, 1].map(r => {
        const txt = (lines[r] || '').padEnd(16, ' ').slice(0, 16);
        return `<text x="${X + 14}" y="${Y + 30 + r * 20}" font-size="13" fill="#0b2e1c"
              font-family="ui-monospace,Consolas,monospace" letter-spacing="1.2">${esc(txt)}</text>`;
      }).join('')}
        <text x="${X + W - 12}" y="${Y + H - 6}" text-anchor="end" font-size="8" fill="#cfe8d8">LCD1602</text>`;
      break;
    }
    case 'at24c02': case 'oled12864': case 'hc595': case 'ds1302': {
      const is595 = part.type === 'hc595';
      body = `
        <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="4" fill="${C.body}" stroke="${C.bodyStroke}" stroke-width="1.4"/>
        <text x="${X + W / 2}" y="${Y + H / 2 + 3}" text-anchor="middle" font-size="9" font-weight="600" fill="#26303c">${def.label.replace(/\(.*/, '')}</text>
        ${is595 && st ? `<text x="${X + W / 2}" y="${Y + H / 2 + 16}" text-anchor="middle" font-size="9" font-family="monospace" fill="#1a73e8">0x${(st.out || 0).toString(16).toUpperCase().padStart(2, '0')}</text>` : ''}
        ${!is595 && st?.i2c ? `<text x="${X + W / 2}" y="${Y + H / 2 + 16}" text-anchor="middle" font-size="8" fill="#5a6474">I2C ${(st.i2c.bytes || []).length ? '0x' + (st.i2c.bytes[0] || 0).toString(16) : '空闲'}</text>` : ''}`;
      break;
    }
    case 'npn': case 'pnp': {
      const on = st?.on;
      /*
       * 引脚定义在包围盒上：B=(0,2格) 左中、C/E=(5,0)/(5,4格) 右上与右下。
       * 旧画法把符号画在盒子正中、引线只到 X+44，与真正的引脚位置差 16px，
       * 于是圆点"飘"在符号外面。这里让引线一路画到引脚坐标上。
       */
      const cy = Y + g2p(2);              // B 引脚所在行（dy=2 格）
      const bx = X + 26;                  // 基极竖条
      const isNpn = part.type === 'npn';
      /*
       * 引脚坐标必须取自 def.pins（dx/dy 以格为单位），不能用包围盒的 W/H 推：
       * npn 的 E 在 dy=4 格 = 48px，而 H=60px，差 12px —— 之前就是这样漏接的。
       * 这里用未旋转的局部坐标（外层 <g rot> 负责旋转），与 pinGrid 的旋转互不干扰。
       */
      const gOf = (name) => part.def.pins.find(x => x.name === name) || { dx: 5, dy: 0 };
      const gC = gOf('C'), gE = gOf('E');
      const pinC = { x: X + g2p(gC.dx), y: Y + g2p(gC.dy) };
      const pinE = { x: X + g2p(gE.dx), y: Y + g2p(gE.dy) };
      const cStart = { x: bx, y: cy - 8 };
      const eStart = { x: bx, y: cy + 8 };

      // 箭头：沿引线方向 62% 处，reverse 用于 PNP（指向基极）
      const arrowAt = (s0, e0, reverse) => {
        const dx = e0.x - s0.x, dy = e0.y - s0.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = (reverse ? -dx : dx) / L, uy = (reverse ? -dy : dy) / L;
        const px = s0.x + dx * 0.62, py = s0.y + dy * 0.62;
        const nx = -uy, ny = ux, size = 5.5, half = 3.4;
        return `<polygon points="${px + ux * size},${py + uy * size} `
          + `${px - ux * 2 + nx * half},${py - uy * 2 + ny * half} `
          + `${px - ux * 2 - nx * half},${py - uy * 2 - ny * half}" fill="#3a4250"/>`;
      };

      body = `<g ${rot}>
        <circle cx="${X + 30}" cy="${cy}" r="20" fill="${on ? '#dff0ff' : '#f5f7fa'}" stroke="#3a4250" stroke-width="1.3"/>
        <line x1="${X}" y1="${cy}" x2="${bx}" y2="${cy}" stroke="#3a4250" stroke-width="1.6"/>
        <line x1="${bx}" y1="${cy - 12}" x2="${bx}" y2="${cy + 12}" stroke="#3a4250" stroke-width="2.4"/>
        <line x1="${cStart.x}" y1="${cStart.y}" x2="${pinC.x}" y2="${pinC.y}" stroke="#3a4250" stroke-width="1.6"/>
        <line x1="${eStart.x}" y1="${eStart.y}" x2="${pinE.x}" y2="${pinE.y}" stroke="#3a4250" stroke-width="1.6"/>
        ${arrowAt(eStart, pinE, !isNpn)}
        <text x="${X + 4}" y="${cy - 7}" font-size="7" fill="#5a6474">B</text>
        <text x="${pinC.x - 11}" y="${pinC.y <= Y + 6 ? pinC.y + 12 : pinC.y - 5}" font-size="7" fill="#5a6474">C</text>
        <text x="${pinE.x - 11}" y="${pinE.y <= Y + 6 ? pinE.y + 12 : pinE.y - 5}" font-size="7" fill="#5a6474">E</text></g>`;
      break;
    }
    case 'probe': {
      const v = st?.value;
      body = `<g>
        <rect x="${X + 14}" y="${Y + 4}" width="44" height="26" rx="4" fill="${v ? '#e8f5e9' : '#eceff1'}" stroke="#3a4250"/>
        <text x="${X + 36}" y="${Y + 22}" text-anchor="middle" font-size="13" font-weight="700"
              fill="${v ? '#1a7f37' : '#5a6474'}">${v ? '1' : '0'}</text>
        <text x="${X + 36}" y="${Y + 44}" text-anchor="middle" font-size="7.5" fill="#5a6474">${esc(part.props?.label || 'CH')}</text></g>`;
      break;
    }
    case 'uart_term': {
      body = `<g>
        <rect x="${X + 6}" y="${Y + 6}" width="${W - 12}" height="${H - 12}" rx="4" fill="#101820" stroke="#2b3038"/>
        <text x="${X + 12}" y="${Y + 22}" font-size="8" fill="#7ee787">TXD→RXD  GND</text>
        <text x="${X + 12}" y="${Y + 38}" font-size="8" fill="#7ee787">${part.props?.baud || 9600} 8N1</text></g>`;
      break;
    }
    default: {
      body = `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="4" fill="${C.body}" stroke="${C.bodyStroke}" stroke-width="1.2"/>
              <text x="${X + W / 2}" y="${Y + H / 2}" text-anchor="middle" font-size="9" fill="#26303c">${def.label}</text>`;
    }
  }
  return `<g class="part" data-part="${part.id}">${body}${pinDots(part)}</g>`;
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 数码管渲染：segments 按 a..g,dp 位序（bit0=a） */
function renderSeg7Body(part, X, Y, segs, active, multi) {
  const n = multi ? 4 : 1;
  const dw = multi ? (part.def.w - 2) / 4 : (part.def.w - 2);
  let out = `<rect x="${X + 3}" y="${Y + 6}" width="${g2p(part.def.w) - 6}" height="${g2p(part.def.h) - 12}" rx="3" fill="#1a1d21" stroke="#0c0e11"/>`;
  for (let d = 0; d < n; d++) {
    const ox = X + (multi ? 6 + d * g2p(dw) : 6);
    const on = !!active[d];
    const S = on ? segs[d] : 0;
    const seg = (bit, x1, y1, x2, y2) => {
      const lit = (S >> bit) & 1;
      return `<line x1="${ox + x1}" y1="${Y + y1}" x2="${ox + x2}" y2="${Y + y2}" stroke="${lit ? C.segOn : '#2a2f36'}" stroke-width="4" stroke-linecap="round"/>`;
    };
    const w = g2p(dw) - 8;
    const top = 14, mid = 40, bot = 66;
    const lx = 8, rx = 8 + w;
    out += seg(0, lx + 2, top, rx - 2, top);        // a
    out += seg(1, rx, top + 3, rx, mid - 3);        // b
    out += seg(2, rx, mid + 3, rx, bot - 3);        // c
    out += seg(3, lx + 2, bot, rx - 2, bot);        // d
    out += seg(4, lx, mid + 3, lx, bot - 3);        // e
    out += seg(5, lx, top + 3, lx, mid - 3);        // f
    out += seg(6, lx + 2, mid, rx - 2, mid);        // g
    const dp = (S >> 7) & 1;
    out += `<circle cx="${rx + 4}" cy="${bot}" r="2.6" fill="${dp ? C.segOn : '#2a2f36'}"/>`;
  }
  return out;
}

function renderPassive(part, X, Y, W, H) {
  const cx = X + W / 2;
  /*
   * 旧代码用 Y + H/2 当电气轴，而引脚定义是 dy=0（元件的上边缘行），
   * 两者相差 12px —— 于是"电阻的引脚浮在符号上方"。
   * 电气连接以 pinGrid 为准，符号必须画在引脚所在的那条线上。
   */
  const cy = g2p(part.pinGrid(0).y);
  if (part.type === 'resistor') {
    return `<g><line x1="${X}" y1="${cy}" x2="${X + 8}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
      <rect x="${X + 8}" y="${cy - 7}" width="${W - 16}" height="14" fill="#f3e9d8" stroke="#8a7a5c"/>
      ${[0, 1, 2].map(i => `<rect x="${X + 12 + i * 8}" y="${cy - 7}" width="3.5" height="14" fill="#7a5c3a" opacity="0.5"/>`).join('')}
      <line x1="${X + W - 8}" y1="${cy}" x2="${X + W}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="8" fill="#5a6474">${esc(part.props?.text || '')}</text></g>`;
  }
  if (part.type === 'resistor_net') {
    let s = `<rect x="${X + 4}" y="${Y + 2}" width="${W - 8}" height="${H - 4}" rx="3" fill="#f3e9d8" stroke="#8a7a5c"/>`;
    for (let i = 1; i <= 8; i++) s += `<line x1="${X + 4}" y1="${Y + i}" x2="${X + W - 4}" y2="${Y + i}" stroke="#7a5c3a" stroke-width="0.6" opacity="0.4"/>`;
    s += `<text x="${cx}" y="${Y + H + 12}" text-anchor="middle" font-size="8" fill="#5a6474">${esc(part.props?.text || '')}</text>`;
    return s;
  }
  if (part.type === 'inductor') {
    let s = `<line x1="${X}" y1="${cy}" x2="${X + W}" y2="${cy}" stroke="#5a6474" stroke-width="1.4"/>`;
    for (let i = 0; i < 4; i++) s += `<path d="M${X + 6 + i * 9},${cy} a4.5,4.5 0 0 1 9,0" fill="none" stroke="#8a5a2b" stroke-width="1.8"/>`;
    s += `<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="8" fill="#5a6474">${esc(part.props?.text || '')}</text>`;
    return s;
  }
  if (part.type === 'crystal') {
    return `<g><line x1="${X}" y1="${cy}" x2="${X + 8}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
      <line x1="${X + 10}" y1="${cy - 12}" x2="${X + 10}" y2="${cy + 12}" stroke="#3a4250" stroke-width="2.4"/>
      <rect x="${X + 14}" y="${cy - 8}" width="${W - 28}" height="16" fill="#e8eef5" stroke="#3a4250"/>
      <line x1="${X + W - 10}" y1="${cy - 12}" x2="${X + W - 10}" y2="${cy + 12}" stroke="#3a4250" stroke-width="2.4"/>
      <line x1="${X + W - 8}" y1="${cy}" x2="${X + W}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
      <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="8" fill="#5a6474">${esc(part.props?.text || '')}</text></g>`;
  }
  // 电容
  const pol = part.type === 'capacitor_pol';
  return `<g><line x1="${X}" y1="${cy}" x2="${X + W / 2 - 3}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
    <line x1="${X + W / 2 - 3}" y1="${cy - 12}" x2="${X + W / 2 - 3}" y2="${cy + 12}" stroke="#3a4250" stroke-width="2.6"/>
    ${pol ? `<path d="M${X + W / 2 + 6},${cy - 12} a12,12 0 0 0 0,24" fill="none" stroke="#3a4250" stroke-width="2.6"/>`
      : `<line x1="${X + W / 2 + 3}" y1="${cy - 12}" x2="${X + W / 2 + 3}" y2="${cy + 12}" stroke="#3a4250" stroke-width="2.6"/>`}
    <line x1="${X + W / 2 + 6}" y1="${cy}" x2="${X + W}" y2="${cy}" stroke="#5a6474" stroke-width="1.6"/>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="8" fill="#5a6474">${esc(part.props?.text || '')}</text></g>`;
}

/** 渲染整张原理图 */
export function renderSchematic(sch, sim, opts = {}) {
  const bb = schematicBounds(sch);
  const pad = 60;
  const viewBox = `${bb.x - pad} ${bb.y - pad} ${Math.max(bb.w + pad * 2, 400)} ${Math.max(bb.h + pad * 2, 300)}`;
  let wires = '';
  let handles = '';
  for (const w of sch.wires) {
    const pts = w.vertices.map(v => `${g2p(v.x)},${g2p(v.y)}`).join(' ');
    const sel = sch.sel.has(w.id);
    // 透明加粗热区：细线（2.4px）几乎点不中，这是"导线选不中/删不掉"的主因之一
    wires += `<polyline points="${pts}" fill="none" stroke="rgba(0,0,0,0)" stroke-width="14"
      stroke-linejoin="round" stroke-linecap="round" data-wire="${w.id}" style="cursor:move"/>`;
    wires += `<polyline points="${pts}" fill="none" stroke="${sel ? '#1a73e8' : (w.crossings ? '#e8710a' : w.color)}"
      stroke-width="${sel ? 3.4 : 2.4}" stroke-linejoin="round" stroke-linecap="round" data-wire="${w.id}" pointer-events="none"/>`;
    // 选中导线后给顶点手柄，可拖动拐点（手绘折线的基本操作）
    if (sel) {
      w.vertices.forEach((v, i) => {
        const free = !v.comp;                 // 绑在引脚上的端点不允许拖走
        handles += `<circle data-wire="${w.id}" data-vertex="${i}" cx="${g2p(v.x)}" cy="${g2p(v.y)}"
          r="${free ? 5 : 3.4}" fill="${free ? '#ffffff' : '#c3cad6'}" stroke="#1a73e8" stroke-width="1.6"
          style="cursor:${free ? 'move' : 'not-allowed'}"/>`;
      });
    }
  }
  // 连接节点（T 型交点画实心圆）
  let dots = '';
  const deg = new Map();
  for (const w of sch.wires) for (const v of w.vertices) {
    if (!v.comp) { const k = v.x + ',' + v.y; deg.set(k, (deg.get(k) || 0) + 1); }
  }
  for (const [k, n] of deg) if (n >= 2) {
    const [x, y] = k.split(',').map(Number);
    dots += `<circle cx="${g2p(x)}" cy="${g2p(y)}" r="3.2" fill="#1a7f37"/>`;
  }
  // 引脚名标注（MCU 之外）
  let labels = '';
  for (const p of sch.parts) {
    const extra = Object.entries(p.netNames || {}).filter(([k, v]) => v && v !== '-' && !/^(VCC|GND|N\d+)$/.test(v));
    if (extra.length && !p.def.isMcu) {
      labels += `<text x="${g2p(p.x) + 4}" y="${g2p(p.y) - 6}" font-size="8" fill="#1a73e8" font-family="ui-monospace,monospace">${esc(extra.slice(0, 3).map(e => e[1]).join(' '))}</text>`;
    }
  }
  const parts = sch.parts.map(p => renderPart(p, sim)).join('');
  // handles 放最后：保证顶点手柄盖在导线与元件之上，才能抓得住
  return { viewBox, svg: `${wires}${dots}${labels}${parts}${handles}` };
}

export function schematicBounds(sch) {
  if (!sch.parts.length) return { x: 0, y: 0, w: 600, h: 400 };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of sch.parts) {
    const b = p.bbox();
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: g2p(x0), y: g2p(y0), w: g2p(x1 - x0), h: g2p(y1 - y0) };
}

/* ================================================================ 预设原理图
 * 每个实验的默认接线（教师/学生可直接加载，也可另存为自己的版本）
 */
function place(sch, type, x, y, props) {
  const p = sch.addPart(type, x, y, { checkOverlap: false });
  if (props) Object.assign(p.props, props);
  return p;
}
function wire(sch, a, ap, b, bp) {
  const A = sch.parts.find(p => p.id === a.id), B = sch.parts.find(p => p.id === b.id);
  const ia = A.def.pins.findIndex(x => x.name === ap), ib = B.def.pins.findIndex(x => x.name === bp);
  if (ia < 0 || ib < 0) return null;
  const ga = A.pinGrid(ia), gb = B.pinGrid(ib);
  return sch.connectPin({ comp: A.id, pin: ia, gx: ga.x, gy: ga.y }, { comp: B.id, pin: ib, gx: gb.x, gy: gb.y });
}

export const PRESETS = {
  /** 最小系统 + P1 口 8 路 LED（灌电流接法） */
  led_min: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2);
    const gnd = place(s, 'gnd', 6, 12);
    const rn = place(s, 'resistor_net', 44, 6, { text: '1k×8' });
    const led = [];
    for (let i = 0; i < 8; i++) led.push(place(s, 'led', 60 + (i % 4) * 6, 7 + Math.floor(i / 4) * 5, { color: i < 4 ? 'red' : 'green' }));
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    // 推荐的"灌电流"接法：VCC → 限流电阻 → LED 阳极 → 阴极 → P1.x
    // P1.x 输出低电平时 LED 点亮（与教科书流水灯程序一致）
    wire(s, rn, 'COM', vcc, 'VCC');
    for (let i = 0; i < 8; i++) {
      wire(s, rn, 'R' + (i + 1), led[i], 'A');      // 限流电阻接 LED 阳极
      wire(s, led[i], 'K', u, 'P1.' + i);           // 阴极由 P1 口灌电流
    }
    const cr = place(s, 'crystal', 2, 20); wire(s, u, 'XTAL1', cr, '1'); wire(s, u, 'XTAL2', cr, '2');
    s.refresh(); return s;
  },
  /** 蜂鸣器（三极管驱动） */
  buzzer: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const r = place(s, 'resistor', 40, 22, { text: '1k' });
    const q = place(s, 'npn', 48, 20);
    const bz = place(s, 'buzzer', 58, 8, { type: 'passive' });
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, u, 'P1.0', r, '1'); wire(s, r, '2', q, 'B');
    wire(s, q, 'E', gnd, 'GND');
    wire(s, bz, '-', q, 'C');
    wire(s, bz, '+', vcc, 'VCC');
    s.refresh(); return s;
  },
  /** 数码管静态显示（共阴，P0 段码经排阻上拉） */
  seg_static: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const rn = place(s, 'resistor_net', 44, 4, { text: '470×8' });
    const seg = place(s, 'seg7', 60, 4, { type: 'cc' });
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, rn, 'COM', vcc, 'VCC');
    const names = ['P0.0', 'P0.1', 'P0.2', 'P0.3', 'P0.4', 'P0.5', 'P0.6', 'P0.7'];
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    for (let i = 0; i < 8; i++) { wire(s, u, names[i], rn, 'R' + (i + 1)); wire(s, rn, 'R' + (i + 1), seg, segs[i]); }
    wire(s, seg, 'COM', gnd, 'GND');
    s.refresh(); return s;
  },
  /** 四位数码管动态扫描 */
  seg_scan: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const rn = place(s, 'resistor_net', 44, 4, { text: '470×8' });
    const seg = place(s, 'seg7x4', 60, 4, { type: 'cc' });
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, rn, 'COM', vcc, 'VCC');
    const names = ['P0.0', 'P0.1', 'P0.2', 'P0.3', 'P0.4', 'P0.5', 'P0.6', 'P0.7'];
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    for (let i = 0; i < 8; i++) { wire(s, u, names[i], rn, 'R' + (i + 1)); wire(s, rn, 'R' + (i + 1), seg, segs[i]); }
    const g2 = place(s, 'gnd', 46, 20);
    for (let d = 0; d < 4; d++) wire(s, u, 'P2.' + d, seg, 'D' + (d + 1));
    wire(s, seg, 'D1', g2, 'GND');   // 占位，实际由 P2 驱动位选
    s.wires = s.wires.filter(w => !(w.a.comp === seg.id && w.a.pin === 8));
    s.refresh(); return s;
  },
  /** 矩阵键盘 + 数码管显示键值 */
  matrix_keypad: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const kp = place(s, 'keypad4x4', 46, 8);
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    for (let i = 0; i < 4; i++) wire(s, u, 'P1.' + i, kp, 'R' + (i + 1));
    for (let i = 0; i < 4; i++) wire(s, u, 'P1.' + (i + 4), kp, 'C' + (i + 1));
    s.refresh(); return s;
  },
  /** LCD1602 4 位总线 */
  lcd1602: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const lcd = place(s, 'lcd1602', 48, 4);
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, lcd, 'VSS', gnd, 'GND'); wire(s, lcd, 'VDD', vcc, 'VCC'); wire(s, lcd, 'V0', gnd, 'GND');
    wire(s, lcd, 'RW', gnd, 'GND'); wire(s, lcd, 'A', vcc, 'VCC'); wire(s, lcd, 'K', gnd, 'GND');
    wire(s, u, 'P2.5', lcd, 'RS'); wire(s, u, 'P2.6', lcd, 'E');
    const map = [['P0.4', 'D4'], ['P0.5', 'D5'], ['P0.6', 'D6'], ['P0.7', 'D7']];
    for (const [a, b] of map) wire(s, u, a, lcd, b);
    s.refresh(); return s;
  },
  /** UART 串口通信（接虚拟终端） */
  uart: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const term = place(s, 'uart_term', 48, 10, { baud: 9600 });
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, u, 'P3.1', term, 'RXD'); wire(s, u, 'P3.0', term, 'TXD'); wire(s, u, 'GND', term, 'GND');
    s.refresh(); return s;
  },
  /** I2C：AT24C02 */
  i2c: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const mem = place(s, 'at24c02', 48, 6);
    const r1 = place(s, 'resistor', 40, 18, { text: '4.7k' }), r2 = place(s, 'resistor', 40, 23, { text: '4.7k' });
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, mem, 'VCC', vcc, 'VCC'); wire(s, mem, 'GND', gnd, 'GND'); wire(s, mem, 'WP', gnd, 'GND');
    wire(s, u, 'P2.0', mem, 'SCL'); wire(s, u, 'P2.1', mem, 'SDA');
    wire(s, r1, '1', vcc, 'VCC'); wire(s, r1, '2', mem, 'SCL');
    wire(s, r2, '1', vcc, 'VCC'); wire(s, r2, '2', mem, 'SDA');
    s.refresh(); return s;
  },
  /** SPI：74HC595 驱动 8 位 LED */
  spi_595: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const sh = place(s, 'hc595', 46, 4);
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, sh, 'VCC', vcc, 'VCC'); wire(s, sh, 'GND', gnd, 'GND'); wire(s, sh, 'MR', vcc, 'VCC'); wire(s, sh, 'OE', gnd, 'GND');
    wire(s, u, 'P2.0', sh, 'DS'); wire(s, u, 'P2.1', sh, 'SHCP'); wire(s, u, 'P2.2', sh, 'STCP');
    const led = [];
    for (let i = 0; i < 8; i++) led.push(place(s, 'led', 62 + (i % 4) * 6, 1 + Math.floor(i / 4) * 5));
    const g2 = place(s, 'gnd', 62, 14);
    for (let i = 0; i < 8; i++) { wire(s, sh, 'Q' + i, led[i], 'A'); wire(s, led[i], 'K', g2, 'GND'); }
    s.refresh(); return s;
  },
  /** 外部中断 + 按键 */
  external_int: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 20, 6);
    const vcc = place(s, 'vcc', 6, 2), gnd = place(s, 'gnd', 6, 12);
    const k1 = place(s, 'key', 44, 12), k2 = place(s, 'key', 44, 20);
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    wire(s, u, 'P3.2', k1, '1'); wire(s, k1, '2', gnd, 'GND');
    wire(s, u, 'P3.3', k2, '1'); wire(s, k2, '2', gnd, 'GND');
    const led = place(s, 'led', 46, 4);
    const r = place(s, 'resistor', 40, 4, { text: '470' });
    wire(s, u, 'P1.0', r, '1'); wire(s, r, '2', led, 'A'); wire(s, led, 'K', gnd, 'GND');
    s.refresh(); return s;
  },
  /** 空白画布（仅最小系统） */
  minimal: () => {
    const s = new Schematic(); s.onStatus = () => { };
    const u = place(s, 'mcu', 24, 6);
    const vcc = place(s, 'vcc', 10, 2), gnd = place(s, 'gnd', 10, 12);
    wire(s, u, 'VCC', vcc, 'VCC'); wire(s, u, 'GND', gnd, 'GND'); wire(s, u, 'EA', vcc, 'VCC');
    s.refresh(); return s;
  }
};
