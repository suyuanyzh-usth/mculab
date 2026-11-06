/*
 * view-sim.js — 仿真运行视图
 * 运行循环：按墙钟时间换算成 8051 机器周期推进（11.0592MHz/12 = 921600 cyc/s）。
 * 每帧上限保护，避免高速档卡死浏览器。
 */
import { $, el, api, state, toast, bus, esc, fmtDur, hex2, ensureSim, bindCircuit, loadHexIntoSim, setView } from './core.js';
import { renderSchematic, schematicBounds } from '../schematic/schematic.js';

const MCU_CYC_PER_SEC = 11059200 / 12;
let raf = 0, lastT = 0, acc = 0;
let renderAcc = 0;
let autoSwitched = false;
let cycleBudgetTotal = 0;

export function init() {
  $('#btnRun').addEventListener('click', () => state.running ? pause() : run());
  $('#btnPause').addEventListener('click', pause);
  $('#btnStep').addEventListener('click', stepOnce);
  $('#btnResetSim').addEventListener('click', resetSim);
  $('#speedSelect').addEventListener('change', (e) => { state.speed = Number(e.target.value) || 1; });

  bus.on('hex-ready', async ({ hex }) => {
    if (!hex) return;
    try {
      const r = loadHexIntoSim(hex);
      if (r.checksumErrors) toast(`HEX 有 ${r.checksumErrors} 条校验错误`, 'warn');
      state.hex = hex;
      cycleBudgetTotal = 0;
      autoSwitched = false;
      const c = state.cpu;
      setStatus(`已装载程序：${r.loaded} 字节 · 入口 0x0000 · 晶振 11.0592 MHz（${(MCU_CYC_PER_SEC / 1e6).toFixed(4)} M 机器周期/秒）`, 'ok');
      redraw(); updatePanels();
    } catch (e) { toast('装载失败：' + e.message, 'err'); }
  });

  bus.on('sim-focus', () => { redraw(); });

  // 串口数据 → 串口助手
  bus.on('serial-byte', () => { });
}

export function show() {
  redraw();
  updatePanels();
  if (!state.hex) setStatus('尚未装载程序。请先在「代码 IDE」中编译，或在 IDE 里加载 .hex 文件。', 'warn');
}

/* ================================================================ 运行控制 */
function prepare() {
  ensureSim();
  if (!state.sch) { toast('还没有原理图，已为你载入默认电路', 'warn'); return false; }
  bindCircuit(state.sch);
  return true;
}

function run() {
  if (!prepare()) return;
  if (!state.hex) { toast('请先编译生成 HEX（IDE → 编译，Ctrl+B）', 'warn'); return; }
  if (!state.cpu.code.some(b => b !== 0)) { loadHexIntoSim(state.hex); }
  state.running = true;
  lastT = performance.now();
  acc = 0; renderAcc = 0;
  $('#btnRun').textContent = '运行中…';
  $('#btnRun').classList.add('primary');
  setStatus('运行中…', 'ok');
  raf = requestAnimationFrame(loop);
}

function pause() {
  state.running = false;
  cancelAnimationFrame(raf);
  $('#btnRun').textContent = '运行';
  const c = state.cpu;
  if (c) {
    setStatus(`已暂停 · ${c.instrCount.toLocaleString()} 条指令 · 仿真 ${fmtDur(c.timeUs())} · ${c.cycles.toLocaleString()} 机器周期`, 'warn');
    state.evidence.simCycles = c.cycles;
    state.evidence.simAt = Date.now();
    state.evidence.portEvents = c.events.length;
    // 冻结一份波形给仪器
    if (state.la) state.la.importEvents(c.events.slice());
  }
  updatePanels();
  redraw();
}

function loop(t) {
  if (!state.running) return;
  const dt = Math.min(0.1, (t - lastT) / 1000);   // 单帧最多按 100ms 计，避免切标签后暴冲
  lastT = t;
  const want = dt * MCU_CYC_PER_SEC * state.speed + acc;
  // 每帧上限：保证 UI 有响应（约 300k 周期 ≈ 0.33 秒仿真）
  let budget = Math.min(want, 320000);
  const spend = Math.floor(budget);
  acc = Math.max(0, want - spend);

  const c = state.cpu;
  try {
    state.sim.run(spend);
  } catch (e) {
    pause();
    toast('仿真异常：' + e.message, 'err');
    return;
  }
  cycleBudgetTotal += spend;

  // 波形采集（按通道过滤，控制内存）
  if (state.la && c.events.length > state.la.capacity * 0.9) c.events.splice(0, 50000);

  // 面板刷新节流 ~15fps
  renderAcc += dt;
  if (renderAcc > 1 / 15) { renderAcc = 0; redraw(); updatePanels(); }

  // 串口输出 → 串口助手
  flushSerial();

  // 自动切换仪器视图（一次性）
  if (!autoSwitched && $('#chkFollow').checked && c.txBytes.length >= 4) {
    autoSwitched = true;
    state.la && state.la.importEvents(c.events.slice());
    toast('检测到串口数据，已切换到「仪器」视图（可在仿真面板关闭自动切换）', '');
    setView('scope');
    return;
  }
  raf = requestAnimationFrame(loop);
}

