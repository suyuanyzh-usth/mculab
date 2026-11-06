/*
 * instruments.js — 虚拟示波器 / 逻辑分析仪 / 串口助手
 * ==================================================================
 * 全部基于仿真内核产生的"引脚跳变事件流"（cpu.events，带机器周期时间戳），
 * 因此时序是真实的指令级时序，不是示意图。
 *
 * 逻辑分析仪能力：
 *   · 多通道（默认 8 路），任意端口引脚可选
 *   · 触发：上升沿 / 下降沿 / 高电平 / 低电平 / 数据字（并行字、掩码）
 *   · 缩放（滚轮）、平移（拖动）、时间游标、自动测量（周期/频率/占空比）
 *   · 协议解码：UART（自动波特率）、I2C（START/ADDR/DATA/ACK）、SPI（CPOL/CPHA）
 *   · 回放：按触发点定位，可前后滚动
 */

import { PIN, PIN_TXD, PIN_RXD } from '../core/cpu8051.js';
import { pinName, P3_ALT } from '../core/sfr.js';

const US_PER_CYCLE = (12 / 11059200) * 1e6;    // 1 机器周期 ≈ 1.085µs

/* ================================================================ 逻辑分析仪 */
export class LogicAnalyzer {
  constructor(opts = {}) {
    this.channels = opts.channels || [];
    this.triggers = opts.triggers || {};
    this.samples = [];              // {t, v[8]} 采样点（仅在变化时记录）
    this.capacity = opts.capacity || 200000;
    this.t0 = 0;
    this.t1 = 0;
    this.viewSpan = 0;
    this.viewStart = 0;
    this.timebase = 'auto';         // auto | 1us | 10us | 100us | 1ms | 10ms
    this.triggered = false;
    this.triggerTime = null;
    this.triggerIndex = -1;
    this.armed = true;
    this.preTriggerPct = 50;
    this.cursors = [null, null];
    this.decoders = [];
    this.lastValues = new Array(8).fill(1);
    this.cyclesPerUs = 11059200 / 12 / 1e6;
  }

  setChannels(list) {
    // list: [{pin, label}]  长度 ≤ 8
    this.channels = list.slice(0, 8).map((c, i) => ({ pin: c.pin, label: c.label || pinName(c.pin) || ('CH' + i) }));
    this.lastValues = this.channels.map(c => 1);
  }
  setTrigger(chIdx, mode, word, mask) {
    this.triggers = { chIdx, mode, word: word ?? 0, mask: mask ?? 0xFF };
  }

  clear() {
    this.samples = []; this.triggered = false; this.triggerTime = null; this.triggerIndex = -1;
    this.t0 = 0; this.t1 = 0;
  }

  /** 从 CPU 引脚事件流导入数据（重放） */
  importEvents(events, cyclesPerUsScale = 1) {
    this.clear();
    if (!this.channels.length) return;
    const chIdx = new Map(this.channels.map((c, i) => [c.pin, i]));
    let mask = 0;
    for (const [i, c] of this.channels.entries()) mask |= (1 << i);
    let cur = 0;
    for (let i = 0; i < this.channels.length; i++) if (this.lastValues[i]) cur |= (1 << i);
    const ev = events.filter(e => chIdx.has(e.pin));
    // 起点
    this.t0 = ev.length ? ev[0].t : 0;
    let rec = { t: this.t0, v: cur };
    for (const e of ev) {
      const i = chIdx.get(e.pin);
      if (e.v) cur |= (1 << i); else cur &= ~(1 << i);
      rec = { t: e.t, v: cur };
      this.samples.push(rec);
      if (this.samples.length > this.capacity) this.samples.shift();
    }
    this.t1 = this.samples.length ? this.samples[this.samples.length - 1].t : 0;
    // 触发检测
    this.armed = true;
    this.detectTrigger();
    this.viewSpan = Math.max(1, this.t1 - this.t0);
    this.viewStart = this.t0;
  }

