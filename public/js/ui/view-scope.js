/*
 * view-scope.js — 虚拟仪器视图
 *   · 逻辑分析仪 / 虚拟示波器：数字通道、触发（上升沿/下降沿/电平/数据字）、
 *     时基缩放、平移、双光标测量、UART/I²C/SPI 协议解码
 *   · 虚拟串口助手：ASCII/HEX、定时发送、与仿真内核或真实串口互通
 *   · 真实硬件：Web Serial 连接 + STC89 ISP 烧录（协议见 docs/research）
 */
import {
  $, $$, el, api, state, toast, bus, esc, fmtDur, hex2, parseHexInput,
  ensureSim, setView, modal
} from './core.js';
import { WebSerialBackend, StcIspProgrammer } from '../scope/instruments.js';

let la = null, serial = null;
let hw = null, isp = null;
let portGroup = 1;
let cursors = [null, null];
let decoded = [];

const COLORS = ['#185abd', '#c0392b', '#1a7f37', '#8e44ad', '#b9770e', '#0e7c86', '#7d3c98', '#5d6d7e'];
const US_PER_CYCLE = 1e6 / (11059200 / 12);   // 每机器周期多少微秒 ≈ 1.0851

/* ================================================================ 初始化 */
export function init() {
  ensureSim();
  la = state.la;
  serial = state.serial;

  buildChannelControls();
  buildTriggerChannels();
  bindToolbar();
  bindSerial();
  bindHardware();

  // 串口助手刷新
  serial.onUpdate = () => renderSerial();

  bus.on('hex-ready', () => {});
  bus.on('relayout', () => draw());
  window.addEventListener('resize', () => draw());

  // 波形区点击放置光标
  $('#scopeCanvas').addEventListener('click', (e) => {
    const t = pickTime(e);
    if (t == null) return;
    if (e.shiftKey) cursors[1] = t; else cursors[0] = t;
    draw(); renderMeasure();
  });
}

export function show() {
  buildChannelControls();
  buildTriggerChannels();
  draw();
  renderSerial();
}

/* ================================================================ 通道 */
function buildChannelControls() {
  const box = $('#laChannels');
  box.innerHTML = '';
  const sel = el('select', { class: 'input sm' });
  [0, 1, 2, 3].forEach(p => sel.append(el('option', { value: p, text: 'P' + p + ' 口', selected: p === portGroup })));
  sel.value = String(portGroup);
  sel.addEventListener('change', () => { portGroup = Number(sel.value); buildChannelControls(); buildTriggerChannels(); draw(); });
  box.append(sel);

  const list = [];
  for (let i = 0; i < 8; i++) {
    const pin = (portGroup << 3) | i;
    const label = 'P' + portGroup + '.' + i;
    const wrap = el('label', { class: 'la-ch' }, []);
    const cb = el('input', { type: 'checkbox', checked: i < 8 });
    cb.dataset.pin = pin;
    cb.addEventListener('change', () => { applyChannels(); draw(); });
    const dot = el('span', { style: `width:8px;height:8px;border-radius:2px;background:${COLORS[i]};display:inline-block` });
    wrap.append(cb, dot, document.createTextNode(label));
    box.append(wrap);
    list.push({ pin, label });
  }
  applyChannels();
}

function activePins() {
  return $$('#laChannels input[type=checkbox]').filter(c => c.checked).map(c => Number(c.dataset.pin));
}

function applyChannels() {
  const pins = activePins();
  const labels = pins.map(p => 'P' + ((p >> 3) & 7) + '.' + (p & 7));
  la.setChannels(pins.map((p, i) => ({ pin: p, label: labels[i] })));
  // 重新导入现有波形以匹配新通道
  if (state.cpu && state.cpu.events.length) la.importEvents(state.cpu.events.slice());
}