function stepOnce() {
  if (!prepare()) return;
  if (!state.hex) return toast('请先编译或加载 HEX', 'warn');
  if (!state.cpu.code.some(b => b !== 0)) loadHexIntoSim(state.hex);
  state.running = false;
  cancelAnimationFrame(raf);
  const c = state.cpu;
  const cyc = state.sim.step();
  cycleBudgetTotal += cyc;
  const st = c.dumpState();
  setStatus(`单步：PC=0x${st.pc.toString(16).toUpperCase().padStart(4, '0')} · 本条 ${cyc} 周期 · 累计 ${st.cycles} 周期`, '');
  redraw(); updatePanels();
  flushSerial();
}

function resetSim() {
  if (!prepare()) return;
  state.running = false;
  cancelAnimationFrame(raf);
  if (state.hex) loadHexIntoSim(state.hex);
  else state.sim.reset();
  cycleBudgetTotal = 0; autoSwitched = false;
  $('#btnRun').textContent = '运行';
  setStatus('已复位。PC 归零，端口恢复高电平。', '');
  redraw(); updatePanels();
}

/* ================================================================ 渲染 */
function redraw() {
  const svg = $('#simCanvas'), root = $('#simRoot');
  if (!svg || !state.sch) return;
  // 绘制前强制刷新一次器件状态：sim.run() 内部每 18 个机器周期刷新一次，
  // 若在此间隙暂停/单步，LED/数码管会显示上一拍的状态（曾出现 1 步延迟）。
  if (state.sim && state.sim.cpu) state.sim.refresh();
  const { svg: inner } = renderSchematic(state.sch, state.sim || null);
  root.innerHTML = inner;
  const bb = schematicBounds(state.sch);
  const pad = 50;
  svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${Math.max(bb.w + pad * 2, 320)} ${Math.max(bb.h + pad * 2, 240)}`);
}

function setStatus(msg, kind = '') {
  const b = $('#simStatus');
  b.className = 'statusbar ' + (kind === 'warn' ? 'warn' : kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '');
  b.innerHTML = esc(msg);
}

const pswBit = (psw, m) => (psw & m) ? 1 : 0;

function updatePanels() {
  const c = state.cpu;
  if (!c) return;
  const s = c.dumpState();
  const grid = $('#cpuState');
  const row = (k, v, cls = '') => `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`;
  grid.innerHTML =
    row('PC', '0x' + s.pc.toString(16).toUpperCase().padStart(4, '0'), 'cool') +
    row('DPTR', '0x' + s.dptr.toString(16).toUpperCase().padStart(4, '0')) +
    row('ACC', hex2(s.a)) + row('B', hex2(s.b)) +
    row('SP', hex2(s.sp)) + row('PSW', hex2(s.psw)) +
    row('CY / AC', `${pswBit(s.psw, 0x80)} / ${pswBit(s.psw, 0x40)}`) +
    row('OV / P', `${pswBit(s.psw, 0x02)} / ${pswBit(s.psw, 0x01)}`) +
    row('P0 / P1', `${hex2(s.p0)} ${hex2(s.p1)}`) +
    row('P2 / P3', `${hex2(s.p2)} ${hex2(s.p3)}`) +
    row('TCON/TMOD', `${hex2(s.tcon)} ${hex2(s.tmod)}`) +
    row('TH0/TL0', `${hex2(s.th0)} ${hex2(s.tl0)}`) +
    row('TH1/TL1', `${hex2(s.th1)} ${hex2(s.tl1)}`) +
    row('SCON', hex2(s.scon)) +
    row('波特率', s.baud ? Math.round(s.baud) + ' bps' : '—') +
    row('R0–R7', s.r.map(v => v.toString(16).toUpperCase().padStart(2, '0')).join(' ')) +
    row('机器周期', s.cycles.toLocaleString()) +
    row('仿真时间', fmtDur(s.timeUs));

  // 反汇编：当前位置前后各 6 条
  let addr = s.pc, lines = [];
  // 向前回退若干条（用简单回溯：从 pc-18 开始顺序解码到 pc）
  let start = Math.max(0, s.pc - 18);
  let cur = start;
  const decoded = [];
  let guard = 0;
  while (cur <= s.pc + 12 && guard++ < 40) {
    const d = c.disasm(cur);
    decoded.push({ addr: cur, text: d.text, len: d.len });
    cur += d.len;
  }
  const hit = decoded.findIndex(d => d.addr === s.pc);
  const view = decoded.slice(Math.max(0, (hit < 0 ? decoded.length - 1 : hit) - 4), (hit < 0 ? decoded.length : hit) + 8);
  $('#disasmView').innerHTML = view.map(d =>
    `${d.addr === s.pc ? '▶' : ' '} ${d.addr.toString(16).toUpperCase().padStart(4, '0')}  ${esc(d.text)}`
  ).join('\n');

  // RAM 0x20–0x7F
  const rows = [];
  for (let a = 0x20; a < 0x80; a += 8) {
    const bytes = [];
    for (let i = 0; i < 8; i++) bytes.push(c.iram[a + i].toString(16).toUpperCase().padStart(2, '0'));
    rows.push(a.toString(16).toUpperCase().padStart(2, '0') + ': ' + bytes.join(' '));
  }
  $('#ramView').textContent = rows.join('\n');

  state.evidence.simCycles = s.cycles;
  state.evidence.portEvents = c.events.length;
}

/* ================================================================ 串口转发 */
let lastTxCount = 0;
function flushSerial() {
  const c = state.cpu;
  if (!c || !state.serial) return;
  const bytes = c.drainTx();
  if (!bytes.length) return;
  for (const b of bytes) state.serial.rxByte(b, 'sim');
  state.evidence.serialLog = (state.evidence.serialLog + String.fromCharCode(...bytes)).slice(-4000);
}
