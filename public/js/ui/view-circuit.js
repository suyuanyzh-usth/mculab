/*
 * view-circuit.js — 原理图编辑视图
 * 交互：点选元件库放置 → 连线工具点两个引脚自动正交布线（优先零交叉）
 *       → 拖动移动 → 旋转/删除/撤销；实时网表与接线诊断。
 */
import {
  $, $$, el, api, state, toast, bus, esc, modal, closeModal, confirmBox, promptBox, setView, bindCircuit, ensureSim
} from './core.js';
import { DEVICE_DEFS, CATEGORIES } from '../core/circuit.js';
import { Schematic, Part, renderSchematic, schematicBounds, PRESETS, Diagnostics } from '../schematic/schematic.js';

const GRID = 12;
let sch = null;
let svg = null, root = null;
let vb = { x: 0, y: 0, w: 700, h: 480 };
let pendingType = null;
let drag = null;
// 连击判定（双击打开属性）
let lastClickPart = null;
let lastClickAt = 0;
let history = [], histIdx = -1;
let lastDiag = [];

/* ================================================================ 初始化 */
export function init() {
  svg = $('#schCanvas'); root = $('#schRoot');
  sch = new Schematic({
    onChange: () => { render(); pushHistory(); },
    onStatus: (msg, kind) => setStatus(msg, kind)
  });
  state.sch = sch;

  // 工具切换
  $$('.tool-btn[data-tool]').forEach(b => b.addEventListener('click', () => {
    sch.tool = b.dataset.tool;
    sch.pendingWire = null;
    $$('.tool-btn[data-tool]').forEach(x => x.classList.toggle('active', x === b));
    svg.classList.remove('tool-select', 'tool-wire', 'tool-delete');
    svg.classList.add('tool-' + sch.tool);
    hint(sch.tool === 'wire' ? '连线模式：依次点击两个引脚，系统自动正交布线并优先选择零交叉路径。'
      : sch.tool === 'delete' ? '删除模式：点击元件或导线即可删除。'
        : '选择模式：拖动移动元件；滚轮缩放；空白处拖动平移。');
    render();
  }));

  $('#btnRotate').addEventListener('click', () => { if (sch.sel.size) { sch.rotateParts([...sch.sel]); } });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnClearAll').addEventListener('click', async () => {
    if (!sch.parts.length) return;
    if (!await confirmBox('清空原理图', '将删除所有元件与导线，此操作可通过「撤销」恢复。', '清空')) return;
    sch.parts = []; sch.wires = []; sch.sel.clear(); sch.refresh(); render(); pushHistory();
  });
  $('#btnDiagnose').addEventListener('click', () => { renderDiag(true); });
  $('#btnExportSvg').addEventListener('click', exportSvg);
  $('#btnSaveSketch').addEventListener('click', saveSketch);
  $('#btnLoadSketch').addEventListener('click', loadSketchList);
  $('#partSearch').addEventListener('input', renderPalette);

  $('#presetSelect').addEventListener('change', (e) => {
    const name = e.target.value; e.target.value = '';
    if (!name) return;
    loadPreset(name);
  });

  bindCanvas();
  bindPropsUI();
  renderPalette();
  fillPresets();

  // 默认给一个最小系统，避免空白
  loadPreset('led_min', true);

  bus.on('circuit-load-preset', ({ preset }) => {
    if (preset && PRESETS[preset]) loadPreset(preset, true);
  });
  bus.on('relayout', fitView);
  // 从开放题的提交里加载原理图（教师查看学生作品）
  bus.on('circuit-load-data', ({ data }) => {
    if (!data || !Array.isArray(data.parts)) return;
    try {
      sch.parts = [];
      for (const d of data.parts) {
        const part = new Part(d.type, d.x, d.y);
        if (d.rot) part.rot = d.rot;
        if (d.props) part.props = { ...part.props, ...d.props };
        sch.parts.push(part);
      }
      sch.wires = (data.wires || []).map(w => ({ vertices: (w.vertices || []).slice() }));
      sch.sel.clear(); sch.pendingWire = null;
      sch.refresh();
      render(); fitView(); bindCircuit(sch);
      toast('已载入学生提交的原理图', 'ok');
    } catch (e) { toast('原理图载入失败：' + e.message, 'err'); }
  });
  window.addEventListener('keydown', onKey);
}

export function show() { render(); fitView(); }

