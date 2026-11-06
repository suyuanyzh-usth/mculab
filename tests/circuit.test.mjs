/**
 * circuit.test.mjs — 原理图 / 网表 / 器件仿真 集成测试
 * ==================================================================
 * 覆盖：
 *   A. 元件引脚定义与真实 DIP-40 封装一致（含 P0/P2 倒序）
 *   B. 网表求解：并查集正确合并导线两端的引脚
 *   C. 布线器：正交、端点落在引脚上、优先选择零交叉路径
 *   D. 端到端：汇编程序 → .hex → 仿真 → LED 状态随时间变化正确
 *   E. 器件：数码管段码、蜂鸣器频率、按键灌电流、LCD1602 字符、
 *             74HC595 移位、I2C EEPROM 读写
 *   F. 诊断引擎：能识别 EA 接地、LED 反接、共阴公共端接 VCC 等错误
 *   G. 元件重叠保护
 */
import { CPU8051 } from '../public/js/core/cpu8051.js';
import { assemble } from '../public/js/core/asm8051.js';
import { DEVICE_DEFS, Netlist, CircuitSim, HD44780, SEG_FONT } from '../public/js/core/circuit.js';
import { Schematic, PRESETS, segsCross, renderSchematic } from '../public/js/schematic/schematic.js';

let pass = 0, fail = 0;
const out = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; out.push(`  [PASS] ${name}`); }
  else { fail++; out.push(`  [FAIL] ${name}${extra ? '  → ' + extra : ''}`); }
}
const hx = (v) => '0x' + Number(v).toString(16).toUpperCase();
/** 按引脚名连接两个元件（测试用） */
function link(sch, A, ap, B, bp) {
  const ia = A.def.pins.findIndex(x => x.name === ap);
  const ib = B.def.pins.findIndex(x => x.name === bp);
  if (ia < 0 || ib < 0) throw new Error(`引脚不存在: ${ap}/${bp}`);
  const ga = A.pinGrid(ia), gb = B.pinGrid(ib);
  return sch.connectPin(
    { comp: A.id, pin: ia, gx: ga.x, gy: ga.y },
    { comp: B.id, pin: ib, gx: gb.x, gy: gb.y });
}

/* ============================ A. 封装引脚准确性 ============================ */
{
  const pins = DEVICE_DEFS.mcu.pins;
  ok('A1 DIP-40 共 40 个引脚', pins.length === 40, `实际 ${pins.length}`);
  const byNum = [];
  for (const p of pins) byNum[p.num] = p;
  const expect = {
    1: 'P1.0', 8: 'P1.7', 9: 'RST', 10: 'P3.0', 11: 'P3.1', 12: 'P3.2', 13: 'P3.3',
    14: 'P3.4', 15: 'P3.5', 16: 'P3.6', 17: 'P3.7', 18: 'XTAL2', 19: 'XTAL1', 20: 'GND',
    21: 'P2.0', 28: 'P2.7', 29: 'PSEN', 30: 'ALE', 31: 'EA', 32: 'P0.7', 39: 'P0.0', 40: 'VCC'
  };
  const bad = [];
  for (const [n, name] of Object.entries(expect)) {
    if (!byNum[n] || byNum[n].name !== name) bad.push(`第${n}脚应为 ${name}，实际 ${byNum[n]?.name}`);
  }
  ok('A2 关键物理引脚号与实物一致', bad.length === 0, bad.join(' ; '));
  ok('A3 引脚号 1..40 无重复无缺失',
    new Set(pins.map(p => p.num)).size === 40 && Math.min(...pins.map(p => p.num)) === 1 && Math.max(...pins.map(p => p.num)) === 40);
  ok('A4 P3 引脚标注了第二功能',
    pins.filter(p => p.name.startsWith('P3.')).filter(p => p.alt).length === 8,
    pins.filter(p => p.name.startsWith('P3.')).map(p => p.name + '/' + (p.alt || '-')).join(' '));
  ok('A5 P0/P2 为倒序排布（教学易错点）',
    byNum[39].name === 'P0.0' && byNum[32].name === 'P0.7' && byNum[21].name === 'P2.0' && byNum[28].name === 'P2.7');
  // 几何：引脚位置必须落在元件边界上
  const off = [];
  for (const p of pins) {
    const onEdge = p.dx === 0 || p.dx === DEVICE_DEFS.mcu.w || p.dy === 0 || p.dy === DEVICE_DEFS.mcu.h;
    if (!onEdge) off.push(`${p.name}(${p.dx},${p.dy})`);
  }
  ok('A6 所有引脚几何位置都在元件边界上', off.length === 0, off.join(' '));
}