function buildTriggerChannels() {
  const sel = $('#laTrigCh');
  const cur = sel.value;
  sel.innerHTML = '<option value="">不触发</option>';
  $$('#laChannels input[type=checkbox]').forEach((c, i) => {
    const p = Number(c.dataset.pin);
    sel.append(el('option', { value: i, text: 'P' + ((p >> 3) & 7) + '.' + (p & 7) }));
  });
  if (cur) sel.value = cur;
}

/* ================================================================ 工具栏 */
function bindToolbar() {
  $('#btnLaCapture').addEventListener('click', async () => {
    const cpu = state.cpu;
    if (!cpu || !cpu.events.length) {
      toast('还没有波形。请先在「仿真运行」中运行程序，再回来采集。', 'warn');
      return;
    }
    applyChannels();
    la.importEvents(cpu.events.slice());
    applyTrigger();
    applyTimebase();
    decoded = runDecode();
    draw(); renderDecoded(); renderMeasure();
    toast(`已采集 ${la.samples.length.toLocaleString()} 个跳变点`, 'ok');
  });

  $('#btnLaClear').addEventListener('click', () => {
    la.clear(); decoded = []; cursors = [null, null];
    draw(); renderDecoded(); renderMeasure();
  });

  $('#btnLaFit').addEventListener('click', () => {
    la.viewStart = la.t0; la.viewSpan = Math.max(1, la.t1 - la.t0);
    draw(); renderMeasure();
  });

  $('#btnLaTrigger').addEventListener('click', () => {
    if (la.triggerTime == null) return toast('当前未检测到触发点，请检查触发设置', 'warn');
    la.viewStart = la.triggerTime - la.viewSpan * 0.45;
    draw(); renderMeasure();
  });

  $('#laTimebase').addEventListener('change', () => { applyTimebase(); draw(); renderMeasure(); });
  $('#laTrigCh').addEventListener('change', () => { applyTrigger(); la.detectTrigger(); draw(); });
  $('#laTrigMode').addEventListener('change', () => { applyTrigger(); la.detectTrigger(); draw(); });
  $('#laTrigWord').addEventListener('change', () => { applyTrigger(); la.detectTrigger(); draw(); });
  $('#laDecode').addEventListener('change', () => {
    decoded = runDecode(); renderDecoded(); draw();
  });

  // 滚轮缩放
  $('#scopeCanvas').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!la.samples.length) return;
    const anchor = pickTime(e) ?? (la.viewStart + la.viewSpan / 2);
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const ns = Math.max(20, Math.min(1e7, la.viewSpan * f));
    const k = ns / la.viewSpan;
    la.viewStart = anchor - (anchor - la.viewStart) * k;
    la.viewSpan = ns;
    draw(); renderMeasure();
  }, { passive: false });

  // 拖动平移
  let pan = null;
  const cv = $('#scopeCanvas');
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !la.samples.length) return;
    pan = { x: e.clientX, start: la.viewStart };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const w = cv.clientWidth || 1;
    la.viewStart = pan.start - (e.clientX - pan.x) * (la.viewSpan / w);
    draw();
  });
  cv.addEventListener('pointerup', (e) => { pan = null; try { cv.releasePointerCapture(e.pointerId); } catch { } });
}

function applyTimebase() {
  const v = $('#laTimebase').value;
  if (v === 'auto') { la.viewSpan = Math.max(1, la.t1 - la.t0); la.viewStart = la.t0; return; }
  const us = { '1us': 1, '5us': 5, '10us': 10, '50us': 50, '100us': 100, '500us': 500, '1ms': 1000, '5ms': 5000, '10ms': 10000 }[v] || 100;
  const span = us * 10 / US_PER_CYCLE;   // 10 格
  const center = la.triggerTime ?? (la.t0 + (la.t1 - la.t0) / 2);
  la.viewSpan = span;
  la.viewStart = center - span / 2;
}

function applyTrigger() {
  const chSel = $('#laTrigCh').value;
  if (chSel === '') { la.setTrigger(null, 'none'); return; }
  const mode = $('#laTrigMode').value;
  let word = 0;
  if (mode === 'word') {
    word = parseInt(String($('#laTrigWord').value).replace(/^0x/i, ''), 16) || 0;
  }
  la.setTrigger(Number(chSel), mode, word, 0xFF);
}