/* ================================================================ 元件库 */
function renderPalette() {
  const kw = ($('#partSearch')?.value || '').trim().toLowerCase();
  const box = $('#palette');
  box.innerHTML = '';
  for (const cat of CATEGORIES) {
    const items = Object.entries(DEVICE_DEFS).filter(([, d]) =>
      d.category === cat.id && (!kw || (d.label + ' ' + Object.keys(d).join(' ')).toLowerCase().includes(kw)));
    if (!items.length) continue;
    const g = el('div', { class: 'pal-group' }, [el('h4', { text: cat.label })]);
    for (const [type, d] of items) {
      const node = el('div', { class: 'pal-item', draggable: 'true', dataset: { type } }, [
        el('span', { class: 'pal-ico', text: (d.label || '').slice(0, 2) }),
        el('span', { text: d.label })
      ]);
      node.title = `${d.label}（${type}）\n放置后可用「旋转」调整方向`;
      node.addEventListener('click', () => {
        pendingType = type;
        hint(`已选中「${d.label}」，点击画布空白处放置（右键取消）。`);
        $('.canvas-wrap').style.cursor = 'copy';
      });
      node.addEventListener('dragstart', (e) => {
        pendingType = type;
        e.dataTransfer.setData('text/plain', type);
        e.dataTransfer.effectAllowed = 'copy';
      });
      g.append(node);
    }
    box.append(g);
  }
  if (!box.children.length) box.innerHTML = '<div class="empty">没有匹配的元件</div>';
}

function fillPresets() {
  const sel = $('#presetSelect');
  const labels = {
    led_min: 'LED 流水灯（P1 灌电流）', buzzer: '蜂鸣器（三极管驱动）',
    seg_static: '数码管静态显示', seg_scan: '数码管动态扫描（4 位）',
    matrix_keypad: '4×4 矩阵键盘', lcd1602: 'LCD1602 字符显示',
    uart: '串口 UART 收发', i2c: 'I²C（AT24C02）',
    spi_595: 'SPI（74HC595）', external_int: '外部中断按键',
    minimal: '最小系统'
  };
  for (const k of Object.keys(PRESETS)) {
    sel.append(el('option', { value: k, text: labels[k] || k }));
  }
}

/* ================================================================ 渲染 */
/*
 * 整图重绘：重建 SVG + 刷新诊断/网络/统计面板。
 * 开销随元件数量线性增长，因此**拖拽过程中不调用它**，
 * 拖动时走 paintDrag() 做增量更新，松手才回到这里。
 */
function render() {
  if (!sch) return;
  sch.refresh();
  const { svg: inner } = renderSchematic(sch, state.sim || null);
  root.innerHTML = inner;
  applyVB();
  renderDiag();
  renderNets();
  renderCounts();
}

/*
 * 拖拽中的增量绘制：只改"被拖元件"的 transform 与"相连导线"的 points，
 * 不重建 DOM、不重算净表、不刷新侧栏。这是消除拖拽卡顿的关键。
 */
function paintDrag(partIds, wireIds) {
  for (const id of partIds) {
    const p = sch.parts.find(x => x.id === id);
    const o = drag && drag.orig.get(id);
    const el = drag && drag.els.get(id);
    if (!p || !o || !el) continue;
    el.setAttribute('transform', `translate(${(p.x - o.x) * GRID},${(p.y - o.y) * GRID})`);
  }
  paintWires(wireIds);
}

/** 单条导线 + 它的拐点手柄一起重画（拖动导线时用） */
function paintWireWithHandles(wid) {
  paintWires([wid]);
  const w = sch.wires.find(x => x.id === wid);
  if (!w) return;
  for (const c of root.querySelectorAll(`circle[data-vertex][data-wire="${wid}"]`)) {
    const v = w.vertices[Number(c.dataset.vertex)];
    if (v) { c.setAttribute('cx', v.x * GRID); c.setAttribute('cy', v.y * GRID); }
  }
}

function paintWires(wireIds) {
  for (const wid of wireIds) {
    const w = sch.wires.find(x => x.id === wid);
    if (!w) continue;
    const pts = w.vertices.map(v => `${v.x * GRID},${v.y * GRID}`).join(' ');
    for (const el of root.querySelectorAll(`polyline[data-wire="${wid}"]`)) el.setAttribute('points', pts);
  }
}

/** 与给定元件相连的导线 id（用于拖拽时同步重画） */
function wiresOf(partIds) {
  const set = new Set(partIds);
  return sch.wires.filter(w => w.vertices.some(v => v.comp && set.has(v.comp))).map(w => w.id);
}

function applyVB() {
  vb.w = Math.max(160, vb.w); vb.h = Math.max(120, vb.h);
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
}