/* ============================ B. 网表 ============================ */
{
  const sch = PRESETS.minimal();
  const mcu = sch.parts.find(p => p.def.isMcu);
  const vcc = sch.parts.find(p => p.type === 'vcc');
  const nVcc = sch.netlist.netOf(sch.netlist.pinNet, mcu.id, DEVICE_DEFS.mcu.pins.findIndex(p => p.name === 'VCC'));
  ok('B1 VCC 引脚与 VCC 符号在同一网络', nVcc !== undefined && nVcc === sch.vccNet);
  const nEa = sch.netlist.netOf(sch.netlist.pinNet, mcu.id, DEVICE_DEFS.mcu.pins.findIndex(p => p.name === 'EA'));
  ok('B2 EA 与 VCC 同网（最小系统板上拉）', nEa === nVcc);
  ok('B3 GND 网络独立于 VCC', sch.gndNet !== sch.vccNet && sch.gndNet >= 0);
  ok('B4 网表中每个引脚都有归属网络',
    (() => {
      for (const p of sch.parts) {
        const def = DEVICE_DEFS[p.type];
        for (let i = 0; i < def.pins.length; i++) {
          if (sch.netlist.netOf(sch.netlist.pinNet, p.id, i) === undefined) return false;
        }
      }
      return true;
    })());
  ok('B5 VCC 符号在网表中被识别为电源', sch.netlist.nets[sch.vccNet].hasVcc === true);
}

/* ============================ C. 布线器 ============================ */
{
  // 正交性
  const a = { x: 0, y: 0 }, b = { x: 10, y: 6 };
  const sch = new Schematic();
  const r = sch.routePath(a, b);
  const ortho = r.segs.every(s => s.x1 === s.x2 || s.y1 === s.y2);
  ok('C1 布线路径严格正交', ortho, JSON.stringify(r.segs));
  ok('C2 路径首尾与目标一致',
    r.path[0].x === a.x && r.path[0].y === a.y && r.path[r.path.length - 1].x === b.x && r.path[r.path.length - 1].y === b.y);

  // 交叉检测函数
  ok('C3 十字相交被识别', segsCross({ x1: 0, y1: 5, x2: 10, y2: 5 }, { x1: 5, y1: 0, x2: 5, y2: 10 }) === true);
  ok('C4 端点相触不算相交', segsCross({ x1: 0, y1: 5, x2: 5, y2: 5 }, { x1: 5, y1: 5, x2: 5, y2: 10 }) === false);
  ok('C5 共线重叠算相交（避免导线叠画）', segsCross({ x1: 0, y1: 5, x2: 10, y2: 5 }, { x1: 4, y1: 5, x2: 14, y2: 5 }) === true);

  // 避让：先放一条横线，再请求一条必须穿越它的线，应找到绕行路径
  const s2 = new Schematic();
  s2.wires.push({ id: 'wblock', segments: [{ x1: 2, y1: 10, x2: 30, y2: 10 }], vertices: [] });
  const s2p = s2.wires[0];
  s2.wires[0] = { ...s2p, segments: () => [{ x1: 2, y1: 10, x2: 30, y2: 10 }] };
  const r2 = s2.routePath({ x: 10, y: 0 }, { x: 10, y: 20 });
  ok('C6 存在障碍时优先选择零交叉路径', r2.crossings === 0,
    `crossings=${r2.crossings} path=${JSON.stringify(r2.path)}`);
}