/* ================================================================ 波形绘制 */
function pickTime(e) {
  const cv = $('#scopeCanvas');
  if (!la || !la.samples.length) return null;
  const r = cv.getBoundingClientRect();
  const gutter = 64, right = 12;
  const w = r.width - gutter - right;
  const x = e.clientX - r.left - gutter;
  if (x < 0 || x > w) return null;
  return la.viewStart + (x / w) * la.viewSpan;
}

function draw() {
  const cv = $('#scopeCanvas'), root = $('#scopeRoot');
  if (!cv || !root) return;
  const W = cv.clientWidth || 800, H = cv.clientHeight || 340;
  cv.setAttribute('viewBox', `0 0 ${W} ${H}`);

  if (!la || !la.samples.length) {
    root.innerHTML = `
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fbfcfe"/>
      <text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" font-size="13" fill="#8a94a2">暂无波形</text>
      <text x="${W / 2}" y="${H / 2 + 12}" text-anchor="middle" font-size="11.5" fill="#a8b1bd">
        先在「仿真运行」中运行程序，然后回到此处点击「采集」</text>`;
    return;
  }

  const chans = la.channels;
  const n = chans.length;
  if (!n) { root.innerHTML = ''; return; }

  const gutter = 64, right = 12, top = 18, bottom = 26;
  const plotW = W - gutter - right, plotH = H - top - bottom;
  const laneH = plotH / n;
  const t0 = la.viewStart, t1 = la.viewStart + la.viewSpan;
  const X = (t) => gutter + ((t - t0) / (t1 - t0)) * plotW;

  let s = '';
  // 背景与网格
  s += `<rect x="${gutter}" y="${top}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="#e2e6ec"/>`;
  // 垂直时间网格（10 格）
  for (let i = 0; i <= 10; i++) {
    const x = gutter + (plotW * i) / 10;
    s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" stroke="#eef1f5" stroke-width="1"/>`;
    const tUs = ((t1 - t0) * i / 10) * US_PER_CYCLE;
    s += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#8a94a2" font-family="ui-monospace,monospace">${fmtUs(tUs)}</text>`;
  }
  // 水平分道
  for (let i = 0; i < n; i++) {
    const y0 = top + laneH * i;
    s += `<line x1="${gutter}" y1="${y0}" x2="${gutter + plotW}" y2="${y0}" stroke="#eef1f5"/>`;
    // 车道底色交替
    if (i % 2 === 1) s += `<rect x="${gutter}" y="${y0}" width="${plotW}" height="${laneH}" fill="#fcfdfe"/>`;
  }

  // 通道标签 + 波形
  for (let i = 0; i < n; i++) {
    const cyc = COLORS[i % COLORS.length];
    const laneY = top + laneH * i;
    const yHigh = laneY + laneH * 0.22;
    const yLow = laneY + laneH * 0.78;
    s += `<text x="${gutter - 8}" y="${laneY + laneH / 2 + 3}" text-anchor="end" font-size="10" fill="${cyc}" font-family="ui-monospace,monospace">${esc(chans[i].label)}</text>`;
    const path = buildPath(i, gutter, gutter + plotW, yHigh, yLow, t0, t1);
    s += `<path d="${path}" fill="none" stroke="${cyc}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  // 触发标记
  if (la.triggerTime != null && la.triggerTime >= t0 && la.triggerTime <= t1) {
    const x = X(la.triggerTime);
    s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    s += `<text x="${x + 4}" y="${top + 11}" font-size="9.5" fill="#c0392b">触发</text>`;
  }

  // 光标
  for (let k = 0; k < 2; k++) {
    const t = cursors[k];
    if (t == null || t < t0 || t > t1) continue;
    const x = X(t);
    s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}" stroke="${k ? '#0e7c86' : '#8e44ad'}" stroke-width="1.2"/>`;
    s += `<text x="${x + 3}" y="${top + plotH - 4}" font-size="9.5" fill="${k ? '#0e7c86' : '#8e44ad'}">T${k + 1}</text>`;
  }

  root.innerHTML = s;

  // 串口解码叠加
  if (decoded.length && $('#laDecode').value !== 'none') {
    s = '';
    for (const d of decoded) {
      if (d.t < t0 || d.t > t1) continue;
      const x = X(d.t);
      s += `<circle cx="${x}" cy="${top + 8 + (decoded.indexOf(d) % 3) * 0}" r="2" fill="#8e44ad"/>`;
    }
    root.innerHTML += s;
  }
}