function fitView() {
  if (!sch) return;
  const bb = schematicBounds(sch);
  const pad = 70;
  const elW = svg.clientWidth || 800, elH = svg.clientHeight || 500;
  // 保持纵横比，避免元件被拉扁
  const aspect = elW / Math.max(1, elH);
  let w = bb.w + pad * 2, h = bb.h + pad * 2;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  vb = { x: bb.x - (w - bb.w) / 2, y: bb.y - (h - bb.h) / 2, w, h };
  applyVB();
}

function renderCounts() {
  const issues = sch.diagnostics || [];
  const s = Diagnostics.summary(issues);
  $('#schStatus').innerHTML =
    `<span>元件 ${sch.parts.length}</span><span>导线 ${sch.wires.length}</span>` +
    `<span>网络 ${sch.netlist.nets.filter(n => n.members.length).length}</span>` +
    `<span style="color:${s.fatal || s.error ? 'var(--err)' : s.warn ? 'var(--warn)' : 'var(--ok)'}">` +
    `诊断：${s.fatal || s.error ? (s.fatal + s.error) + ' 错误' : '通过'}${s.warn ? ' · ' + s.warn + ' 警告' : ''}</span>`;
}

function setStatus(msg, kind = '') {
  const b = $('#schStatus');
  if (!b) return;
  b.className = 'statusbar ' + (kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : '');
  b.dataset.msg = msg;
  if (msg) b.innerHTML = `<span>${esc(msg)}</span>`;
  setTimeout(() => { if (b.dataset.msg === msg) renderCounts(); }, 3800);
}
function hint(t) { $('#canvasHint').textContent = t; }

/* ================================================================ 诊断面板 */
function renderDiag(announce = false) {
  const issues = sch.diagnostics || [];
  lastDiag = issues;
  state.evidence.diag = { count: issues.length, errors: issues.filter(i => i.level === 'fatal' || i.level === 'error').length, at: Date.now() };
  const box = $('#diagList');
  box.innerHTML = '';
  if (!issues.length) {
    box.innerHTML = '<div class="diag-item ok"><b>接线检查通过</b>未发现常见接线错误。</div>';
    if (announce) toast('接线检查通过，未发现错误', 'ok');
    return;
  }
  const order = { fatal: 0, error: 1, warn: 2, info: 3 };
  issues.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  for (const it of issues) {
    const cls = it.level === 'fatal' || it.level === 'error' ? 'err' : it.level === 'warn' ? 'warn' : 'info';
    const node = el('div', { class: 'diag-item ' + cls }, [
      el('b', { text: (it.level === 'fatal' ? '严重：' : it.level === 'error' ? '错误：' : it.level === 'warn' ? '警告：' : '提示：') + (it.code || '') }),
      document.createTextNode(it.msg)
    ]);
    node.addEventListener('click', () => {
      const ids = it.targets || [];
      if (!ids.length) return;
      sch.sel = new Set(ids);
      render();
      focusOn(ids);
    });
    box.append(node);
  }
  if (announce) {
    const s = Diagnostics.summary(issues);
    toast(s.fatal || s.error ? `发现 ${s.fatal + s.error} 个接线错误` : `仅有 ${s.warn} 条警告`, s.fatal || s.error ? 'err' : 'warn');
  }
}

function focusOn(ids) {
  const parts = sch.parts.filter(p => ids.includes(p.id));
  if (!parts.length) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) {
    const b = p.bbox();
    x0 = Math.min(x0, b.x * GRID); y0 = Math.min(y0, b.y * GRID);
    x1 = Math.max(x1, (b.x + b.w) * GRID); y1 = Math.max(y1, (b.y + b.h) * GRID);
  }
  const pad = 80;
  vb = { x: x0 - pad, y: y0 - pad, w: Math.max(240, x1 - x0 + pad * 2), h: Math.max(180, y1 - y0 + pad * 2) };
  applyVB();
}

function renderNets() {
  const box = $('#netList');
  const nets = sch.netlist.nets.filter(n => n.members.length > 1);
  if (!nets.length) { box.innerHTML = '<div class="muted">尚无连接多个引脚的网。</div>'; return; }
  box.innerHTML = nets.map(n => {
    const label = sch.netLabel(sch.netlist.nets.indexOf(n));
    const members = n.members.slice(0, 6).map(m => {
      const p = sch.parts.find(x => x.id === m.comp);
      const nm = p?.def.pins[m.pin]?.name || ('#' + m.pin);
      return (p?.def.isMcu ? nm : (p?.label || '?') + '.' + nm);
    });
    const more = n.members.length > 6 ? ` +${n.members.length - 6}` : '';
    return `<div class="net-row"><b>${esc(label)}</b> · ${esc(members.join(', '))}${more}</div>`;
  }).join('');
}