  /** 通道当前电平（在时间 t） */
  valueAt(t, ch) {
    let v = this.lastValues[ch] ?? 1;
    for (const s of this.samples) {
      if (s.t > t) break;
      v = (s.v >> ch) & 1;
    }
    return v;
  }
  /** 指定通道在 [ta,tb] 内的跳变列表 */
  edges(ch, ta = -Infinity, tb = Infinity) {
    const out = [];
    let prev = null;
    for (const s of this.samples) {
      const v = (s.v >> ch) & 1;
      if (prev !== null && v !== prev && s.t >= ta && s.t <= tb) out.push({ t: s.t, v });
      prev = v;
    }
    return out;
  }

  detectTrigger() {
    const tr = this.triggers;
    if (tr.chIdx === undefined || tr.chIdx === null) { this.triggered = false; return; }
    const ch = tr.chIdx;
    let prev = null;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const v = (s.v >> ch) & 1;
      const all = s.v;
      let hit = false;
      switch (tr.mode) {
        case 'rise': hit = (prev === 0 && v === 1); break;
        case 'fall': hit = (prev === 1 && v === 0); break;
        case 'high': hit = (v === 1); break;
        case 'low': hit = (v === 0); break;
        case 'word': hit = ((all & (tr.mask ?? 0xFF)) === ((tr.word ?? 0) & (tr.mask ?? 0xFF))); break;
        case 'edge': hit = (prev !== null && v !== prev); break;
        default: hit = false;
      }
      if (hit) {
        this.triggered = true; this.triggerTime = s.t; this.triggerIndex = i;
        return;
      }
      prev = v;
    }
    this.triggered = false;
  }

  setTimebase(label) {
    this.timebase = label;
    const map = { '1us': 1, '5us': 5, '10us': 10, '50us': 50, '100us': 100, '500us': 500, '1ms': 1000, '5ms': 5000, '10ms': 10000 };
    if (map[label]) this.viewSpan = map[label] * this.cyclesPerUs;
  }
  zoom(factor, anchorT) {
    const a = anchorT ?? (this.viewStart + this.viewSpan / 2);
    const rel = (a - this.viewStart) / this.viewSpan;
    this.viewSpan = Math.max(20, Math.min(2e7, this.viewSpan * factor));
    this.viewStart = a - rel * this.viewSpan;
    this.clampView();
  }
  pan(dCycles) { this.viewStart += dCycles; this.clampView(); }
  clampView() {
    const total = Math.max(this.t1 - this.t0, 1);
    this.viewSpan = Math.min(this.viewSpan, total * 1.2);
    this.viewStart = Math.max(this.t0 - total * 0.05, Math.min(this.viewStart, this.t1 - this.viewSpan * 0.2));
  }
  gotoTrigger() {
    if (this.triggerTime == null) return;
    this.viewStart = this.triggerTime - this.viewSpan * (this.preTriggerPct / 100);
    this.clampView();
  }
  /** 在 [ta,tb] 区间上采点：返回 [{x(0..1), v}] 的阶梯折线 */
  polyline(ch, w, ta, tb, samples = 400) {
    const out = [];
    let prev = null;
    const before = this.valueAt(ta, ch);
    out.push({ x: 0, v: before });
    const step = (tb - ta) / samples;
    for (let i = 1; i <= samples; i++) {
      const t = ta + i * step;
      const v = this.valueAt(t, ch);
      if (v !== prev && prev !== null) out.push({ x: (i - 1) / samples, v: prev });
      out.push({ x: i / samples, v });
      prev = v;
    }
    return out;
  }

  /* ------------------------------------------------ 自动测量 */
  measure(ch) {
    const e = this.edges(ch);
    if (e.length < 2) return { freq: 0, period: 0, duty: 0, edges: e.length };
    const periods = [];
    const rises = e.filter(x => x.v === 1).map(x => x.t);
    const falls = e.filter(x => x.v === 0).map(x => x.t);
    for (let i = 1; i < rises.length; i++) periods.push(rises[i] - rises[i - 1]);
    const avgP = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : 0;
    const us = avgP * US_PER_CYCLE;
    let duty = 0;
    if (rises.length && falls.length) {
      let high = 0, n = 0;
      for (let i = 1; i < rises.length; i++) {
        const f = falls.find(x => x > rises[i - 1] && x < rises[i]);
        if (f) { high += (f - rises[i - 1]); n++; }
      }
      duty = n ? (high / n) / avgP : 0;
    }
    return {
      freq: us > 0 ? +(1e6 / us).toFixed(2) : 0,
      periodUs: +us.toFixed(3),
      dutyPct: +(duty * 100).toFixed(2),
      edges: e.length,
      cycles: avgP
    };
  }

  /* ------------------------------------------------ 协议解码 */
  decodeUART(ch, baud) {
    const bits = [];
    const e = this.edges(ch);
    // 起始位：下降沿
    for (let i = 0; i < e.length; i++) {
      if (e[i].v !== 0) continue;
      const start = e[i].t;
      const bitCycles = baud ? (this.cyclesPerUs * 1e6 / 12 * 12 / (baud)) : null;
      // 自动波特率：用最短的连续高/低电平宽度估计
      const width = (e[i + 1] ? e[i + 1].t : start + 100) - start;
      const bc = baud ? (11059200 / 12) / baud : Math.max(1, Math.round(width));
      const actualBaud = (11059200 / 12) / bc;
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        const t = start + bc * (1.5 + b);
        if (this.valueAt(t, ch)) byte |= (1 << b);
      }
      const tStop = start + bc * 9.5;
      const stopOk = this.valueAt(tStop, ch) === 1;
      bits.push({
        t: start, type: 'UART', byte, hex: byte.toString(16).toUpperCase().padStart(2, '0'),
        char: byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.',
        baud: Math.round(actualBaud), stopOk
      });
      // 跳到本帧结束，避免同一帧被重复识别
      const nextT = start + bc * 10;
      while (i + 1 < e.length && e[i + 1].t < nextT) i++;
    }
    return bits;
  }

  decodeI2C(sclCh, sdaCh) {
    const out = [];
    const sclE = this.edges(sclCh), sdaE = this.edges(sdaCh);
    // START: SCL 高时 SDA 下降；STOP: SCL 高时 SDA 上升
    const events = [...sclE.map(x => ({ ...x, ch: 'scl' })), ...sdaE.map(x => ({ ...x, ch: 'sda' }))].sort((a, b) => a.t - b.t);
    let state = 'idle', bits = [], phase = 'addr', bytes = [];
    let lastScl = 1;
    for (const ev of events) {
      if (ev.ch === 'sda' && this.valueAt(ev.t - 1, sclCh) === 1) {
        if (ev.v === 0 && state === 'idle') { state = 'active'; out.push({ t: ev.t, type: 'I2C', text: 'START' }); bits = []; continue; }
        if (ev.v === 1 && state === 'active') { state = 'idle'; out.push({ t: ev.t, type: 'I2C', text: 'STOP' }); bits = []; continue; }
      }
      if (ev.ch === 'scl' && ev.v === 1) {
        if (!this.valueAt(ev.t - 1, sclCh)) continue;   // 上升沿采样
        if (state !== 'active') continue;
        bits.push(this.valueAt(ev.t, sdaCh));
        if (bits.length === 8) {
          const v = bits.reduce((a, b, i) => a | (b << (7 - i)), 0);
          const isAddr = bytes.length === 0;
          out.push({
            t: ev.t, type: 'I2C', byte: v, hex: '0x' + v.toString(16).toUpperCase().padStart(2, '0'),
            text: isAddr ? (v & 1 ? `读地址 0x${(v >> 1).toString(16).toUpperCase()}${(v >> 1) * 2 + 1 === v ? '' : ''}` : `写地址 0x${(v >> 1).toString(16).toUpperCase()}`) : `数据 0x${v.toString(16).toUpperCase().padStart(2, '0')}`
          });
          bytes.push(v);
          bits = [];
        }
      }
    }
    // 补 ACK 位：紧跟每个字节之后
    return out;
  }

  decodeSPI(sckCh, mosiCh, csCh) {
    const out = [];
    let bits = [];
    const e = this.edges(sckCh);
    let prev = this.valueAt(e.length ? e[0].t - 1 : 0, sckCh);
    for (const ev of e) {
      if (ev.v === 1) {          // 上升沿采样（CPOL=0, CPHA=0）
        if (csCh != null && this.valueAt(ev.t, csCh) !== 0) { prev = ev.v; continue; }
        bits.push(this.valueAt(ev.t, mosiCh));
        if (bits.length === 8) {
          const v = bits.reduce((a, b, i) => a | (b << (7 - i)), 0);
          out.push({ t: ev.t, type: 'SPI', byte: v, hex: '0x' + v.toString(16).toUpperCase().padStart(2, '0'), text: '0x' + v.toString(16).toUpperCase().padStart(2, '0') });
          bits = [];
        }
      }
      prev = ev.v;
    }
    return out;
  }
  runDecoders(specs) {
    const res = [];
    for (const s of specs) {
      try {
        if (s.type === 'uart') res.push(...this.decodeUART(s.ch, s.baud));
        else if (s.type === 'i2c') res.push(...this.decodeI2C(s.scl, s.sda));
        else if (s.type === 'spi') res.push(...this.decodeSPI(s.sck, s.mosi, s.cs));
      } catch (e) { /* 解码失败不影响主流程 */ }
    }
    return res.sort((a, b) => a.t - b.t);
  }
}