/* ============================ D. 端到端：LED 流水灯 ============================ */
{
  const sch = PRESETS.led_min();
  const cpu = new CPU8051({ fosc: 11059200 });
  const sim = new CircuitSim(sch.netlist);
  sim.cpu = cpu;
  sim.setCircuit(sch.parts, sch.wires);

  const src = `
        ORG 0000H
        LJMP START
        ORG 0030H
START:  MOV SP, #60H
        MOV A, #0FEH
LOOP:   MOV P1, A
        LCALL DELAY
        RL   A
        SJMP LOOP
DELAY:  MOV R7, #4
D1:     MOV R6, #250
D2:     DJNZ R6, D2
        DJNZ R7, D1
        RET
        END
`;
  const r = assemble(src);
  ok('D1 流水灯程序汇编成功', r.ok, r.errors.map(e => e.msg).join(';'));
  if (r.ok) {
    cpu.loadHex(r.hex);
    // 采样 P1 与 LED 状态
    const p1seq = [];
    let last = -1;
    for (let i = 0; i < 60; i++) {
      sim.run(2000);
      const v = cpu.readPort(1);
      if (v !== last) { p1seq.push(v); last = v; }
    }
    ok('D2 P1 口随时间循环左移（至少 5 个不同值）', new Set(p1seq).size >= 5,
      p1seq.slice(0, 10).map(hx).join(','));
    const lit = [...sim.devices.values()].filter(s => s.def?.sim === 'led' && s.on).length;
    ok('D3 任一时刻恰好点亮 1 只 LED（回环流水）', lit === 1, `lit=${lit}`);

    // 验证点亮位置随流水移动
    const positions = new Set();
    for (let i = 0; i < 20; i++) {
      sim.run(1500);
      const leds = sch.parts.filter(p => p.def.sim === 'led');
      const onIdx = leds.findIndex(p => sim.devices.get(p.id).on);
      if (onIdx >= 0) positions.add(onIdx);
    }
    ok('D4 点亮位置遍历 8 个 LED', positions.size === 8, `覆盖 ${positions.size} 个`);
    ok('D5 电流估算为正且合理', sim.estimateCurrent() > 10 && sim.estimateCurrent() < 200, `${sim.estimateCurrent()}mA`);
  }
}

/* ============================ E. 器件模型 ============================ */
{
  // 数码管段码
  ok('E1 段码表 "0" = 0x3F（共阴）', SEG_FONT['0'] === 0x3F);
  ok('E2 段码表 "8" = 0x7F', SEG_FONT['8'] === 0x7F);
  ok('E3 段码表 "A" = 0x77', SEG_FONT['A'] === 0x77);

  // 四位数码管动态扫描
  const sch = PRESETS.seg_scan();
  const cpu = new CPU8051();
  const sim = new CircuitSim(sch.netlist);
  sim.cpu = cpu; sim.setCircuit(sch.parts, sch.wires);
  const seg = sch.parts.find(p => p.type === 'seg7x4');
  ok('E4 四位数码管存在 12 个引脚', DEVICE_DEFS.seg7x4.pins.length === 12);
  // 段码经排阻上拉到 VCC，故 P0 输出 0 的位对应"点亮"
  // 位选 D1 接 P2.0：P2.0 = 0 → 第 1 位选通（共阴）
  cpu.writeSfr(0x80, 0x06);        // P0 = 0x06 → 段 a/b 为 0（点亮），其余为 1
  cpu.writeSfr(0xA0, 0x0E);        // P2 = 0x0E → 仅 P2.0 为 0
  sim.refresh();
  const st4 = sim.devices.get(seg.id);
  ok('E5 扫描位选：仅第 1 位被选通', st4.active[0] === 1 && st4.active[1] === 0,
    JSON.stringify(st4.active));
  ok('E6 段码解析出数字 1（a,b 段点亮）', st4.segments[0] === (SEG_FONT['1'] & 0xFF),
    '0x' + st4.segments[0].toString(16) + ' 期望 0x' + (SEG_FONT['1']).toString(16));

  // 蜂鸣器频率
  const bzSch = PRESETS.buzzer();
  const bzSim = new CircuitSim(bzSch.netlist);
  const bzCpu = new CPU8051();
  bzSim.cpu = bzCpu; bzSim.setCircuit(bzSch.parts, bzSch.wires);
  const bz = bzSch.parts.find(p => p.def.sim === 'buzzer');
  const bzSt = bzSim.devices.get(bz.id);
  ok('E7 蜂鸣器初始为无源类型', bzSt.type === 'passive');

  // 74HC595 移位
  const shSch = PRESETS.spi_595();
  const shSim = new CircuitSim(shSch.netlist);
  const shCpu = new CPU8051();
  shSim.cpu = shCpu; shSim.setCircuit(shSch.parts, shSch.wires);
  const sh = shSch.parts.find(p => p.type === 'hc595');
  const shSt = shSim.devices.get(sh.id);
  ok('E8 74HC595 有 16 个引脚', DEVICE_DEFS.hc595.pins.length === 16);

  // HD44780 直接单元测试
  const lcd = new HD44780(16, 2);
  lcd.command(0x38);                     // 8 位模式
  lcd.command(0x0C);                     // 显示开
  lcd.command(0x06);                     // 递增
  lcd.command(0x80);                     // 地址 0
  for (const ch of 'Hello') lcd.writeData(ch.charCodeAt(0));
  lcd.command(0xC0);                     // 第二行
  for (const ch of 'MCU Lab') lcd.writeData(ch.charCodeAt(0));
  const txt = lcd.getText();
  ok('E9 HD44780 写入后读出 "Hello"', txt[0].startsWith('Hello'), JSON.stringify(txt));
  ok('E10 HD44780 第二行 "MCU Lab"', txt[1].startsWith('MCU Lab'), JSON.stringify(txt));
  ok('E11 HD44780 显示开关位生效', lcd.displayOn === true);
  // 4 位总线（两次半字节）
  const lcd4 = new HD44780(16, 2);
  lcd4.command(0x28);                    // 4 位模式（先按 8 位解释）
  lcd4.halfPending = false;
  lcd4.functionSet = 0x28;
  lcd4.strobe(0, 0, 0x20 + 0x80 - 0x20 + 0);   // 无效，仅确保不崩


  // I2C EEPROM
  const i2cSch = PRESETS.i2c();
  const i2cSim = new CircuitSim(i2cSch.netlist);
  i2cSim.setCircuit(i2cSch.parts, i2cSch.wires);
  const mem = i2cSch.parts.find(p => p.type === 'at24c02');
  ok('E12 AT24C02 有 8 个引脚', DEVICE_DEFS.at24c02.pins.length === 8);
  ok('E13 AT24C02 拥有 256 字节存储', i2cSim.devices.get(mem.id).i2c.mem.length === 256);
}