/* ================================================================ 历史 */
function snapshot() { return JSON.stringify(sch.toJSON()); }
function pushHistory() {
  const s = snapshot();
  if (history[histIdx] === s) return;
  history = history.slice(0, histIdx + 1);
  history.push(s);
  if (history.length > 60) history.shift();
  histIdx = history.length - 1;
}
function undo() {
  if (histIdx <= 0) return toast('没有更多可撤销的操作', 'warn');
  histIdx--;
  sch.loadJSON(JSON.parse(history[histIdx]));
  render(); fitView();
}
function redo() {
  if (histIdx >= history.length - 1) return toast('没有更多可重做的操作', 'warn');
  histIdx++;
  sch.loadJSON(JSON.parse(history[histIdx]));
  render(); fitView();
}

/* ================================================================ 画布交互 */
function toSvg(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function toGrid(evt) {
  const p = toSvg(evt);
  return { gx: Math.round(p.x / GRID), gy: Math.round(p.y / GRID), px: p.x, py: p.y };
}

function bindCanvas() {
  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    pendingType = null; sch.pendingWire = null; $('.canvas-wrap').style.cursor = '';
    hint('已取消放置/连线。');
    render();
  });

  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2) return;
    const t = e.target;
    /*
     * 关键修复：SVG 里真正被点中的是最内层的 <rect>/<line>/<text>，
     * 而 data-part 只挂在它们的外层 <g> 上。旧代码直接读 t.dataset，
     * 因此点击元件主体永远拿不到 partId —— 拖不动、删不掉、选不中都是这个原因。
     * 必须用 closest() 向上找。
     */
    const up = (sel) => (t && t.closest ? t.closest(sel) : null);
    const pinEl = up('[data-pin]');
    const partEl = pinEl || up('[data-part]');
    const wireEl = up('[data-wire]');
    const partId = partEl ? partEl.dataset.part : undefined;
    const pinIdx = pinEl ? pinEl.dataset.pin : undefined;
    const wireId = wireEl ? wireEl.dataset.wire : undefined;
    const vertexIdx = (wireEl && wireEl.dataset.vertex !== undefined) ? Number(wireEl.dataset.vertex) : null;
    const { gx, gy } = toGrid(e);

    /* ---- 放置新模式 ---- */
    if (pendingType) {
      const p = sch.addPart(pendingType, gx, gy);
      if (p) {
        sch.sel = new Set([p.id]);
        pushHistory();
        setStatus(`已放置 ${DEVICE_DEFS[pendingType].label}`, 'ok');
      }
      pendingType = null;
      $('.canvas-wrap').style.cursor = '';
      render();
      return;
    }

    /* ---- 连线：点引脚 ---- */
    if (pinIdx !== undefined && sch.tool === 'wire') {
      const hit = { comp: partId, pin: Number(pinIdx) };
      if (!sch.pendingWire) {
        sch.pendingWire = hit;
        hint(`起点：${pinLabel(hit)}。请点击目标引脚（右键或 Esc 取消）。`);
        render();
      } else {
        const a = sch.pendingWire, b = hit;
        const A = sch.parts.find(x => x.id === a.comp), B = sch.parts.find(x => x.id === b.comp);
        if (A && B) {
          const ga = A.pinGrid(a.pin), gb = B.pinGrid(b.pin);
          const w = sch.connectPin(
            { comp: A.id, pin: a.pin, gx: ga.x, gy: ga.y },
            { comp: B.id, pin: b.pin, gx: gb.x, gy: gb.y });
          if (w) pushHistory();
        }
        sch.pendingWire = null;
        render();
      }
      return;
    }

    /* ---- 删除模式 ---- */
    if (sch.tool === 'delete') {
      if (wireId) {
        sch.wires = sch.wires.filter(w => w.id !== wireId);
        sch.sel.delete(wireId);
        sch.refresh(); render(); pushHistory();
        setStatus('已删除导线', 'ok');
        return;
      }
      if (partId && !pinIdx) {
        // 旧代码少了 render()，删除后界面不刷新，看起来像"删除无效"
        sch.removeParts([partId]);
        sch.sel.delete(partId);
        render(); pushHistory();
        setStatus('已删除元件', 'ok');
        return;
      }
      return;
    }

    /* ---- 选择 / 拖动 ---- */
    if (partId && !pinIdx) {
      /*
       * 双击开属性：只在"上一次是原地点击（没拖动）"时才成立。
       * 早先的写法在 pointerdown 里就记账，导致"单击选中 → 立刻按下拖动"
       * 的第二次按下被误判成双击，拖动时弹出参数框。
       * 现在记账放在 pointerup 且要求 drag.moved === false，拖动永远不会误触。
       */
      const now = Date.now();
      /*
       * 这里**不立即**开属性弹窗。原因：用户"单击选中 → 紧接着按下拖动"的两下
       * 在时间上与双击无法区分，若按下即弹窗，拖动就会被参数框打断。
       * 因此只登记"这可能是一次双击的第二下"，等 pointerup 确认没有位移后再决定。
       */
      const dblCandidate = !e.shiftKey && lastClickPart === partId && (now - lastClickAt) < 400;

      if (e.shiftKey) { sch.sel.has(partId) ? sch.sel.delete(partId) : sch.sel.add(partId); }
      else if (!sch.sel.has(partId)) sch.sel = new Set([partId]);
      render();
      drag = {
        mode: 'move', start: { gx, gy }, ids: [...sch.sel], dblCandidate,
        orig: new Map([...sch.sel].map(id => {
          const p = sch.parts.find(x => x.id === id); return [id, { x: p.x, y: p.y }];
        })), moved: false
      };
      // 缓存被拖元件与相连导线的 DOM 引用，拖动时只改这些节点（见 paintDrag）
      drag.els = new Map();
      for (const id of drag.ids) drag.els.set(id, root.querySelector(`g.part[data-part="${id}"]`));
      drag.wireIds = wiresOf(drag.ids);
      svg.setPointerCapture(e.pointerId);
      return;
    }
    /* ---- 导线：拖顶点 / 拖动整条线 ---- */
    if (wireId) {
      if (!sch.sel.has(wireId)) sch.sel = new Set([wireId]);
      render();
      const w = sch.wires.find(x => x.id === wireId);
      if (!w) return;
      if (vertexIdx !== null && !w.vertices[vertexIdx].comp) {
        drag = {
          mode: 'vertex', wireId, idx: vertexIdx,
          start: { gx, gy }, orig: { x: w.vertices[vertexIdx].x, y: w.vertices[vertexIdx].y }, moved: false
        };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      // 整条线平移：只移动没有绑定引脚的自由顶点，端点仍锁在元件上
      const free = w.vertices.map((v, i) => (v.comp ? -1 : i)).filter(i => i >= 0);
      if (free.length) {
        drag = {
          mode: 'wire', wireId, start: { gx, gy },
          orig: new Map(free.map(i => [i, { x: w.vertices[i].x, y: w.vertices[i].y }])), moved: false
        };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }
    /* 空白：平移 */
    drag = { mode: 'pan', px: e.clientX, py: e.clientY, vb: { ...vb }, moved: false };
    svg.setPointerCapture(e.pointerId);
    if (sch.tool === 'select') { sch.sel.clear(); render(); }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'pan') {
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      const k = vb.w / (svg.clientWidth || 1);
      vb.x = drag.vb.x - dx * k; vb.y = drag.vb.y - dy * k;
      applyVB();
      drag.moved = true;
      return;
    }
    if (drag.mode === 'move') {
      const { gx, gy } = toGrid(e);
      const dx = gx - drag.start.gx, dy = gy - drag.start.gy;
      if (!dx && !dy) return;
      for (const id of drag.ids) {
        const p = sch.parts.find(x => x.id === id);
        const o = drag.orig.get(id);
        if (!p || !o) continue;
        const nx = o.x + dx, ny = o.y + dy;
        p.x = nx; p.y = ny;
        // 不能与其它元件重叠
        const clash = sch.parts.find(q => q.id !== p.id && q.overlaps(p));
        if (clash) { p.x = o.x; p.y = o.y; setStatus('移动受阻：元件不可重叠', 'warn'); }
      }
      sch.rebindWireEndpoints(drag.ids);
      drag.moved = true;
      // 关键：拖动过程中只做增量绘制（改 transform / points），不重建整图
      paintDrag(drag.ids, drag.wireIds);
      return;
    }

    if (drag.mode === 'vertex') {
      const { gx, gy } = toGrid(e);
      const w = sch.wires.find(x => x.id === drag.wireId);
      if (!w) return;
      const v = w.vertices[drag.idx];
      if (!v || v.comp) return;
      const nx = drag.orig.x + (gx - drag.start.gx);
      const ny = drag.orig.y + (gy - drag.start.gy);
      if (v.x === nx && v.y === ny) return;
      v.x = nx; v.y = ny;
      // 用户亲手拖过这个拐点后，就不再让它自动跟随（交还给人工）
      if (v.auto) v.auto = false;
      drag.moved = true;
      paintWireWithHandles(drag.wireId);
      return;
    }

    if (drag.mode === 'wire') {
      const { gx, gy } = toGrid(e);
      const dx = gx - drag.start.gx, dy = gy - drag.start.gy;
      if (!dx && !dy) return;
      const w = sch.wires.find(x => x.id === drag.wireId);
      if (!w) return;
      for (const [i, o] of drag.orig) {
        const v = w.vertices[i];
        if (v && !v.comp) { v.x = o.x + dx; v.y = o.y + dy; }
      }
      drag.moved = true;
      paintWireWithHandles(drag.wireId);
      return;
    }
  });

  svg.addEventListener('pointerup', (e) => {
    // 任何拖动（元件/导线/拐点）结束后都记一条撤销记录
    if (drag && drag.moved) pushHistory();
    // 拖动期间是增量绘制，这里做一次完整重绘：清掉临时 transform、刷新净表/诊断/统计
    if (drag && drag.moved) { sch.refresh(); render(); }

    if (drag && drag.mode === 'move' && !drag.moved && drag.ids && drag.ids.length === 1) {
      if (drag.dblCandidate) {
        // 两次按下之间没有产生位移 → 判定为双击，此时才弹参数框
        lastClickPart = null; lastClickAt = 0;
        const p = sch.parts.find(x => x.id === drag.ids[0]);
        if (p) editPartProps(p);
      } else {
        lastClickPart = drag.ids[0]; lastClickAt = Date.now();
      }
    } else if (drag && drag.moved) {
      // 发生过拖动：清掉点击记录，避免"拖完再点一下"被误判成双击
      lastClickPart = null; lastClickAt = 0;
    }
    drag = null;
    try { svg.releasePointerCapture(e.pointerId); } catch { }
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toSvg(e);
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const nw = Math.min(4000, Math.max(140, vb.w * f));
    const k = nw / vb.w;
    vb.x = p.x - (p.x - vb.x) * k;
    vb.y = p.y - (p.y - vb.y) * k;
    vb.w = nw; vb.h = vb.h * k;
    applyVB();
  }, { passive: false });

  // 拖放放置
  svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  svg.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain') || pendingType;
    if (!type || !DEVICE_DEFS[type]) return;
    const { gx, gy } = toGrid(e);
    const p = sch.addPart(type, gx, gy);
    if (p) { sch.sel = new Set([p.id]); pushHistory(); render(); }
    pendingType = null;
  });

  window.addEventListener('resize', () => applyVB());
}