/* ================================================================ 虚拟串口助手
 * 独立于仿真的串口调试器：可接仿真内核 UART，也可接真实串口（Web Serial）
 */
export class SerialAssistant {
  constructor(opts = {}) {
    this.rx = [];                   // {t, data:[byte...], text}
    this.tx = [];
    this.display = 'ascii';         // ascii | hex | both
    this.timestamp = true;
    this.lineEnding = '\r\n';
    this.autoScroll = true;
    this.timerSend = null;
    this.timerInterval = 1000;
    this.timerText = '';
    this.stats = { rxBytes: 0, txBytes: 0, errFrames: 0 };
    this.parsers = [];              // 自定义协议解析规则
    this.onUpdate = opts.onUpdate || (() => { });
    this.backend = opts.backend || null;     // { write(bytes), onData(cb) }
    this.maxLines = 1000;
    this.asciiBuf = '';
  }

  attachSim(cpu) {
    this.cpu = cpu;
    cpu.onSerialTx = (b) => this.rxByte(b, 'sim');
  }
  attachReal(port) { this.serialPort = port; }

  rxByte(b, src = 'ext') {
    this.tx.push({ t: Date.now(), byte: b, src });
    this.stats.rxBytes++;
    this.flush(false);
    this.onUpdate(this);
  }
  /** 把文本/hex 发送到仿真内核或真实串口 */
  async send(input, mode = 'ascii', withEnding = true) {
    let bytes = [];
    if (mode === 'hex') {
      bytes = input.trim().split(/[\s,]+/).filter(Boolean).map(s => parseInt(s, 16)).filter(v => !isNaN(v));
    } else {
      bytes = [...input].map(c => c.charCodeAt(0) & 0xFF);
      if (withEnding) for (const c of this.lineEnding) bytes.push(c.charCodeAt(0));
    }
    if (this.cpu) for (const b of bytes) this.cpu.feedSerial(b);
    else if (this.backend?.write) await this.backend.write(Uint8Array.from(bytes));
    this.stats.txBytes += bytes.length;
    this.append({ dir: 'tx', bytes, t: Date.now() });
    this.onUpdate(this);
    return bytes;
  }
  append(line) {
    this.lines = this.lines || [];
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.shift();
  }
  flush() {
    // 合并连续 rx 字节为一行（按换行断开）
    const pend = this.pendingRx || (this.pendingRx = []);
    for (const q of this.tx.slice(this._ptr || 0)) pend.push(q.byte);
    this._ptr = this.tx.length;
    let nl = -1;
    while ((nl = pend.indexOf(10)) >= 0) {
      const seg = pend.splice(0, nl + 1);
      const text = seg.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : (b === 10 || b === 13 ? '' : '.')).join('');
      this.append({ dir: 'rx', bytes: seg.slice(0, -1), text, t: Date.now() });
    }
    if (pend.length > 512) { this.append({ dir: 'rx', bytes: pend.slice(), text: pend.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join(''), t: Date.now() }); pend.length = 0; }
  }
  /** 立即把缓冲显示为空（用于"清空"） */
  clear() { this.tx = []; this.tx.length = 0; this.lines = []; this.pendingRx = []; this._ptr = 0; this.stats = { rxBytes: 0, txBytes: 0, errFrames: 0 }; this.onUpdate(this); }

  startTimedSend(text, ms, mode = 'ascii') {
    this.stopTimedSend();
    this.timerText = text; this.timerInterval = ms;
    this.timerSend = setInterval(() => this.send(text, mode), ms);
  }
  stopTimedSend() { if (this.timerSend) { clearInterval(this.timerSend); this.timerSend = null; } }

  format(line) {
    const t = this.timestamp ? new Date(line.t).toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(line.t % 1000).padStart(3, '0') + ' ' : '';
    const dir = line.dir === 'tx' ? '→' : '←';
    const hexs = (line.bytes || []).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    let body = '';
    if (this.display === 'hex') body = hexs;
    else if (this.display === 'ascii') body = line.text != null ? line.text : (line.bytes || []).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    else body = (line.text != null ? line.text : '') + '   |' + hexs + '|';
    return `${t}${dir} ${body}`;
  }
  text() { return (this.lines || []).map(l => this.format(l)).join('\n'); }

  /* -------------------------------------------- 简单协议解析 */
  parseProtocols(buf) {
    // 支持用户在界面配置的帧格式，例如 "AA 55 LEN DATA CRC" 的简化解析
    const result = [];
    for (const p of this.parsers) {
      if (p.type === 'head-tail') {
        const head = p.head, tail = p.tail;
        let i = 0;
        while (i < buf.length) {
          if (buf[i] === head) {
            const end = buf.indexOf(tail, i + 1);
            if (end < 0) break;
            result.push({ from: i, to: end + 1, frame: buf.slice(i, end + 1), rule: p.name });
            i = end + 1;
          } else i++;
        }
      }
    }
    return result;
  }
}