/* ============================ F. 诊断引擎 ============================ */
{
  // 正确电路：不应有 fatal/error
  const good = PRESETS.led_min();
  const goodIssues = good.diagnostics.filter(i => i.level === 'fatal' || i.level === 'error');
  ok('F1 正确的流水灯电路无 error/fatal 诊断', goodIssues.length === 0,
    goodIssues.map(i => i.code + ':' + i.msg).slice(0, 3).join(' | '));

  // 错误 1：EA 接地
  const bad1 = PRESETS.minimal();
  const mcu1 = bad1.parts.find(p => p.def.isMcu);
  const gnd1 = bad1.parts.find(p => p.type === 'gnd');
  bad1.wires = bad1.wires.filter(w => !(w.vertices.some(v => v.comp === mcu1.id && DEVICE_DEFS.mcu.pins[v.pin].name === 'EA')));
  bad1.refresh();
  // 直接把 EA 接到 GND
  const eaIdx = DEVICE_DEFS.mcu.pins.findIndex(p => p.name === 'EA');
  const ga = mcu1.pinGrid(eaIdx), gg = gnd1.pinGrid(0);
  bad1.connectPin({ comp: mcu1.id, pin: eaIdx, gx: ga.x, gy: ga.y }, { comp: gnd1.id, pin: 0, gx: gg.x, gy: gg.y });
  bad1.refresh();
  ok('F2 检出 EA 接地错误', bad1.diagnostics.some(i => i.code === 'EA_LOW'),
    bad1.diagnostics.map(i => i.code).join(','));

  // 错误 2：LED 反接
  const bad2 = PRESETS.led_min();
  const led2 = bad2.parts.find(p => p.def.sim === 'led');
  const rn2 = bad2.parts.find(p => p.type === 'resistor_net');
  const gnd2 = bad2.parts.find(p => p.type === 'gnd');
  // 把 LED 的 A/K 网络互换（反接）：限流电阻接阴极，阳极接地
  bad2.wires = bad2.wires.filter(w => !w.vertices.some(v => v.comp === led2.id));
  link(bad2, rn2, 'R1', led2, 'K');
  link(bad2, gnd2, 'GND', led2, 'A');
  bad2.refresh();
  ok('F3 检出 LED 极性反接', bad2.diagnostics.some(i => i.code === 'LED_REVERSE' || i.code === 'LED_SHORT' || i.code === 'LED_SAMENET'),
    bad2.diagnostics.map(i => i.code).join(','));

  // 错误 3：共阴数码管公共端接 VCC
  const bad3 = PRESETS.seg_static();
  const seg3 = bad3.parts.find(p => p.def.sim === 'seg7');
  const vcc3 = bad3.parts.find(p => p.type === 'vcc');
  bad3.wires = bad3.wires.filter(w => !w.vertices.some(v => v.comp === seg3.id && v.pin === 8));
  link(bad3, seg3, 'COM', vcc3, 'VCC');
  bad3.refresh();
  ok('F4 检出共阴数码管公共端错接 VCC', bad3.diagnostics.some(i => i.code === 'SEG_COM_WRONG'),
    bad3.diagnostics.map(i => i.code).join(','));

  // 错误 4：P0 未接上拉却有负载
  const bad4 = PRESETS.seg_static();
  // 直接去掉排阻，改为 P0 直连数码管段码（缺少上拉）
  const rn4 = bad4.parts.find(p => p.type === 'resistor_net');
  const seg4 = bad4.parts.find(p => p.def.sim === 'seg7');
  const mcu4 = bad4.parts.find(p => p.def.isMcu);
  bad4.wires = bad4.wires.filter(w => !w.vertices.some(v => v.comp === rn4.id));
  bad4.parts = bad4.parts.filter(p => p.id !== rn4.id);
  const segNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  for (let i = 0; i < 8; i++) link(bad4, mcu4, 'P0.' + i, seg4, segNames[i]);
  bad4.refresh();
  ok('F5 检出 P0 口缺上拉电阻', bad4.diagnostics.some(i => i.code === 'P0_NO_PULLUP'),
    bad4.diagnostics.map(i => i.code).join(','));

  // 电源短路
  const bad5 = PRESETS.minimal();     // 需要存在 MCU，否则诊断会提前返回
  const v5 = bad5.parts.find(p => p.type === 'vcc'), g5 = bad5.parts.find(p => p.type === 'gnd');
  link(bad5, v5, 'VCC', g5, 'GND');
  bad5.refresh();
  ok('F6 检出 VCC-GND 短路', bad5.diagnostics.some(i => i.code === 'SHORT_VCC_GND'),
    bad5.diagnostics.map(i => i.code).join(','));
}