function pinLabel(hit) {
  const p = sch.parts.find(x => x.id === hit.comp);
  return (p?.def.isMcu ? '' : (p?.label + '.')) + (p?.def.pins[hit.pin]?.name || '?');
}

function onKey(e) {
  if (state.view !== 'circuit') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.key === 'Escape') { pendingType = null; sch.pendingWire = null; sch.sel.clear(); render(); return; }
  if (e.key === 'v' || e.key === 'V') { $('.tool-btn[data-tool=select]').click(); }
  if (e.key === 'w' || e.key === 'W') { $('.tool-btn[data-tool=wire]').click(); }
  if (e.key === 'd' || e.key === 'D') { $('.tool-btn[data-tool=delete]').click(); }
  if (e.key === 'r' || e.key === 'R') { if (sch.sel.size) sch.rotateParts([...sch.sel]); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!sch.sel.size) return;
    e.preventDefault();
    const ids = [...sch.sel];
    const partIds = ids.filter(id => sch.parts.some(p => p.id === id));
    const wireIds = ids.filter(id => sch.wires.some(w => w.id === id));
    if (partIds.length) sch.removeParts(partIds);
    if (wireIds.length) { sch.wires = sch.wires.filter(w => !wireIds.includes(w.id)); sch.refresh(); }
    render(); pushHistory();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
}