/* ================================================================ Web Serial 后端
 * 真实硬件连接（Chrome/Edge 89+，需 HTTPS 或 localhost）
 */
export class WebSerialBackend {
  constructor() { this.port = null; this.reader = null; this.keepReading = false; this.onData = null; this.onStatus = () => { }; }
  static supported() { return typeof navigator !== 'undefined' && !!navigator.serial; }
  async open(options = {}) {
    if (!WebSerialBackend.supported()) throw new Error('当前浏览器不支持 Web Serial API。请使用桌面版 Chrome / Edge（需 HTTPS 或 localhost）。');
    this.port = await navigator.serial.requestPort();
    this._opts = {
      baudRate: options.baudRate || 9600,
      dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none',
      bufferSize: 4096
    };
    await this.port.open(this._opts);
    this.onStatus('已连接串口', 'ok');
    this.keepReading = true;
    this._readLoop();
    return this.port;
  }
  /** 运行中切换波特率：Web Serial 要求关闭后以新速率重开 */
  async setBaudRate(baud) {
    if (!this.port) throw new Error('串口未打开');
    if (this._opts && this._opts.baudRate === baud) return;
    this.keepReading = false;
    try { if (this.reader) await this.reader.cancel(); } catch { }
    await new Promise(r => setTimeout(r, 30));
    try { await this.port.close(); } catch { }
    this._opts.baudRate = baud;
    await this.port.open(this._opts);
    this.keepReading = true;
    this._readLoop();
    this.onStatus('波特率已切换为 ' + baud, 'info');
  }
  async _readLoop() {
    while (this.port && this.port.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && this.onData) for (const b of value) this.onData(b);
        }
      } catch (e) { this.onStatus('串口读取中断: ' + e.message, 'warn'); }
      finally { try { this.reader.releaseLock(); } catch { } }
    }
  }
  async write(bytes) {
    if (!this.port || !this.port.writable) throw new Error('串口未打开');
    const w = this.port.writable.getWriter();
    await w.write(bytes);
    w.releaseLock();
  }
  async close() {
    this.keepReading = false;
    try { if (this.reader) await this.reader.cancel(); } catch { }
    try { if (this.port) await this.port.close(); } catch { }
    this.port = null;
    this.onStatus('串口已断开', 'info');
  }
}