function buildPath(chIdx, x0, x1, yHigh, yLow, t0, t1) {
  // 初始电平
  let cur = 1;
  for (const p of la.samples) { if (p.t > t0) break; cur = (p.v >> chIdx) & 1; }
  let y = cur ? yHigh : yLow;
  let d = `M${x0},${y}`;
  const span = t1 - t0 || 1;
  for (const p of la.samples) {
    if (p.t < t0) continue;
    if (p.t > t1) break;
    const x = x0 + ((p.t - t0) / span) * (x1 - x0);
    const nv = (p.v >> chIdx) & 1;
    if (x - x0 > 0) d += ` L${x.toFixed(2)},${y}`;
    const ny = nv ? yHigh : yLow;
    if (ny !== y) d += ` L${x.toFixed(2)},${ny}`;
    y = ny;
  }
  d += ` L${x1},${y}`;
  return d;
}

function fmtUs(us) {
  if (us === 0) return '0';
  if (Math.abs(us) >= 1000) return (us / 1000).toFixed(2) + ' ms';
  if (Math.abs(us) >= 1) return us.toFixed(us < 10 ? 2 : 1) + ' µs';
  return (us * 1000).toFixed(0) + ' ns';
}

/* ================================================================ 测量 / 解码 */
function renderMeasure() {
  const box = $('#measureBox');
  const chans = la.channels;
  let html = '';
  for (let i = 0; i < chans.length; i++) {
    const m = la.measure(i);
    if (!m.edges) continue;
    html += `<div class="k">${esc(chans[i].label)}</div>
      <div class="v">${m.freq ? m.freq + ' Hz · 占空 ' + m.dutyPct + '%' : '无跳变'}</div>`;
  }
  if (cursors[0] != null && cursors[1] != null) {
    const dtCyc = Math.abs(cursors[1] - cursors[0]);
    const us = dtCyc * US_PER_CYCLE;
    html += `<div class="k">T1→T2</div><div class="v hot">${fmtUs(us)} · 1/${(1e6 / us).toFixed(1)} Hz</div>`;
  } else {
    html += `<div class="k">光标</div><div class="v muted">点击放置 T1，Shift+点击放置 T2</div>`;
  }
  if (decoded.length) html += `<div class="k">解码帧</div><div class="v">${decoded.length} 帧</div>`;
  box.innerHTML = html || '<div class="muted">采集后显示频率/占空比/周期。</div>';
}

function runDecode() {
  const mode = $('#laDecode').value;
  if (mode === 'none' || !la.channels.length) return [];
  const chOf = (name) => la.channels.findIndex(c => c.label === name);
  const specs = [];
  if (mode === 'uart') {
    // 自动找 TXD（P3.1）或第一个通道
    const i = chOf('P3.1');
    specs.push({ type: 'uart', ch: i >= 0 ? i : 0, baud: 9600 });
  } else if (mode === 'i2c') {
    const scl = chOf('P2.0'), sda = chOf('P2.1');
    if (scl >= 0 && sda >= 0) specs.push({ type: 'i2c', scl, sda });
  } else if (mode === 'spi') {
    const sck = chOf('P1.0'), mosi = chOf('P1.1'), cs = chOf('P1.2');
    if (sck >= 0 && mosi >= 0) specs.push({ type: 'spi', sck, mosi, cs: cs >= 0 ? cs : null });
  }
  let r = [];
  try { r = la.runDecoders(specs) || []; } catch { r = []; }
  // UART 重新用实际波特率解码一次（更准确）
  if (mode === 'uart' && state.cpu) {
    const baud = Math.round(state.cpu.baudRate()) || 9600;
    try {
      const i = chOf('P3.1');
      r = la.decodeUART(i >= 0 ? i : 0, baud) || r;
    } catch { }
  }
  return r;
}