/* ================================================================ 预设 / 存取 */
function loadPreset(name, silent = false) {
  const s = PRESETS[name]?.();
  if (!s) return;
  sch.parts = s.parts; sch.wires = s.wires;
  sch.sel.clear(); sch.pendingWire = null;
  sch.refresh();
  render(); fitView(); pushHistory();
  bindCircuit(sch);
  if (!silent) toast('已载入预设电路：' + ($('#presetSelect option[value="' + name + '"]')?.textContent || name), 'ok');
}

async function saveSketch() {
  if (!sch.parts.length) return toast('原理图为空', 'warn');
  const r = await promptBox('保存原理图作品', [
    { name: 'name', label: '作品名称', value: (state.problem?.title || '我的电路') + ' ' + new Date().toLocaleDateString('zh-CN') }
  ]);
  if (!r) return;
  try {
    const id = 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await api('/api/sketches', {
      method: 'POST',
      body: { id, name: r.name, problemId: state.problem?.id || '', json: JSON.stringify(sch.toJSON()) }
    });
    toast('已保存到「我的作品」', 'ok');
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}

async function loadSketchList() {
  try {
    const { sketches } = await api('/api/sketches');
    if (!sketches.length) return toast('还没有保存过作品', 'warn');
    const wrap = document.createElement('div');
    for (const s of sketches) {
      const row = el('div', { class: 'ev-item', style: 'cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
        el('div', {}, [
          el('b', { text: s.name }),
          el('div', { class: 'small muted', text: (s.problem_id || '未关联实验') + ' · ' + new Date(s.updated_at).toLocaleString('zh-CN') })
        ])
      ]);
      const del = el('button', { class: 'btn danger sm', text: '删除' });
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!await confirmBox('删除作品', `确定删除「${s.name}」？`)) return;
        await api('/api/sketches/' + encodeURIComponent(s.id), { method: 'DELETE' });
        row.remove(); toast('已删除', 'ok');
      });
      row.append(del);
      row.addEventListener('click', async (ev) => {
        if (ev.target === del) return;
        const d = await api('/api/sketches/' + encodeURIComponent(s.id));
        sch.loadJSON(JSON.parse(d.sketch.json));
        render(); fitView(); pushHistory(); bindCircuit(sch);
        closeModal(); toast('已载入作品', 'ok');
      });
      wrap.append(row);
    }
    modal('我的原理图作品', wrap);
  } catch (e) { toast(e.message, 'err'); }
}