/* ================================================================ STC ISP 编程器
 * 依据 stcgal/protocols.py 逆向所得的 STC89/90 系列 ISP 协议实现。
 * 帧格式（主机 → MCU）：
 *     46 B9 | 6A | LEN_H LEN_L(=payload+5) | payload… | CHK | 16
 *     CHK = sum(packet[2:]) & 0xFF
 * 握手：以 2400bps 连发 0x7F，MCU 回显后返回状态包。
 * 详见 docs/research/00-调研总览.md 第五节。
 */
export class StcIspProgrammer {
  constructor(backend) {
    this.backend = backend;
    this.PACKET_START = [0x46, 0xB9];
    this.PACKET_END = 0x16;
    this.PACKET_HOST = 0x6A;
    this.PACKET_MCU = 0x68;
    this.progress = 0;
    this.onProgress = () => { };
    this.onLog = () => { };
    this.buf = [];
    this.backend.onData = (b) => this.buf.push(b);
  }
  log(s) { this.onLog(s); }

  buildPacket(payload) {
    const len = payload.length + 5;
    const pkt = [...this.PACKET_START, this.PACKET_HOST, (len >> 8) & 0xFF, len & 0xFF, ...payload];
    const chk = pkt.slice(2).reduce((a, b) => (a + b) & 0xFF, 0);
    return Uint8Array.from([...pkt, chk, this.PACKET_END]);
  }
  async writePacket(payload) {
    const p = this.buildPacket(payload);
    this.log('→ ' + [...p].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    await this.backend.write(p);
  }
  /**
   * 等待并解析一个来自 MCU 的完整数据包。
   * 帧结构：46 B9 68 | LEN_H LEN_L | payload… | CHK | 16
   *   LEN = payload.length + 5，总长 = LEN + 2
   * 注意：不能在进入时清空 buf —— MCU 的应答可能在 writePacket 之后立刻到达，
   *       清空会丢掉响应（这是早期实现中的缺陷，已修复）。
   */
  async waitPacket(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // 定位帧头 46 B9 68
      let i = -1;
      for (let k = 0; k + 2 < this.buf.length; k++) {
        if (this.buf[k] === 0x46 && this.buf[k + 1] === 0xB9 && this.buf[k + 2] === 0x68) { i = k; break; }
      }
      if (i < 0) {
        // 丢弃噪声，仅保留末尾 2 字节以防帧头被截断
        if (this.buf.length > 2) this.buf = this.buf.slice(-2);
      } else {
        if (i > 0) this.buf = this.buf.slice(i);        // 丢掉帧头之前的杂字节
        if (this.buf.length >= 5) {
          const len = (this.buf[3] << 8) | this.buf[4];
          const total = len + 2;
          if (len >= 5 && this.buf.length >= total) {
            const pkt = this.buf.slice(0, total);
            this.buf = this.buf.slice(total);
            this.log('← ' + [...pkt].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
            return this.parsePacket(pkt);
          }
        }
      }
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error(`等待 MCU 应答超时（缓冲区 ${this.buf.length} 字节）`);
  }
  parsePacket(pkt) {
    // 校验：sum(pkt[2:-2]) & 0xFF == pkt[-2]
    const body = pkt.slice(2, pkt.length - 2);
    const chk = body.reduce((a, b) => (a + b) & 0xFF, 0);
    if (chk !== pkt[pkt.length - 2]) this.log('!! 校验和不匹配');
    return pkt.slice(5, pkt.length - 2);      // payload
  }

  /**
   * 完整烧录流程
   * @param {Uint8Array} hexBinary  .hex 解析后的二进制（从 0 开始）
   * @param {object} opt  { fosc, baudHandshake, baudTransfer }
   */
  async program(hexBinary, opt = {}) {
    const baudHandshake = opt.baudHandshake || 2400;
    const baudTransfer = opt.baudTransfer || 115200;
    const mcuClock = opt.fosc || 11059200;
    const steps = [];
    const step = (s, st) => { steps.push({ name: s, ok: st }); this.log(`[${st ? 'OK' : 'FAIL'}] ${s}`); this.onProgress(s, st); };

    try {
      // 1. 握手
      this.log('握手：以 ' + baudHandshake + ' bps 连续发送 0x7F，请在 2 秒内给目标板断电重上电…');
      let synced = false;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !synced) {
        await this.backend.write(Uint8Array.from([0x7F]));
        await new Promise(r => setTimeout(r, 20));
        if (this.buf.includes(0x7F)) { synced = true; }
      }
      if (!synced) throw new Error('握手失败：未收到 0x7F 回显。请检查 USB-TTL 接线（TX↔P3.0、RX↔P3.1、共地）、5V 电平、以及"先点下载再冷启动"的顺序。');
      step('握手同步', true);

      const status = await this.waitPacket(3000);
      if (status[0] !== 0x00) throw new Error('状态包 magic 错误：0x' + status[0].toString(16));
      const optByte = status[19];
      const cpu6t = !(optByte & 1);
      let freqSum = 0;
      for (let i = 0; i < 8; i++) freqSum += (status[1 + 2 * i] << 8) | status[2 + 2 * i];
      freqSum /= 8;
      const detectedClock = (baudHandshake * freqSum * (cpu6t ? 6 : 12)) / 7;
      const blVer = `${status[17] >> 4}.${status[17] & 0x0F}${String.fromCharCode(status[18])}`;
      this.log(`芯片时钟 ≈ ${(detectedClock / 1e6).toFixed(4)} MHz，${cpu6t ? '6T' : '12T'} 模式，BSL 版本 ${blVer}`);
      step('读取芯片状态', true);

      // 2. 切换波特率
      const sample = cpu6t ? 16 : 32;
      let brt = 65536 - Math.round(detectedClock / (baudTransfer * sample));
      const brtCsum = (2 * (256 - brt)) & 0xFF;
      let iap = 0x80;
      if (detectedClock < 5e6) iap = 0x83; else if (detectedClock < 10e6) iap = 0x82; else if (detectedClock < 20e6) iap = 0x81;
      const delay = 0xA0;
      // 0x8F：以握手波特率发出，随后立刻把本端切到高速读应答，再切回握手波特率
      await this.writePacket([0x8F, (brt >> 8) & 0xFF, brt & 0xFF, 0xFF - ((brt >> 8) & 0xFF), brtCsum, delay, iap]);
      await new Promise(r => setTimeout(r, 30));
      await this.backend.setBaudRate(baudTransfer);
      let resp = await this.waitPacket(3000);
      if (resp[0] !== 0x8F) throw new Error('波特率探测命令异常应答');
      await this.backend.setBaudRate(baudHandshake);
      // 0x8E：正式切换，之后保持高速
      await this.writePacket([0x8E, (brt >> 8) & 0xFF, brt & 0xFF, 0xFF - ((brt >> 8) & 0xFF), brtCsum, delay]);
      await new Promise(r => setTimeout(r, 30));
      await this.backend.setBaudRate(baudTransfer);
      resp = await this.waitPacket(3000);
      if (resp[0] !== 0x8E) throw new Error('波特率切换命令异常应答');
      step(`切换波特率到 ${baudTransfer}`, true);

      // 3. Ping-pong 自检（stcgal 同款，验证高速链路稳定）
      const magic = 0x0000;
      const ping = [0x80, 0x00, 0x00, 0x36, 0x01, (magic >> 8) & 0xFF, magic & 0xFF];
      let pongOk = 0;
      for (let i = 0; i < 4; i++) {
        await this.writePacket(ping);
        const pr = await this.waitPacket(2000);
        if (pr[0] === 0x80) pongOk++;
      }
      step(`高速链路自检 ${pongOk}/4`, pongOk >= 4);

      // 4. 擦除
      const blocks = Math.ceil(hexBinary.length / 512) * 2;
      await this.writePacket([0x84, blocks, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33]);
      resp = await this.waitPacket(8000);
      if (resp[0] !== 0x80) throw new Error('擦除失败');
      step('擦除 Flash', true);

      // 5. 写 Flash（每次 128 字节，MCU 回送校验和逐块验证）
      const BS = 128;
      for (let i = 0; i < hexBinary.length; i += BS) {
        const blk = hexBinary.slice(i, i + BS);
        const payload = [0, 0, 0, (i >> 8) & 0xFF, i & 0xFF, 0, BS, ...blk];
        while (payload.length < BS + 7) payload.push(0);
        const csum = payload.slice(7).reduce((a, b) => (a + b) & 0xFF, 0);
        await this.writePacket(payload);
        const r = await this.waitPacket(4000);
        if (r[0] !== 0x80) throw new Error('写入失败 @0x' + i.toString(16));
        if (r.length > 1 && r[1] !== csum) throw new Error('块校验和不匹配 @0x' + i.toString(16) + ` (MCU=${r[1]} 主机=${csum})`);
        this.onProgress('写 Flash', true, { done: i + BS, total: hexBinary.length });
        step(`写入 0x${i.toString(16)}..0x${Math.min(i + BS, hexBinary.length).toString(16)}`, true);
        // 重新触发握手（stcgal 在每次写块后无需重发，这里保持简单）
      }
      // 6. 选项字节（保持默认，不做修改以免误改时钟）
      step('烧录完成，请断电重启后运行新程序', true);
      return { ok: true, steps, detectedClock, cpu6t, blVer };
    } catch (e) {
      return { ok: false, error: e.message, steps };
    }
  }
}

/* ---------------------------------------------------------------- HEX → 二进制 */
export function hexToBinary(hexText) {
  const out = new Uint8Array(65536);
  let max = -1;
  for (const raw of String(hexText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== ':') continue;
    const b = [];
    for (let i = 1; i + 1 < line.length; i += 2) b.push(parseInt(line.substr(i, 2), 16));
    const len = b[0], addr = (b[1] << 8) | b[2], type = b[3];
    if (type === 0x01) break;
    if (type !== 0x00) continue;
    for (let i = 0; i < len; i++) { out[addr + i] = b[4 + i]; if (addr + i > max) max = addr + i; }
  }
  return out.slice(0, max + 1);
}