function renderDecoded() {
  const box = $('#laDecoded');
  const mode = $('#laDecode').value;
  if (mode === 'none') { box.innerHTML = '<span class="muted">未启用协议解码。</span>'; return; }
  if (!decoded.length) {
    box.innerHTML = `<span class="muted">未解出 ${mode.toUpperCase()} 帧。请确认通道选择正确（UART 默认取 P3.1/TXD，I²C 取 P2.0/P2.1，SPI 取 P1.0/P1.1/P1.2），并已点击「采集」。</span>`;
    return;
  }
  box.innerHTML = decoded.slice(0, 60).map(d => {
    if (d.type === 'UART') {
      return `<div class="dec"><b>UART</b> t=${fmtUs((d.t - la.t0) * US_PER_CYCLE)} · 0x${d.hex} '${esc(d.char)}' · ${d.baud} bps · 停止位${d.stopOk ? '正常' : '异常'}</div>`;
    }
    if (d.type === 'I2C') {
      return `<div class="dec"><b>I²C</b> ${esc(d.kind || '')} 0x${(d.addr ?? 0).toString(16).toUpperCase()} ${d.data != null ? 'data=0x' + d.data.toString(16).toUpperCase() : ''} ${d.ack === false ? 'NACK' : ''}</div>`;
    }
    if (d.type === 'SPI') {
      return `<div class="dec"><b>SPI</b> 0x${(d.byte ?? 0).toString(16).toUpperCase().padStart(2, '0')} (${d.bits ?? 8} bit)</div>`;
    }
    return `<div class="dec">${esc(JSON.stringify(d))}</div>`;
  }).join('');
}