function exportSvg() {
  if (!sch.parts.length) return toast('原理图为空', 'warn');
  const { svg: inner } = renderSchematic(sch, state.sim || null);
  const bb = schematicBounds(sch);
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.x - 20} ${bb.y - 20} ${bb.w + 40} ${bb.h + 40}" width="${bb.w + 40}" height="${bb.h + 40}">
<rect x="${bb.x - 20}" y="${bb.y - 20}" width="${bb.w + 40}" height="${bb.h + 40}" fill="#ffffff"/>
${inner}</svg>`;
  const blob = new Blob([out], { type: 'image/svg+xml' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'schematic.svg' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出 SVG', 'ok');
}

/* 供外部（仿真视图）调用 */
export function currentSchematic() { return sch; }
export function refreshCircuit() { render(); }

/* ================================================================ 元件参数编辑
 * 提示：仿真按逻辑电平建模（高/低、上拉/下拉、边沿），
 * 阻容/电感/晶振数值用于标注、报告与教学讨论，不参与模拟量计算。
 * 界面上会明确写出这一点，避免学生误以为改了电阻就能改变亮度。
 */
const PROP_SCHEMA = {
  resistor: { key: 'ohm', label: '阻值', fmt: fmtOhm, ex: '220 / 1k / 4.7k' },
  resistor_net: { key: 'ohm', label: '单路阻值', fmt: fmtOhm, ex: '1k / 10k' },
  capacitor: { key: 'farad', label: '容值', fmt: fmtFarad, ex: '30p / 100n / 10u' },
  capacitor_pol: { key: 'farad', label: '容值', fmt: fmtFarad, ex: '10u / 100u' },
  inductor: { key: 'henry', label: '电感', fmt: fmtHenry, ex: '1m / 10u' },
  crystal: { key: 'hz', label: '频率', fmt: fmtHz, ex: '12M / 11.0592M' },
  led: { key: 'vf', label: '正向压降 (V)', fmt: v => v + 'V', ex: '1.8' },
  diode: { key: 'vf', label: '正向压降 (V)', fmt: v => v + 'V', ex: '0.7' }
};

function fmtOhm(v) {
  if (!isFinite(v)) return '';
  if (v >= 1e6) return trim(v / 1e6) + 'MΩ';
  if (v >= 1e3) return trim(v / 1e3) + 'kΩ';
  return trim(v) + 'Ω';
}
function fmtFarad(v) {
  if (v >= 1e-3) return trim(v * 1e3) + 'mF';
  if (v >= 1e-6) return trim(v * 1e6) + 'µF';
  if (v >= 1e-9) return trim(v * 1e9) + 'nF';
  return trim(v * 1e12) + 'pF';
}
function fmtHenry(v) {
  if (v >= 1) return trim(v) + 'H';
  if (v >= 1e-3) return trim(v * 1e3) + 'mH';
  return trim(v * 1e6) + 'µH';
}
function fmtHz(v) {
  if (v >= 1e6) return trim(v / 1e6) + 'MHz';
  if (v >= 1e3) return trim(v / 1e3) + 'kHz';
  return trim(v) + 'Hz';
}
function trim(n) { return String(Number(n.toFixed(4))); }

/** 解析 "4.7k" "100nF" "10u" 这类工程写法 */
function parseSi(text, key) {
  const t = String(text || '').trim().replace(/[，,]/g, '');
  if (!t) return null;
  const m = t.match(/^([0-9]*\.?[0-9]+)\s*([pnuµmkKMGT]?)\s*[A-Za-zΩ]*$/);
  if (!m) return null;
  const num = Number(m[1]);
  if (!isFinite(num)) return null;
  const suf = m[2];
  const scale = {
    'p': 1e-12, 'n': 1e-9, 'u': 1e-6, 'µ': 1e-6, 'm': 1e-3,
    'k': 1e3, 'K': 1e3, 'M': 1e6, 'G': 1e9, 'T': 1e12
  };
  if (!suf) return num;
  // 频率/电感/电容都按 SI 前缀；电阻同理（kΩ/MΩ）
  return num * (scale[suf] || 1);
}

function bindPropsUI() {
  const btn = $('#btnProps');
  if (btn) btn.addEventListener('click', openProps);
  /*
   * 不用原生 dblclick：pointerdown 里会 render() 重建 DOM，
   * 两次点击落在不同节点上，浏览器的双击判定会失效。
   * 改为在 pointerdown 中按"同一元件 + 400ms 内二次按下"自行判定。
   */
}

function openProps() {
  const ids = [...sch.sel].filter(id => sch.parts.some(p => p.id === id));
  if (!ids.length) return toast('请先点选一个元件，或直接双击元件打开属性', 'warn');
  const part = sch.parts.find(p => p.id === ids[0]);
  if (part) editPartProps(part);
}

function editPartProps(part) {
  const schema = PROP_SCHEMA[part.type];
  const wrap = el('div', { class: 'props-form' });
  const inputs = {};

  if (schema) {
    const lab = el('label', {}, [schema.label + '（可直接写 ' + schema.ex + '）']);
    const cur = part.props[schema.key];
    const inp = el('input', { class: 'input', value: schema.fmt ? String(cur).replace(/[^0-9.eE+-]/g, '') : (cur ?? ''), placeholder: schema.ex });
    inputs.__val = inp; lab.append(inp); wrap.append(lab);
  }

  if (part.type === 'led') {
    const lab = el('label', {}, ['发光颜色']);
    const sel = el('select', { class: 'input' });
    for (const [v, t] of [['red', '红'], ['green', '绿'], ['blue', '蓝'], ['amber', '黄']]) {
      sel.append(el('option', { value: v, text: t }));
    }
    sel.value = part.props.color || 'red';
    inputs.__color = sel; lab.append(sel); wrap.append(lab);
  }

  const labText = el('label', {}, ['图上显示文字（留空或保持不变则按数值自动生成）']);
  const inpText = el('input', { class: 'input', value: part.props.text || '', placeholder: '如 220Ω / 10µF' });
  inputs.__text = inpText; inputs.__origText = part.props.text || '';
  labText.append(inpText); wrap.append(labText);

  wrap.append(el('div', {
    class: 'props-note',
    text: '本平台的电路仿真按逻辑电平建模（高/低电平、上拉下拉、边沿触发），阻容/电感/晶振数值用于标注、实验报告与教学讨论，不参与模拟量计算。'
  }));

  modal('元件属性 · ' + part.label, wrap, [
    { label: '取消' },
    {
      label: '应用', primary: true, onClick: () => {
        const ok = applyProps(part, inputs, schema);
        return ok === false ? false : undefined;   // 返回 false 可阻止弹窗关闭
      }
    }
  ]);
}

function applyProps(part, inputs, schema) {
  if (schema) {
    const raw = inputs.__val.value.trim();
    if (raw) {
      const num = parseSi(raw, schema.key);
      if (num === null || !isFinite(num) || num <= 0) {
        toast('数值无法识别：' + raw + '（试试 4.7k / 100n / 12M）', 'err');
        return false;
      }
      part.props[schema.key] = num;
      /*
       * 关键：文本输入框预填的是旧文字。若用户只改了数值，
       * 这个旧文字不能反过来覆盖新数值对应的显示——否则改了 100n 仍显示 30pF。
       * 只有用户**主动改过**文字时才采用它。
       */
      const typed = inputs.__text.value.trim();
      const changed = typed && typed !== (inputs.__origText || '');
      part.props.text = changed ? typed : schema.fmt(num);
    }
  } else {
    const t = inputs.__text.value.trim();
    if (t) part.props.text = t;
  }
  if (inputs.__color) part.props.color = inputs.__color.value;

  sch.refresh();
  try { bindCircuit(sch); } catch { /* 参数不影响逻辑仿真，绑定失败不阻断 */ }
  render();
  pushHistory();
  toast('已更新 ' + part.label + ' 参数：' + (part.props.text || ''), 'ok');
  return true;
}