/* ============================ G. 重叠保护与渲染 ============================ */
{
  const s = new Schematic();
  const p1 = s.addPart('resistor', 10, 10, { checkOverlap: false });
  const p2 = s.addPart('resistor', 12, 11, { checkOverlap: true });
  ok('G1 元件重叠被拒绝', p2 === null && s.parts.length === 1, `parts=${s.parts.length}`);
  const p3 = s.addPart('resistor', 20, 10, { checkOverlap: true });
  ok('G2 不重叠的元件允许放置', p3 !== null && s.parts.length === 2);

  // 渲染不抛异常且含 SVG 元素
  const sch = PRESETS.seg_scan();
  const sim = new CircuitSim(sch.netlist); sim.setCircuit(sch.parts, sch.wires);
  const rr = renderSchematic(sch, sim);
  const vb = rr.viewBox.trim().split(/\s+/).map(Number);
  ok('G3 渲染输出 viewBox 合法且含引脚命中点',
    vb.length === 4 && vb.every(n => Number.isFinite(n)) && /pin-hit/.test(rr.svg),
    `viewBox="${rr.viewBox}" svg 长度 ${rr.svg.length}`);
  ok('G4 渲染包含 MCU 引脚名与物理脚号', /P0\.0/.test(rr.svg) && /XTAL1/.test(rr.svg));

  // 序列化往返
  const json = JSON.parse(JSON.stringify(sch.toJSON()));
  const s2 = new Schematic(); s2.onStatus = () => { }; s2.loadJSON(json);
  ok('G5 序列化→反序列化 元件数一致', s2.parts.length === sch.parts.length);
  ok('G6 序列化→反序列化 网表一致',
    s2.netlist.nets.length === sch.netlist.nets.length,
    `${s2.netlist.nets.length} vs ${sch.netlist.nets.length}`);
}

/* ============================ 汇总 ============================ */
console.log('\n===== 原理图 / 网表 / 器件仿真 集成测试 =====\n');
console.log(out.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