/* ================================================================ 串口助手 */
function bindSerial() {
  $('#serialDisplay').addEventListener('change', () => { serial.display = $('#serialDisplay').value; renderSerial(); });
  $('#btnSerialClear').addEventListener('click', () => { serial.clear(); renderSerial(); });

  const send = async () => {
    const inp = $('#serialInput');
    const text = inp.value;
    if (!text) return;
    const mode = $('#serialInputMode').value;
    const ending = $('#chkAddEnding').checked;
    try {
      await serial.send(text, mode, ending);
      inp.value = '';
      renderSerial();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#btnSerialSend').addEventListener('click', send);
  $('#serialInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  $('#chkTimedSend').addEventListener('change', (e) => {
    if (e.target.checked) {
      const ms = Math.max(50, Number($('#timedSendMs').value) || 1000);
      const text = $('#serialInput').value;
      if (!text) { e.target.checked = false; return toast('请先填写要定时发送的内容', 'warn'); }
      serial.startTimedSend(text, ms, $('#serialInputMode').value);
      toast(`定时发送已开启（每 ${ms} ms）`, 'ok');
    } else { serial.stopTimedSend(); toast('定时发送已停止', ''); }
  });

  // 仿真内核的串口输出 → 助手
  const cpu = state.cpu;
  if (cpu) cpu.onSerialTx = (b) => { serial.rxByte(b, 'sim'); };
}

function renderSerial() {
  const box = $('#serialOut');
  if (!box || !serial) return;
  box.textContent = serial.text() || '（等待数据…仿真运行时，程序中 SBUF 写出的字节会显示在这里；也可发送数据给单片机）';
  box.scrollTop = box.scrollHeight;
}

/* ================================================================ 真实硬件 */
function bindHardware() {
  hw = new WebSerialBackend();
  isp = new StcIspProgrammer(hw);

  const log = (s) => {
    const box = $('#hwLog');
    box.textContent += (box.textContent ? '\n' : '') + s;
    box.scrollTop = box.scrollHeight;
  };
  isp.onLog = log;
  isp.onProgress = (name, ok, info) => {
    if (info && info.total) log(`  进度 ${Math.min(100, Math.round(info.done / info.total * 100))}%`);
  };
  hw.onStatus = (msg, kind) => log(`[串口] ${msg}`);

  if (!WebSerialBackend.supported()) {
    $('#btnSerialConnect').disabled = true;
    $('#btnIspProgram').disabled = true;
    log('当前浏览器不支持 Web Serial（需桌面版 Chrome/Edge，且通过 HTTPS 或 localhost 访问）。');
  }

  $('#btnSerialConnect').addEventListener('click', async () => {
    const btn = $('#btnSerialConnect');
    btn.classList.add('busy');
    try {
      await hw.open({ baudRate: Number($('#hwBaud').value) || 9600 });
      hw.onData = (b) => { serial.rxByte(b, 'real'); renderSerial(); };
      log('已连接真实串口，可在上方串口助手中收发。');
      toast('串口已连接', 'ok');
    } catch (e) { log('连接失败：' + e.message); toast(e.message, 'err'); }
    finally { btn.classList.remove('busy'); }
  });

  $('#btnSerialDisconnect').addEventListener('click', async () => {
    try { await hw.close(); log('已断开串口。'); } catch (e) { log('断开失败：' + e.message); }
  });

  $('#btnIspProgram').addEventListener('click', async () => {
    if (!state.hex) return toast('请先在 IDE 中编译生成 HEX', 'warn');
    if (!WebSerialBackend.supported()) return toast('浏览器不支持 Web Serial', 'err');
    const bin = hexToBinary(state.hex);
    if (!bin.length) return toast('HEX 解析为空', 'err');
    if (!await confirmBox('STC ISP 烧录',
      `即将向目标板烧录 ${bin.length} 字节。\n\n请确认：\n· USB-TTL 为 5V 电平，TX→P3.0、RX→P3.1、GND 共地\n· EA(31 脚) 已接 VCC\n· 点击"开始"后，在 20 秒内给目标板断电再上电（冷启动）`,
      '开始烧录')) return;

    $('#btnIspProgram').classList.add('busy');
    $('#hwLog').textContent = '';
    try {
      if (!hw.port) {
        await hw.open({ baudRate: 2400 });
      } else {
        await hw.setBaudRate(2400);
      }
      log('串口已就绪（2400 bps 握手）。请现在给目标板断电重上电…');
      const r = await isp.program(Uint8Array.from(bin), {
        baudHandshake: 2400,
        baudTransfer: Number($('#hwIspBaud').value) || 115200,
        fosc: 11059200
      });
      if (r.ok) {
        log(`\n✓ 烧录成功：芯片时钟 ≈ ${(r.detectedClock / 1e6).toFixed(4)} MHz，${r.cpu6t ? '6T' : '12T'} 模式，BSL ${r.blVer}`);
        toast('烧录成功，请断电重启运行新程序', 'ok');
      } else {
        log('\n✗ 烧录失败：' + r.error);
        toast('烧录失败：' + r.error, 'err');
      }
    } catch (e) {
      log('✗ ' + e.message);
      toast(e.message, 'err');
    } finally {
      $('#btnIspProgram').classList.remove('busy');
    }
  });
}

/** Intel HEX → 连续二进制（以 0 起始，空洞填 0xFF） */
function hexToBinary(text) {
  let max = 0;
  const map = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== ':') continue;
    const bytes = [];
    for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
    const len = bytes[0], addr = (bytes[1] << 8) | bytes[2], type = bytes[3];
    if (type !== 0x00) { if (type === 0x01) break; continue; }
    for (let i = 0; i < len; i++) { map.set(addr + i, bytes[4 + i]); max = Math.max(max, addr + i); }
  }
  const out = new Uint8Array(max + 1).fill(0xFF);
  for (const [a, v] of map) out[a] = v;
  return out;
}

export { hexToBinary };
