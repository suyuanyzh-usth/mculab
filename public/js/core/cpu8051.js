/*
 * cpu8051.js — 8051 (STC89C52 / STC89C51) 指令级仿真内核
 * ==================================================================
 * 设计目标
 *   1) 教学可解释性：指令级单步、反汇编、PSW 标志、机器周期全部可观测
 *   2) 外设耦合：P0–P3 引脚变化带时间戳，供逻辑分析仪/示波器采样
 *   3) 零依赖：纯 ES Module，校园内网离线可用
 *
 * 时序模型
 *   12T 模式：1 机器周期 = 12 振荡周期
 *   11.0592 MHz 晶振 → mcuClock = 921600 机器周期/秒
 *
 * 准双向口模型（关键，决定按键/总线实验是否正确）
 *   pin = PxLatch & PxExtPull
 *   外设把某个引脚拉低 → 清 PxExtPull 对应位 → 引脚被强拉低
 *   正确复现 "写 1 才能读回外部低电平" 的经典 51 行为
 *
 * 交叉验证
 *   tests/oracle.test.mjs 用 SDCC 自带 ucsim_51 作为黄金参照，
 *   比对 PC/ACC/B/PSW/SP/DPTR/R0-R7 与总机器周期数。
 */

import { SFR } from './sfr.js';

const CY = 0x80, AC = 0x40, F0 = 0x10, RS1 = 0x08, RS0 = 0x04, OV = 0x02, P = 0x01;

// 引脚编号：Px.y → (x<<3)|y
export const PIN = (port, bit) => (port << 3) | bit;
export const PIN_TXD = PIN(3, 1);   // 0x19  串口发送
export const PIN_RXD = PIN(3, 0);   // 0x18  串口接收
export const PIN_INT0 = PIN(3, 2);
export const PIN_INT1 = PIN(3, 3);
export const PIN_T0 = PIN(3, 4);
export const PIN_T1 = PIN(3, 5);

// 中断源定义（数组顺序 = 同优先级下的自然优先级）
const INTERRUPTS = [
  { name: 'EXT0', label: '外部中断0 (INT0)', vec: 0x0003, enBit: 0x01, priBit: 0x01 },
  { name: 'TIMER0', label: '定时器0', vec: 0x000B, enBit: 0x02, priBit: 0x02 },
  { name: 'EXT1', label: '外部中断1 (INT1)', vec: 0x0013, enBit: 0x04, priBit: 0x04 },
  { name: 'TIMER1', label: '定时器1', vec: 0x001B, enBit: 0x08, priBit: 0x08 },
  { name: 'SERIAL', label: '串口', vec: 0x0023, enBit: 0x10, priBit: 0x10 }
];

/**
 * 8051 每条操作码的机器周期数（12T 模型）。
 * 8051 的指令周期完全由操作码决定，不存在数据相关的周期数，
 * 因此可以预先查表 —— 这使得外设能在"指令执行之前"就按机器周期推进，
 * 从而让 SFR 写入落在指令的最后一个机器周期，与真实硬件时序一致。
 * 该表由 tests/cycle.test.mjs 逐操作码与 exec() 的返回值交叉校验。
 */
const ONE_CYCLE_OPS = new Set([
  0x00,
  0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
  0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F,
  0x23, 0x24, 0x25, 0x26, 0x27,
  0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F,
  0x33, 0x34, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F,
  0x42, 0x44, 0x45, 0x46, 0x47,
  0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E, 0x4F,
  0x52, 0x54, 0x55, 0x56, 0x57,
  0x58, 0x59, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F,
  0x62, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,
  0x74, 0x76, 0x77,
  0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F,
  0x94, 0x95, 0x96, 0x97,
  0x98, 0x99, 0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F,
  0xA2, 0xB2, 0xB3,
  0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
  0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
  0xD2, 0xD3, 0xD4, 0xD6, 0xD7,
  0xE4, 0xE5, 0xE6, 0xE7,
  0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF,
  0xF4, 0xF5, 0xF6, 0xF7,
  0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF
]);

export const CYCLE = (() => {
  const t = new Uint8Array(256);
  for (let op = 0; op < 256; op++) {
    if (ONE_CYCLE_OPS.has(op)) t[op] = 1;
    else if (op === 0x84 || op === 0xA4) t[op] = 4;   // DIV AB / MUL AB
    else if (op === 0xA5) t[op] = 1;                  // 唯一未定义操作码，按 NOP 处理
    else t[op] = 2;
  }
  return t;
})();

export class CPU8051 {
  constructor(opts = {}) {
    this.fosc = opts.fosc || 11059200;
    this.clockPerCycle = 12;                        // 12T
    this.mcuClockHz = this.fosc / this.clockPerCycle;
    this.codeSize = opts.codeSize || 8192;          // STC89C52 = 8KB Flash
    this.xramSize = opts.xramSize || 512;
    this.code = new Uint8Array(65536);
    this.iram = new Uint8Array(256);
    this.xram = new Uint8Array(65536);
    this.sfr = new Uint8Array(256);
    this.portExt = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF];  // 外部拉低掩码（0=被拉低）
    this.portLatch = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    this.portPrev = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    this.cycles = 0;
    this.instrCount = 0;
    this.halted = false;
    this.idle = false;
    this.intLevelActive = -1;
    this.timer = [
      { mode: 0, count: false, lastPin: 1 },
      { mode: 0, count: false, lastPin: 1 }
    ];
    this.uart = {
      mode: 1, double: false,
      txBits: [], txAcc: 0, txLine: 1, txActive: false, txData: 0, lastRxByte: null,
      rxQueue: [], rxBuf: null, rxAcc: 0, rxLine: 1,
      txBytes: []                                 // 已发出的字节（供串口助手/终端显示）
    };
    this.events = [];        // {t, pin, v} 引脚跳变事件
    this.maxEvents = 300000;
    this.watchPin = null;
    this.undefinedOpcode = [];
    this.onSfrWrite = null;  // (addr, val, old)
    this.onPinChange = null; // (pinId, val, t)
    this.onSerialTx = null;  // (byte)
    this.reset();
  }

  // ------------------------------------------------------------- 复位
  reset() {
    this.sfr.fill(0);
    this.iram.fill(0);
    this.code.fill(0);
    this.pc = 0x0000;
    this.sfr[SFR.SP] = 0x07;
    this.cycles = 0;
    this.instrCount = 0;
    this.halted = false; this.idle = false;
    this.intLevelActive = -1;
    for (let i = 0; i < 5; i++) { this.portLatch[i] = 0xFF; this.portPrev[i] = 0xFF; }
    this.portExt = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    const u = this.uart;
    u.txBits = []; u.txAcc = 0; u.txLine = 1; u.txActive = false; u.txData = 0;
    u.rxQueue = []; u.rxBuf = null; u.rxAcc = 0; u.rxLine = 1;
    u.txBytes = []; u.rxQueue.length = 0;
    this.events = [];
    for (const t of this.timer) t.lastPin = 1;
    this.updatePort(3);
    for (let p = 0; p < 4; p++) this.portPrev[p] = this.pinValue(p);
  }
  /** 软复位（保留 Flash，用于重新运行程序） */
  /**
   * 软复位：保留 Flash 中的用户程序，重新开始运行。
   * 注意：reset() 会执行 code.fill(0)，因此必须先切一份副本，
   *       否则会把自己的程序擦掉（这里曾出现过该缺陷，已修复）。
   */
  softReset() {
    const saved = this.code.slice();
    this.reset();
    this.code = saved;
  }
  get sp() { return this.sfr[SFR.SP]; }
  set sp(v) { this.sfr[SFR.SP] = v & 0xFF; }

  // ------------------------------------------------------------- 存储器
  readCode(a) { return this.code[a & 0xFFFF]; }

  readData(a, indirect = false) {
    a &= 0xFF;
    if (indirect || a < 0x80) return this.iram[a];
    return this.readSfr(a);
  }
  writeData(a, v, indirect = false) {
    a &= 0xFF; v &= 0xFF;
    if (indirect || a < 0x80) { this.iram[a] = v; if (a >= 0x80 && !indirect) this.sfr[a] = v; return; }
    this.writeSfr(a, v);
  }

  readSfr(a) {
    switch (a) {
      case SFR.P0: return this.pinValue(0);
      case SFR.P1: return this.pinValue(1);
      case SFR.P2: return this.pinValue(2);
      case SFR.P3: return this.pinValue(3);
      case SFR.P4: return this.pinValue(4);
      case SFR.SBUF: return this.sfr[SFR.SBUF];
      default: return this.sfr[a];
    }
  }

  writeSfr(a, v) {
    const old = this.sfr[a];
    switch (a) {
      case SFR.P0: case SFR.P1: case SFR.P2: case SFR.P3: case SFR.P4: {
        const i = PORT_OF(a);
        this.portLatch[i] = v;
        this.sfr[a] = v;
        this.updatePort(i);
        break;
      }
      case SFR.SBUF:
        this.sfr[a] = v;
        this.startTx(v);
        break;
      case SFR.TCON: {
        // TCON 可写位只有 IT0(b0) / IT1(b2) / TR0(b4) / TR1(b6) —— 掩码 0x55
        // IE0(b1)/IE1(b3)/TF0(b5)/TF1(b7) 由硬件置位，软件写 1 无效
        // 早期版本误用 0x0F 掩码，导致 TR1/TR0 永远写不进去、定时器不启动
        this.sfr[a] = (this.sfr[a] & 0xAA) | (v & 0x55);
        break;
      }
      case SFR.TMOD:
        this.sfr[a] = v;
        this.timer[0].mode = v & 3;
        this.timer[1].mode = (v >> 4) & 3;
        this.timer[0].count = !!(v & 0x04);
        this.timer[1].count = !!(v & 0x40);
        break;
      case SFR.SCON: {
        // SM0/SM1/SM2/REN/TB8/RB8 可写；TI(b1)/RI(b0) 由硬件置位、
        // 软件只能写 0 清除（写 1 无效）—— 这里精确复现该行为
        const keep = this.sfr[a] & 0x03;
        this.sfr[a] = (v & 0xFC) | (keep & v & 0x03);
        this.uart.mode = (v >> 6) & 3;
        break;
      }
      case SFR.ACC: this.sfr[a] = v; this.parityAcc(); break;
      case SFR.PSW:
        // CY/AC/F0/RS1/RS0/OV 可写；P(b0) 为硬件奇偶标志，由 ACC 决定
        this.sfr[a] = (v & 0xFC) | (this.sfr[a] & 0x01);
        break;
      case SFR.PCON: {                               // PCON = 0x87
        this.sfr[SFR.PCON] = v;
        this.uart.double = !!(v & 0x80);
        this.idle = !!(v & 0x01);
        if (v & 0x02) { this.halted = true; }         // PD 掉电
        break;
      }
      case SFR.AUXR: {
        this.sfr[a] = v;
        // STC89C52 AUXR.bit7 不影响 UART 倍速（由 PCON.SMOD 控制），此处仅保存
        break;
      }
      case SFR.WDTRST: this.sfr[a] = v; break;
      default: this.sfr[a] = v; break;
    }
    if (this.onSfrWrite) this.onSfrWrite(a, v, old, this);
  }

  // ------------------------------------------------------------- 端口
  pinValue(port) {
    let v = (this.portLatch[port] & this.portExt[port]) & 0xFF;
    if (port === 3) {
      const u = this.uart;
      const bit1 = u.txActive ? u.txLine : ((this.portLatch[3] >> 1) & 1);
      v = (v & 0xFC) | (u.rxLine & 1) | ((bit1 & 1) << 1);
    }
    return v & 0xFF;
  }
  readPort(port) { return this.pinValue(port); }
  readPin(pinId) { return (this.pinValue((pinId >> 3) & 7) >> (pinId & 7)) & 1; }

  setPortExt(port, mask) {
    mask &= 0xFF;
    if (this.portExt[port] === mask) return;
    this.portExt[port] = mask;
    this.updatePort(port);
  }
  /** 单个引脚外部拉低/放开 */
  setPinExt(pinId, pulledLow) {
    const port = (pinId >> 3) & 7, bit = pinId & 7;
    const before = this.portExt[port];
    const after = pulledLow ? (before & ~(1 << bit)) : (before | (1 << bit));
    if (before === after) return;
    this.portExt[port] = after & 0xFF;
    this.updatePort(port);
  }

  updatePort(port) {
    const nv = this.pinValue(port);
    const ov = this.portPrev[port];
    if (nv === ov) return;
    this.portPrev[port] = nv;
    const ch = (ov ^ nv) & 0xFF;
    for (let b = 0; b < 8; b++) {
      if (!(ch & (1 << b))) continue;
      const pinId = (port << 3) | b;
      const val = (nv >> b) & 1;
      this.recordEvent(pinId, val);
      if (port === 3 && (b === 2 || b === 3)) this.externalIntEdge(b, val);
      if (port === 3 && (b === 4 || b === 5)) this.counterEdge(b, val);
      if (this.onPinChange) this.onPinChange(pinId, val, this.cycles);
    }
  }

  /** 内部外设直接驱动引脚（UART TXD / RXD），保留 P3 其他位 */
  driveUartPins() {
    this.updatePort(3);
  }

  recordEvent(pinId, val) {
    if (this.watchPin !== null && pinId !== this.watchPin) {
      if (pinId !== PIN_TXD && pinId !== PIN_RXD) return;
    }
    if (this.events.length >= this.maxEvents) this.events.splice(0, this.maxEvents >> 1);
    this.events.push({ t: this.cycles, pin: pinId, v: val });
  }
  setWatchPin(pinId) { this.watchPin = pinId; }
  clearEvents() { this.events.length = 0; }

  // ------------------------------------------------------------- 外部中断引脚
  externalIntEdge(bit, val) {
    const tcon = this.sfr[SFR.TCON];
    if (bit === 2) {                       // INT0
      if (tcon & 0x01) { if (val === 0) this.sfr[SFR.TCON] |= 0x02; }  // 下降沿触发
      else { this.sfr[SFR.TCON] = (this.sfr[SFR.TCON] & ~0x02) | (val ? 0 : 0x02); }
    } else {                               // INT1
      if (tcon & 0x04) { if (val === 0) this.sfr[SFR.TCON] |= 0x08; }
      else { this.sfr[SFR.TCON] = (this.sfr[SFR.TCON] & ~0x08) | (val ? 0 : 0x08); }
    }
  }
  /** 定时器外部计数模式（C/T=1）的引脚边沿计数 */
  counterEdge(bit, val) {
    if (val !== 0 && this.timer[bit === 4 ? 0 : 1].count) {
      this.countTimer(bit === 4 ? 0 : 1);
    }
  }
  countTimer(idx) {
    if (idx === 0) {
      const tl = SFR.TL0, th = SFR.TH0;
      const m = this.timer[0].mode;
      if (m === 0) { let v = (((this.sfr[th] & 0x1F) << 8) | this.sfr[tl]) + 1; if (v > 0x1FFF) { v = 0; this.sfr[SFR.TCON] |= 0x20; } this.sfr[th] = (this.sfr[th] & 0xE0) | ((v >> 8) & 0x1F); this.sfr[tl] = v & 0xFF; }
      else if (m === 1) { let v = (((this.sfr[th] << 8) | this.sfr[tl]) + 1) & 0x10000; if (v === 0x10000) { v = 0; this.sfr[SFR.TCON] |= 0x20; } this.sfr[th] = (v >> 8) & 0xFF; this.sfr[tl] = v & 0xFF; }
      else if (m === 2) { let v = this.sfr[tl] + 1; if (v > 0xFF) { v = this.sfr[th]; this.sfr[SFR.TCON] |= 0x20; } this.sfr[tl] = v & 0xFF; }
      else { let v = this.sfr[tl] + 1; if (v > 0xFF) { v = 0; this.sfr[SFR.TCON] |= 0x20; } this.sfr[tl] = v & 0xFF; }
    } else {
      const tl = SFR.TL1, th = SFR.TH1;
      const m = this.timer[1].mode;
      if (m === 0) { let v = (((this.sfr[th] & 0x1F) << 8) | this.sfr[tl]) + 1; if (v > 0x1FFF) { v = 0; this.sfr[SFR.TCON] |= 0x40; } this.sfr[th] = (this.sfr[th] & 0xE0) | ((v >> 8) & 0x1F); this.sfr[tl] = v & 0xFF; }
      else if (m === 1) { let v = ((this.sfr[th] << 8) | this.sfr[tl]) + 1; if (v > 0xFFFF) { v = 0; this.sfr[SFR.TCON] |= 0x40; } this.sfr[th] = (v >> 8) & 0xFF; this.sfr[tl] = v & 0xFF; }
      else if (m === 2) { let v = this.sfr[tl] + 1; if (v > 0xFF) { v = this.sfr[th]; this.sfr[SFR.TCON] |= 0x40; } this.sfr[tl] = v & 0xFF; }
      else { let v = this.sfr[tl] + 1; if (v > 0xFF) { v = 0; this.sfr[SFR.TCON] |= 0x40; } this.sfr[tl] = v & 0xFF; }
    }
  }

  // ------------------------------------------------------------- HEX / BIN
  loadHex(text, offset = 0) {
    const lines = String(text).split(/\r?\n/);
    let ext = 0, loaded = 0, checksumErrors = 0, badLines = 0;
    let minA = 0x10000, maxA = -1;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] !== ':') { badLines++; continue; }
      const bytes = [];
      for (let i = 1; i + 1 < line.length; i += 2) bytes.push(parseInt(line.substr(i, 2), 16));
      if (bytes.length < 5 || bytes.some(isNaN)) { badLines++; continue; }
      const len = bytes[0], addr = (bytes[1] << 8) | bytes[2], type = bytes[3];
      const data = bytes.slice(4, 4 + len);
      const sum = bytes.reduce((a, b) => (a + b) & 0xFF, 0);
      if (sum !== 0 || data.length !== len) { checksumErrors++; continue; }
      if (type === 0x00) {
        for (let i = 0; i < data.length; i++) {
          const a = (ext + addr + offset + i) & 0xFFFF;
          this.code[a] = data[i];
          if (a < minA) minA = a;
          if (a > maxA) maxA = a;
        }
        loaded += data.length;
      } else if (type === 0x01) break;
      else if (type === 0x02) ext = (((data[0] << 8) | data[1]) << 4) & 0xFFFF;
      else if (type === 0x04) ext = 0; // 段外地址：本平台仅 64K 空间，忽略高位
    }
    return { loaded, checksumErrors, badLines, minAddr: minA === 0x10000 ? 0 : minA, maxAddr: maxA };
  }
  loadBinary(buf) { const n = Math.min(buf.length, 65536); for (let i = 0; i < n; i++) this.code[i] = buf[i]; return n; }
  /** 导出 Intel HEX（供学生下载/烧录） */
  exportHex(start = 0, end = 0x2000) {
    const out = [];
    const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
    for (let base = start; base < end; base += 16) {
      const data = [];
      for (let i = 0; i < 16; i++) data.push(this.code[base + i] & 0xFF);
      const addr = base & 0xFFFF;
      const rec = [data.length, addr >> 8, addr & 0xFF, 0x00, ...data];
      const sum = (-rec.reduce((a, b) => (a + b) & 0xFF, 0)) & 0xFF;
      out.push(':' + rec.map(hex2).join('') + hex2(sum));
    }
    out.push(':00000001FF');
    return out.join('\n');
  }

  // ------------------------------------------------------------- 中断
  pendingInterrupt() {
    const ie = this.sfr[SFR.IE], ip = this.sfr[SFR.IP];
    if (!(ie & 0x80)) return null;
    let best = null;
    for (const v of INTERRUPTS) {
      if (!(ie & v.enBit)) continue;
      let pend;
      if (v.name === 'SERIAL') pend = !!(this.sfr[SFR.SCON] & 0x03);
      else if (v.name === 'EXT0') pend = !!(this.sfr[SFR.TCON] & 0x02);
      else if (v.name === 'EXT1') pend = !!(this.sfr[SFR.TCON] & 0x08);
      else if (v.name === 'TIMER0') pend = !!(this.sfr[SFR.TCON] & 0x20);
      else pend = !!(this.sfr[SFR.TCON] & 0x40);
      if (!pend) continue;
      const lvl = (ip & v.priBit) ? 1 : 0;
      if (this.intLevelActive >= 0 && lvl <= this.intLevelActive) continue;
      if (!best || lvl > best.lvl) best = { v, lvl };
    }
    return best;
  }

  serviceInterrupt(cand) {
    const { v } = cand;
    this.pushStack(this.pc & 0xFF);
    this.pushStack((this.pc >> 8) & 0xFF);
    if (v.name === 'TIMER0') this.sfr[SFR.TCON] &= ~0x20;
    else if (v.name === 'TIMER1') this.sfr[SFR.TCON] &= ~0x40;
    else if (v.name === 'EXT0') this.sfr[SFR.TCON] &= ~0x02;
    else if (v.name === 'EXT1') this.sfr[SFR.TCON] &= ~0x08;
    // 串口 RI/TI 由软件清除
    this.pc = v.vec;
    this.intLevelActive = cand.lvl;
    this.idle = false;                 // 中断唤醒 IDLE
    this.lastInterrupt = v.name;
    return true;
  }

  // ---- 栈：8051 采用"先自增后存"（SP 指向栈顶已用单元）
  //      PUSH: SP←SP+1, (SP)←data           POP: data←(SP), SP←SP−1
  //      故 SP 初值 07H 时，第一个压栈字节落在 08H —— 已用 ucsim_51 实测确认
  pushStack(v) { this.sp = (this.sp + 1) & 0xFF; this.iram[this.sp] = v & 0xFF; }
  popStack() { const v = this.iram[this.sp & 0xFF]; this.sp = (this.sp - 1) & 0xFF; return v; }

  // ------------------------------------------------------------- 寄存器组
  regAddr(n) { return ((this.sfr[SFR.PSW] >> 3) & 3) * 8 + n; }
  getRn(n) { return this.iram[this.regAddr(n)]; }
  setRn(n, v) { this.iram[this.regAddr(n)] = v & 0xFF; }

  // ------------------------------------------------------------- 标志
  setPSWFlag(f, on) { if (on) this.sfr[SFR.PSW] |= f; else this.sfr[SFR.PSW] &= ~f; }
  parityAcc() {
    let v = this.sfr[SFR.ACC], c = 0;
    while (v) { c ^= (v & 1); v >>= 1; }
    this.setPSWFlag(P, c);
  }
  addFlags(a, b, c) {
    const r16 = a + b + c, r = r16 & 0xFF;
    const h = (a & 0x0F) + (b & 0x0F) + c;
    this.setPSWFlag(CY, r16 > 0xFF);
    this.setPSWFlag(AC, h > 0x0F);
    this.setPSWFlag(OV, ((a ^ r) & (b ^ r) & 0x80) !== 0);
    this.sfr[SFR.ACC] = r; this.parityAcc();
    return r;
  }
  /** SUBB：必须计入当前进位 CY（曾因硬编码 0 导致 16/32 位库函数出错） */
  subb(a, b) { return this.subFlags(a, b, (this.sfr[SFR.PSW] & CY) ? 1 : 0); }
  subFlags(a, b, c) {
    const r16 = a - b - c, r = r16 & 0xFF;
    const h = (a & 0x0F) - (b & 0x0F) - c;
    this.setPSWFlag(CY, r16 < 0);
    this.setPSWFlag(AC, h < 0);
    this.setPSWFlag(OV, ((a ^ b) & (a ^ r) & 0x80) !== 0);
    this.sfr[SFR.ACC] = r; this.parityAcc();
    return r;
  }

  // ------------------------------------------------------------- 定时器
  timerTick(n) {
    const tcon = this.sfr[SFR.TCON];
    const t0run = (tcon & 0x10) && !this.timer[0].count;
    const t1run = (tcon & 0x40) && !this.timer[1].count;
    if (t0run) {
      const m = this.timer[0].mode, tl = SFR.TL0, th = SFR.TH0;
      if (m === 3) {
        let v = this.sfr[tl] + n;
        if (v > 0xFF) { this.sfr[SFR.TCON] |= 0x20; }
        this.sfr[tl] = v & 0xFF;
      } else if (m === 0) {
        let v = (((this.sfr[th] & 0x1F) << 8) | this.sfr[tl]) + n;
        if (v > 0x1FFF) { this.sfr[SFR.TCON] |= 0x20; v &= 0x1FFF; }
        this.sfr[th] = (this.sfr[th] & 0xE0) | ((v >> 8) & 0x1F);
        this.sfr[tl] = v & 0xFF;
      } else if (m === 1) {
        let v = ((this.sfr[th] << 8) | this.sfr[tl]) + n;
        if (v > 0xFFFF) { this.sfr[SFR.TCON] |= 0x20; v &= 0xFFFF; }
        this.sfr[th] = (v >> 8) & 0xFF; this.sfr[tl] = v & 0xFF;
      } else {
        // 模式2：8 位自动重装。计数序列 TH0, TH0+1 … 0xFF(共 period 次) 后回到 TH0
        const period = 0x100 - this.sfr[th];
        const x = (this.sfr[tl] - this.sfr[th] + n) & 0xFF;
        if (x >= period) {
          const nOv = Math.floor(x / period);
          if (nOv > 0) this.sfr[SFR.TCON] |= 0x20;
          this.sfr[tl] = (this.sfr[th] + (x % period)) & 0xFF;
        } else {
          this.sfr[tl] = (this.sfr[tl] + n) & 0xFF;
        }
      }
    }
    if (t1run) {
      const m = this.timer[1].mode, tl = SFR.TL1, th = SFR.TH1;
      if (m === 0) {
        let v = (((this.sfr[th] & 0x1F) << 8) | this.sfr[tl]) + n;
        if (v > 0x1FFF) { this.sfr[SFR.TCON] |= 0x40; v &= 0x1FFF; }
        this.sfr[th] = (this.sfr[th] & 0xE0) | ((v >> 8) & 0x1F);
        this.sfr[tl] = v & 0xFF;
      } else if (m === 1) {
        let v = ((this.sfr[th] << 8) | this.sfr[tl]) + n;
        if (v > 0xFFFF) { this.sfr[SFR.TCON] |= 0x40; v &= 0xFFFF; }
        this.sfr[th] = (v >> 8) & 0xFF; this.sfr[tl] = v & 0xFF;
      } else {
        const period = 0x100 - this.sfr[th];
        const x = (this.sfr[tl] - this.sfr[th] + n) & 0xFF;
        if (x >= period) {
          this.sfr[SFR.TCON] |= 0x40;
          this.sfr[tl] = (this.sfr[th] + (x % period)) & 0xFF;
        } else {
          this.sfr[tl] = (this.sfr[tl] + n) & 0xFF;
        }
      }
    }
  }

  // ------------------------------------------------------------- UART
  baudRate() {
    const m = this.uart.mode;
    if (m === 0) return this.mcuClockHz;
    if (m === 2) return this.uart.double ? this.fosc / 32 : this.fosc / 64;
    const th1 = this.sfr[SFR.TH1];
    const ov = this.mcuClockHz / (256 - (th1 || 256));
    return this.uart.double ? ov / 16 : ov / 32;
  }
  bitCycles() {
    const b = this.baudRate();
    if (!b || !isFinite(b) || b <= 0) return 96;
    return Math.max(0.25, this.mcuClockHz / b);
  }
  /** 组装一个完整发送帧的位序列（起始位 + 8 数据位 + [TB8] + 停止位） */
  txFrameBits(v) {
    const m = this.uart.mode, bits = [];
    if (m === 0) { for (let i = 0; i < 8; i++) bits.push((v >> i) & 1); return bits; }
    bits.push(0);
    for (let i = 0; i < 8; i++) bits.push((v >> i) & 1);
    if (m === 2 || m === 3) bits.push((this.sfr[SFR.SCON] & 0x08) ? 1 : 0);
    bits.push(1);
    return bits;
  }

  startTx(v) {
    const u = this.uart;
    u.txBits = this.txFrameBits(v);
    u.txData = v & 0xFF;
    u.txBitIdx = 0; u.txAcc = 0; u.txActive = true;
    u.txLine = u.txBits[0];
    this.sfr[SFR.SCON] &= ~0x02;                 // TI = 0
    this.driveUartPins();
    if (this.onSerialTx) this.onSerialTx(v & 0xFF);
  }
  advanceTxBit() {
    const u = this.uart;
    u.txBitIdx++;
    if (u.txBitIdx >= u.txBits.length) {
      u.txActive = false; u.txLine = 1;
      this.sfr[SFR.SCON] |= 0x02;                // TI = 1
      u.txBytes.push(u.txData);
      u.txBits = [];
    } else {
      u.txLine = u.txBits[u.txBitIdx];
    }
    this.driveUartPins();
  }

  startRxFrame() {
    const u = this.uart;
    const data = u.rxQueue.shift();
    const m = this.uart.mode, bits = [];
    if (m === 0) { for (let i = 0; i < 8; i++) bits.push((data >> i) & 1); }
    else {
      bits.push(0);
      for (let i = 0; i < 8; i++) bits.push((data >> i) & 1);
      if (m === 2 || m === 3) bits.push(0);
      bits.push(1);
    }
    u.rxBuf = { data, bits };
    u.rxBitIdx = 0; u.rxAcc = 0; u.rxLine = bits[0];
    this.driveUartPins();
  }
  advanceRxBit() {
    const u = this.uart;
    if (!u.rxBuf) return;
    u.rxBitIdx++;
    if (u.rxBitIdx >= u.rxBuf.bits.length) {
      u.lastRxByte = u.rxBuf.data;
      this.sfr[SFR.SBUF] = u.rxBuf.data;
      if (this.uart.mode === 2 || this.uart.mode === 3) u.lastRB8 = 1;
      this.sfr[SFR.SCON] |= 0x01;                // RI = 1
      u.rxBuf = null; u.rxBitIdx = 0; u.rxLine = 1;
    } else {
      u.rxLine = u.rxBuf.bits[u.rxBitIdx];
    }
    this.driveUartPins();
  }

  /**
   * 串行外设按机器周期推进。
   *
   * 关键：必须能正确处理任意大小的 n。若把 n 一次性"记账"，则在同一个
   * tick 内新启动的帧不会被推进（历史 bug：单次 tick 1060 周期时收不到字节）。
   * 因此这里按"下一个位事件"为单位分片推进，直到消耗完 n 个机器周期。
   */
  uartTick(n) {
    const u = this.uart;
    let left = n;
    let guard = 0;
    const EPS = 1e-6;
    while (left > EPS && guard++ < 500000) {
      if (!u.rxBuf && u.rxQueue.length) this.startRxFrame();
      const bc = this.bitCycles();
      const need = Math.min(
        u.txActive ? Math.max(EPS, bc - u.txAcc) : Infinity,
        u.rxBuf ? Math.max(EPS, bc - u.rxAcc) : Infinity
      );
      const step = Math.min(left, need);
      if (!isFinite(step)) { break; }                 // 无事可做：剩余周期对串口无影响
      if (u.txActive) u.txAcc += step;
      if (u.rxBuf) u.rxAcc += step;
      left -= step;
      if (u.txActive && u.txAcc >= bc - EPS) { u.txAcc -= bc; this.advanceTxBit(); }
      if (u.rxBuf && u.rxAcc >= bc - EPS) { u.rxAcc -= bc; this.advanceRxBit(); }
      if (step <= EPS) left = 0;                     // 防死循环
    }
  }
  feedSerial(byte) {
    this.uart.rxQueue.push(byte & 0xFF);
    if (this.uart.rxQueue.length > 8192) this.uart.rxQueue.shift();
  }
  feedSerialText(s) { for (const ch of s) this.feedSerial(ch.charCodeAt(0) & 0xFF); }
  setSerialMode(mode, smod) {
    this.uart.mode = mode & 3;
    this.uart.double = !!smod;
    this.sfr[SFR.SCON] = (this.sfr[SFR.SCON] & 0x3F) | ((mode & 3) << 6);
  }
  /** 串口已发送字节（供串口助手/终端）——统一别名到 uart.txBytes */
  get txBytes() { return this.uart.txBytes; }
  drainTx() { const u = this.uart.txBytes; const b = u.slice(); u.length = 0; return b; }

  // ------------------------------------------------------------- 执行
  imm() { return this.code[this.pc++ & 0xFFFF]; }
  imm16() { const h = this.code[this.pc++ & 0xFFFF], l = this.code[this.pc++ & 0xFFFF]; return (h << 8) | l; }
  rel() { const o = this.code[this.pc++ & 0xFFFF]; return o < 0x80 ? o : o - 256; }

  /**
   * 执行一条指令（含外设推进），返回机器周期数。
   *
   * 时序要点：先 tick(c) 推进外设，再 exec(op)。这样 SFR 写入发生在指令的
   * 最后一个机器周期 —— 与真实 8051 一致，可消除"定时器重装相位"误差
   * （早期版本 exec 后再 tick，会让时钟中断相对计时偏 1 个机器周期）。
   */
  step() {
    this.instrCount++;          // 计入中断响应周期，与 ucsim 的 Inst= 语义一致
    if (this.halted) { this.tick(1); return 1; }
    const ie = this.sfr[SFR.IE];
    if (this.idle) {
      const pend = (ie & 0x80) ? this.pendingInterrupt() : null;
      if (pend) { this.tick(2); this.serviceInterrupt(pend); return 2; }
      this.tick(1);
      return 1;
    }
    if (ie & 0x80) {
      const pend = this.pendingInterrupt();
      if (pend) { this.tick(2); this.serviceInterrupt(pend); return 2; }
    }
    const op = this.code[this.pc & 0xFFFF];
    this.pc = (this.pc + 1) & 0xFFFF;   // 取指后 PC 指向操作数（exec 内部沿用此约定）
    const c = CYCLE[op] || 1;
    this.tick(c);                       // 外设走完这条指令的机器周期
    const used = this.exec(op);
    if (used !== c) this.cycles += (used - c);   // 兜底（正常情况下不会触发）
    return used;
  }

  exec(op) {
    const acc = () => this.sfr[SFR.ACC];
    let d, bit, v;
    switch (op) {
      case 0x00: return 1;                                                  // NOP
      // AJMP
      case 0x01: case 0x21: case 0x41: case 0x61: case 0x81: case 0xA1: case 0xC1: case 0xE1: {
        const lo = this.imm();
        this.pc = ((this.pc & 0xF800) | ((op >> 5) << 8) | lo) & 0xFFFF; return 2;
      }
      case 0x02: this.pc = this.imm16(); return 2;                          // LJMP
      case 0x22: { const h = this.popStack(), l = this.popStack(); this.pc = ((h << 8) | l) & 0xFFFF; return 2; } // RET
      case 0x32: {                                                          // RETI
        const h = this.popStack(), l = this.popStack(); this.pc = ((h << 8) | l) & 0xFFFF;
        this.intLevelActive = -1; return 2;
      }
      case 0x73: {                                                          // JMP @A+DPTR
        this.pc = (acc() + ((this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL])) & 0xFFFF; return 2;
      }
      // ACALL
      case 0x11: case 0x31: case 0x51: case 0x71: case 0x91: case 0xB1: case 0xD1: case 0xF1: {
        const lo = this.imm();
        this.pushStack(this.pc & 0xFF); this.pushStack((this.pc >> 8) & 0xFF);
        this.pc = ((this.pc & 0xF800) | ((op >> 5) << 8) | lo) & 0xFFFF; return 2;
      }
      case 0x12: {                                                          // LCALL
        const t = this.imm16();
        this.pushStack(this.pc & 0xFF); this.pushStack((this.pc >> 8) & 0xFF);
        this.pc = t; return 2;
      }
      // 条件跳转
      case 0x40: { const r = this.rel(); if (this.sfr[SFR.PSW] & CY) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0x50: { const r = this.rel(); if (!(this.sfr[SFR.PSW] & CY)) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0x60: { const r = this.rel(); if (acc() === 0) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0x70: { const r = this.rel(); if (acc() !== 0) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0x80: { const r = this.rel(); this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0xB4: { const im = this.imm(), r = this.rel(); if (acc() !== im) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0xB5: { const dr = this.imm(), r = this.rel(); if (acc() !== this.readData(dr)) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0xB6: case 0xB7: { const im = this.imm(), r = this.rel(); if (this.readData(this.getRn(op & 1), true) !== im) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0xD5: { const dr = this.imm(), r = this.rel(); const nv = (this.readData(dr) - 1) & 0xFF; this.writeData(dr, nv); if (nv !== 0) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      // 位条件跳转
      case 0x10: { bit = this.imm(); const r = this.rel(); if (this.getBit(bit)) { this.setBit(bit, 0); this.pc = (this.pc + r) & 0xFFFF; } return 2; }
      case 0x20: { bit = this.imm(); const r = this.rel(); if (this.getBit(bit)) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      case 0x30: { bit = this.imm(); const r = this.rel(); if (!this.getBit(bit)) this.pc = (this.pc + r) & 0xFFFF; return 2; }
      // 位逻辑
      case 0x72: { bit = this.imm(); this.setPSWFlag(CY, !!(this.sfr[SFR.PSW] & CY) || this.getBit(bit)); return 2; }
      case 0x82: { bit = this.imm(); this.setPSWFlag(CY, !!(this.sfr[SFR.PSW] & CY) && this.getBit(bit)); return 2; }
      case 0xA0: { bit = this.imm(); this.setPSWFlag(CY, !!(this.sfr[SFR.PSW] & CY) || !this.getBit(bit)); return 2; }
      case 0xB0: { bit = this.imm(); this.setPSWFlag(CY, !!(this.sfr[SFR.PSW] & CY) && !this.getBit(bit)); return 2; }
      case 0xA2: { bit = this.imm(); this.setPSWFlag(CY, this.getBit(bit)); return 1; }
      case 0x92: { bit = this.imm(); this.setBit(bit, (this.sfr[SFR.PSW] & CY) ? 1 : 0); return 2; }
      case 0xB2: { bit = this.imm(); this.setBit(bit, this.getBit(bit) ? 0 : 1); return 1; }
      case 0xC2: { bit = this.imm(); this.setBit(bit, 0); return 1; }
      case 0xD2: { bit = this.imm(); this.setBit(bit, 1); return 1; }
      case 0xC3: this.setPSWFlag(CY, false); return 1;
      case 0xD3: this.setPSWFlag(CY, true); return 1;
      case 0xB3: this.setPSWFlag(CY, !(this.sfr[SFR.PSW] & CY)); return 1;
      // 累加器
      case 0x03: case 0x23: { const a = acc(); this.sfr[SFR.ACC] = ((a << 1) | (a >> 7)) & 0xFF; return 1; }  // RR / RL
      case 0x13: { const a = acc(), c = (this.sfr[SFR.PSW] & CY) ? 1 : 0; this.setPSWFlag(CY, !!(a & 1)); this.sfr[SFR.ACC] = ((a >> 1) | (c << 7)) & 0xFF; return 1; }
      case 0x33: { const a = acc(), c = (this.sfr[SFR.PSW] & CY) ? 1 : 0; this.setPSWFlag(CY, !!(a & 0x80)); this.sfr[SFR.ACC] = ((a << 1) | c) & 0xFF; return 1; }
      case 0xC4: { const a = acc(); this.sfr[SFR.ACC] = ((a << 4) | (a >> 4)) & 0xFF; return 1; }
      case 0xE4: this.sfr[SFR.ACC] = 0; return 1;
      case 0xF4: this.sfr[SFR.ACC] = (~acc()) & 0xFF; return 1;
      case 0x84: { // DIV AB
        const b = this.sfr[SFR.B], a = acc();
        if (b === 0) { this.setPSWFlag(OV, true); this.sfr[SFR.ACC] = 0xFF; this.sfr[SFR.B] = 0xFF; }
        else { this.sfr[SFR.ACC] = Math.floor(a / b) & 0xFF; this.sfr[SFR.B] = (a % b) & 0xFF; this.setPSWFlag(OV, false); }
        this.setPSWFlag(CY, false); this.parityAcc(); return 4;
      }
      case 0xA4: { // MUL AB
        const p = acc() * this.sfr[SFR.B];
        this.sfr[SFR.ACC] = p & 0xFF; this.sfr[SFR.B] = (p >> 8) & 0xFF;
        this.setPSWFlag(OV, p > 0xFF); this.setPSWFlag(CY, false); this.parityAcc(); return 4;
      }
      case 0xD4: { // DA A
        let a = acc(); const cy = (this.sfr[SFR.PSW] & CY) ? 1 : 0;
        if ((a & 0x0F) > 9 || (this.sfr[SFR.PSW] & AC)) a += 6;
        if (((a >> 4) & 0x0F) > 9 || cy) { a += 0x60; this.setPSWFlag(CY, true); }
        this.sfr[SFR.ACC] = a & 0xFF; this.parityAcc(); return 1;
      }
      // INC / DEC
      case 0x04: this.sfr[SFR.ACC] = (acc() + 1) & 0xFF; this.parityAcc(); return 1;
      case 0x14: this.sfr[SFR.ACC] = (acc() - 1) & 0xFF; this.parityAcc(); return 1;
      case 0x05: { d = this.imm(); this.writeData(d, this.readData(d) + 1); return 1; }
      case 0x15: { d = this.imm(); this.writeData(d, this.readData(d) - 1); return 1; }
      case 0x06: case 0x07: { const ad = this.getRn(op & 1); this.writeData(ad, this.readData(ad, true) + 1, true); return 1; }
      case 0x16: case 0x17: { const ad = this.getRn(op & 1); this.writeData(ad, this.readData(ad, true) - 1, true); return 1; }
      case 0x08: case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x0D: case 0x0E: case 0x0F:
        this.setRn(op & 7, this.getRn(op & 7) + 1); return 1;
      case 0x18: case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E: case 0x1F:
        this.setRn(op & 7, this.getRn(op & 7) - 1); return 1;
      case 0xA3: { let dp = (((this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL]) + 1) & 0xFFFF; this.sfr[SFR.DPH] = dp >> 8; this.sfr[SFR.DPL] = dp & 0xFF; return 2; }
      // ADD / ADDC / SUBB
      case 0x24: this.addFlags(acc(), this.imm(), 0); return 1;
      case 0x25: this.addFlags(acc(), this.readData(this.imm()), 0); return 1;
      case 0x26: case 0x27: this.addFlags(acc(), this.readData(this.getRn(op & 1), true), 0); return 1;
      case 0x28: case 0x29: case 0x2A: case 0x2B: case 0x2C: case 0x2D: case 0x2E: case 0x2F:
        this.addFlags(acc(), this.getRn(op & 7), 0); return 1;
      case 0x34: this.addFlags(acc(), this.imm(), (this.sfr[SFR.PSW] & CY) ? 1 : 0); return 1;
      case 0x35: this.addFlags(acc(), this.readData(this.imm()), (this.sfr[SFR.PSW] & CY) ? 1 : 0); return 1;
      case 0x36: case 0x37: this.addFlags(acc(), this.readData(this.getRn(op & 1), true), (this.sfr[SFR.PSW] & CY) ? 1 : 0); return 1;
      case 0x38: case 0x39: case 0x3A: case 0x3B: case 0x3C: case 0x3D: case 0x3E: case 0x3F:
        this.addFlags(acc(), this.getRn(op & 7), (this.sfr[SFR.PSW] & CY) ? 1 : 0); return 1;
      case 0x94: this.subb(acc(), this.imm()); return 1;
      case 0x95: this.subb(acc(), this.readData(this.imm())); return 1;
      case 0x96: case 0x97: this.subb(acc(), this.readData(this.getRn(op & 1), true)); return 1;
      case 0x98: case 0x99: case 0x9A: case 0x9B: case 0x9C: case 0x9D: case 0x9E: case 0x9F:
        this.subb(acc(), this.getRn(op & 7)); return 1;
      // 逻辑
      case 0x44: this.sfr[SFR.ACC] = acc() | this.imm(); this.parityAcc(); return 1;
      case 0x45: this.sfr[SFR.ACC] = acc() | this.readData(this.imm()); this.parityAcc(); return 1;
      case 0x46: case 0x47: this.sfr[SFR.ACC] = acc() | this.readData(this.getRn(op & 1), true); this.parityAcc(); return 1;
      case 0x48: case 0x49: case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E: case 0x4F:
        this.sfr[SFR.ACC] = acc() | this.getRn(op & 7); this.parityAcc(); return 1;
      case 0x54: this.sfr[SFR.ACC] = acc() & this.imm(); this.parityAcc(); return 1;
      case 0x55: this.sfr[SFR.ACC] = acc() & this.readData(this.imm()); this.parityAcc(); return 1;
      case 0x56: case 0x57: this.sfr[SFR.ACC] = acc() & this.readData(this.getRn(op & 1), true); this.parityAcc(); return 1;
      case 0x58: case 0x59: case 0x5A: case 0x5B: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
        this.sfr[SFR.ACC] = acc() & this.getRn(op & 7); this.parityAcc(); return 1;
      case 0x64: this.sfr[SFR.ACC] = acc() ^ this.imm(); this.parityAcc(); return 1;
      case 0x65: this.sfr[SFR.ACC] = acc() ^ this.readData(this.imm()); this.parityAcc(); return 1;
      case 0x66: case 0x67: this.sfr[SFR.ACC] = acc() ^ this.readData(this.getRn(op & 1), true); this.parityAcc(); return 1;
      case 0x68: case 0x69: case 0x6A: case 0x6B: case 0x6C: case 0x6D: case 0x6E: case 0x6F:
        this.sfr[SFR.ACC] = acc() ^ this.getRn(op & 7); this.parityAcc(); return 1;
      case 0x42: { d = this.imm(); this.writeData(d, this.readData(d) | acc()); return 1; }
      case 0x43: { d = this.imm(); this.writeData(d, this.readData(d) | this.imm()); return 2; }
      case 0x52: { d = this.imm(); this.writeData(d, this.readData(d) & acc()); return 1; }
      case 0x53: { d = this.imm(); this.writeData(d, this.readData(d) & this.imm()); return 2; }
      case 0x62: { d = this.imm(); this.writeData(d, this.readData(d) ^ acc()); return 1; }
      case 0x63: { d = this.imm(); this.writeData(d, this.readData(d) ^ this.imm()); return 2; }
      // MOV
      case 0x74: this.sfr[SFR.ACC] = this.imm(); this.parityAcc(); return 1;
      case 0x75: { d = this.imm(); this.writeData(d, this.imm()); return 2; }
      case 0x76: case 0x77: this.writeData(this.getRn(op & 1), this.imm(), true); return 1;
      case 0x78: case 0x79: case 0x7A: case 0x7B: case 0x7C: case 0x7D: case 0x7E: case 0x7F:
        this.setRn(op & 7, this.imm()); return 1;
      case 0x85: { const s = this.imm(), dst = this.imm(); this.writeData(dst, this.readData(s)); return 2; }
      case 0x86: case 0x87: this.writeData(this.imm(), this.readData(this.getRn(op & 1), true)); return 2;
      case 0x88: case 0x89: case 0x8A: case 0x8B: case 0x8C: case 0x8D: case 0x8E: case 0x8F:
        this.writeData(this.imm(), this.getRn(op & 7)); return 2;
      case 0x90: { const t = this.imm16(); this.sfr[SFR.DPH] = t >> 8; this.sfr[SFR.DPL] = t & 0xFF; return 2; }
      case 0x93: { const dp = (((this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL]) + acc()) & 0xFFFF; this.sfr[SFR.ACC] = this.code[dp]; this.parityAcc(); return 2; }
      case 0x83: { const ad = (this.pc + acc()) & 0xFFFF; this.sfr[SFR.ACC] = this.code[ad]; this.parityAcc(); return 2; }
      case 0xA6: case 0xA7: this.writeData(this.getRn(op & 1), this.readData(this.imm()), true); return 2;
      case 0xA8: case 0xA9: case 0xAA: case 0xAB: case 0xAC: case 0xAD: case 0xAE: case 0xAF:
        this.setRn(op & 7, this.readData(this.imm())); return 2;
      case 0xE5: this.sfr[SFR.ACC] = this.readData(this.imm()); this.parityAcc(); return 1;
      case 0xE6: case 0xE7: this.sfr[SFR.ACC] = this.readData(this.getRn(op & 1), true); this.parityAcc(); return 1;
      case 0xE8: case 0xE9: case 0xEA: case 0xEB: case 0xEC: case 0xED: case 0xEE: case 0xEF:
        this.sfr[SFR.ACC] = this.getRn(op & 7); this.parityAcc(); return 1;
      case 0xF5: this.writeData(this.imm(), acc()); return 1;
      case 0xF6: case 0xF7: this.writeData(this.getRn(op & 1), acc(), true); return 1;
      case 0xF8: case 0xF9: case 0xFA: case 0xFB: case 0xFC: case 0xFD: case 0xFE: case 0xFF:
        this.setRn(op & 7, acc()); return 1;
      // MOVX
      case 0xE0: { const dp = (this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL]; this.sfr[SFR.ACC] = this.xram[dp & 0xFFFF]; this.parityAcc(); return 2; }
      case 0xE2: case 0xE3: { const dp = ((this.sfr[SFR.P2] << 8) | this.getRn(op & 1)) & 0xFFFF; this.sfr[SFR.ACC] = this.xram[dp]; this.parityAcc(); return 2; }
      case 0xF0: { const dp = (this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL]; this.xram[dp & 0xFFFF] = acc(); return 2; }
      case 0xF2: case 0xF3: { const dp = ((this.sfr[SFR.P2] << 8) | this.getRn(op & 1)) & 0xFFFF; this.xram[dp] = acc(); return 2; }
      // 交换
      case 0xC5: { d = this.imm(); const t = this.readData(d); this.writeData(d, acc()); this.sfr[SFR.ACC] = t; this.parityAcc(); return 1; }
      case 0xC6: case 0xC7: { const ad = this.getRn(op & 1), t = this.readData(ad, true); this.writeData(ad, acc(), true); this.sfr[SFR.ACC] = t; this.parityAcc(); return 1; }
      case 0xC8: case 0xC9: case 0xCA: case 0xCB: case 0xCC: case 0xCD: case 0xCE: case 0xCF: {
        const i = op & 7, t = this.getRn(i); this.setRn(i, acc()); this.sfr[SFR.ACC] = t; this.parityAcc(); return 1;
      }
      case 0xD6: case 0xD7: {
        const ad = this.getRn(op & 1), t = this.readData(ad, true);
        this.writeData(ad, (t & 0xF0) | (acc() & 0x0F), true);
        this.sfr[SFR.ACC] = (acc() & 0xF0) | (t & 0x0F); this.parityAcc(); return 1;
      }
      // 栈
      case 0xC0: d = this.imm(); this.pushStack(this.readData(d)); return 2;
      case 0xD0: d = this.imm(); this.writeData(d, this.popStack()); return 2;
      // CJNE Rn,#imm,rel
      case 0xB8: case 0xB9: case 0xBA: case 0xBB: case 0xBC: case 0xBD: case 0xBE: case 0xBF: {
        const i = op & 7, im = this.imm(), r = this.rel(), rv = this.getRn(i);
        this.setPSWFlag(CY, rv < im);
        if (rv !== im) this.pc = (this.pc + r) & 0xFFFF;
        return 2;
      }
      // DJNZ Rn,rel
      case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: case 0xDF: {
        const i = op & 7, r = this.rel(), nv = (this.getRn(i) - 1) & 0xFF;
        this.setRn(i, nv);
        if (nv !== 0) this.pc = (this.pc + r) & 0xFFFF;
        return 2;
      }
      default:
        if (this.undefinedOpcode.length < 64) this.undefinedOpcode.push(op);
        return 1;   // 未定义操作码按 NOP
    }
  }

  // ------------------------------------------------------------- 位寻址
  bitAddr(bit) {
    if (bit < 0x80) return [0x20 + (bit >> 3), 1 << (bit & 7)];
    return [bit & 0xF8, 1 << (bit & 7)];
  }
  getBit(bit) { const [ba, m] = this.bitAddr(bit); return (this.readData(ba) & m) ? 1 : 0; }
  setBit(bit, v) {
    const [ba, m] = this.bitAddr(bit), cur = this.readData(ba);
    this.writeData(ba, v ? (cur | m) : (cur & ~m));
  }

  // ------------------------------------------------------------- 主循环
  tick(n) { this.timerTick(n); this.uartTick(n); this.cycles += n; }

  /** 执行 n 个机器周期（含外设推进） */
  runCycles(budget) {
    let used = 0;
    const limit = (this.cycles + budget) | 0;
    let guard = 0;
    while (this.cycles < limit && !this.halted) {
      used += this.step();
      if (++guard > 40000000) break;
    }
    return used;
  }
  stepOne() { return this.step(); }

  // ------------------------------------------------------------- 观测
  timeUs() { return (this.cycles / this.mcuClockHz) * 1e6; }
  dumpState() {
    return {
      pc: this.pc, a: this.sfr[SFR.ACC], b: this.sfr[SFR.B], sp: this.sp,
      psw: this.sfr[SFR.PSW],
      cy: !!(this.sfr[SFR.PSW] & CY), ac: !!(this.sfr[SFR.PSW] & AC), ov: !!(this.sfr[SFR.PSW] & OV), p: !!(this.sfr[SFR.PSW] & P),
      dptr: (this.sfr[SFR.DPH] << 8) | this.sfr[SFR.DPL],
      r: [0, 1, 2, 3, 4, 5, 6, 7].map(i => this.getRn(i)),
      p0: this.pinValue(0), p1: this.pinValue(1), p2: this.pinValue(2), p3: this.pinValue(3),
      tcon: this.sfr[SFR.TCON], tmod: this.sfr[SFR.TMOD],
      th0: this.sfr[SFR.TH0], tl0: this.sfr[SFR.TL0], th1: this.sfr[SFR.TH1], tl1: this.sfr[SFR.TL1],
      scon: this.sfr[SFR.SCON], sbuf: this.sfr[SFR.SBUF], ie: this.sfr[SFR.IE], ip: this.sfr[SFR.IP],
      cycles: this.cycles, instr: this.instrCount, timeUs: this.timeUs(),
      baud: this.baudRate()
    };
  }
  disasm(addr) {
    const op = this.code[addr & 0xFFFF];
    const b1 = this.code[(addr + 1) & 0xFFFF], b2 = this.code[(addr + 2) & 0xFFFF];
    const hx = (v) => '0x' + v.toString(16).toUpperCase().padStart(2, '0');
    const hx16 = () => '0x' + (((b1 << 8) | b2).toString(16).toUpperCase().padStart(4, '0'));
    const T = DISASM[op];
    if (T) {
      // %2 是 16 位立即数/地址（高字节在前），必须两个字节一起显示，
      // 否则 LJMP 0x0123 会被误显示成 LJMP 0x23。
      // %2 = 16 位操作数；%b = 第二个 8 位操作数；%1 = 第一个 8 位操作数
      let text = T.replace('%2', hx16()).replace('%b', hx(b2)).replace('%1', hx(b1));
      // 长度 = 1 + 操作数字节数（%2 占 2 字节，%1 / %b 各占 1 字节）
      const len = 1 + (T.includes('%2') ? 2 : 0) + (T.includes('%1') ? 1 : 0) + (T.includes('%b') ? 1 : 0);
      return { text, len };
    }
    // 位操作（SETB/CLR/CPL/JB/JNB/JBC/ORL C,bit/ANL C,bit）显示位地址
    if (BITOP[op]) return { text: BITOP[op].replace('%b', '0x' + b1.toString(16).toUpperCase().padStart(2, '0')), len: 2 };
    // 相对跳转：显示目标地址
    if (REL[op]) {
      const off = b1 < 0x80 ? b1 : b1 - 256;
      const target = (addr + 2 + off) & 0xFFFF;
      return { text: REL[op] + ' 0x' + target.toString(16).toUpperCase().padStart(4, '0'), len: 2 };
    }
    // 寄存器组 / 间接寻址类
    const pad = (n) => n & 7;
    if (op >= 0xE8 && op <= 0xEF) return { text: `MOV A,R${pad(op)}`, len: 1 };
    if (op >= 0xF8 && op <= 0xFF) return { text: `MOV R${pad(op)},A`, len: 1 };
    if (op >= 0x08 && op <= 0x0F) return { text: `INC R${pad(op)}`, len: 1 };
    if (op >= 0x18 && op <= 0x1F) return { text: `DEC R${pad(op)}`, len: 1 };
    if (op >= 0x28 && op <= 0x2F) return { text: `ADD A,R${pad(op)}`, len: 1 };
    if (op >= 0x38 && op <= 0x3F) return { text: `ADDC A,R${pad(op)}`, len: 1 };
    if (op >= 0x48 && op <= 0x4F) return { text: `ORL A,R${pad(op)}`, len: 1 };
    if (op >= 0x58 && op <= 0x5F) return { text: `ANL A,R${pad(op)}`, len: 1 };
    if (op >= 0x68 && op <= 0x6F) return { text: `XRL A,R${pad(op)}`, len: 1 };
    if (op >= 0x98 && op <= 0x9F) return { text: `SUBB A,R${pad(op)}`, len: 1 };
    if (op >= 0xB8 && op <= 0xBF) return { text: `CJNE R${pad(op)},#0x${b1.toString(16).toUpperCase().padStart(2, '0')},rel`, len: 3 };
    if (op >= 0xD8 && op <= 0xDF) return { text: `DJNZ R${pad(op)},rel`, len: 2 };
    // AJMP / ACALL：目标 = (PC_next 的页) | (op 高 3 位) | b1
    if ((op & 0x1F) === 0x01) {
      const tgt = (((addr + 2) & 0xF800) | (((op >> 5) & 7) << 8) | b1) & 0xFFFF;
      return { text: `${op & 0x10 ? 'ACALL' : 'AJMP'} 0x${tgt.toString(16).toUpperCase().padStart(4, '0')}`, len: 2 };
    }
    return { text: 'DB 0x' + op.toString(16).toUpperCase().padStart(2, '0'), len: 1 };
  }
}

/* 位操作指令：%b 为位地址字节 */
const BITOP = {
  0x72: 'ORL C,%b', 0x82: 'ANL C,%b', 0xA0: 'ORL C,/%b', 0xB0: 'ANL C,/%b',
  0xA2: 'MOV C,%b', 0x92: 'MOV %b,C', 0xB2: 'CPL %b', 0xC2: 'CLR %b', 0xD2: 'SETB %b'
};
/* 相对跳转指令 */
const REL = {
  0x10: 'JBC %b,', 0x20: 'JB %b,', 0x30: 'JNB %b,',
  0x40: 'JC', 0x50: 'JNC', 0x60: 'JZ', 0x70: 'JNZ', 0x80: 'SJMP'
};

function PORT_OF(a) { return a === SFR.P0 ? 0 : a === SFR.P1 ? 1 : a === SFR.P2 ? 2 : a === SFR.P3 ? 3 : 4; }

const DISASM = {
  0x00: 'NOP', 0x02: 'LJMP %2', 0x03: 'RR A', 0x04: 'INC A', 0x05: 'INC %1',
  0x06: 'INC @R0', 0x07: 'INC @R1', 0x12: 'LCALL %2', 0x13: 'RRC A', 0x14: 'DEC A',
  0x15: 'DEC %1', 0x16: 'DEC @R0', 0x17: 'DEC @R1', 0x22: 'RET', 0x23: 'RL A',
  0x24: 'ADD A,#%1', 0x25: 'ADD A,%1', 0x32: 'RETI', 0x33: 'RLC A', 0x34: 'ADDC A,#%1',
  0x35: 'ADDC A,%1', 0x42: 'ORL %1,A', 0x43: 'ORL %1,#%2', 0x44: 'ORL A,#%1',
  0x45: 'ORL A,%1', 0x52: 'ANL %1,A', 0x53: 'ANL %1,#%2', 0x54: 'ANL A,#%1',
  0x55: 'ANL A,%1', 0x62: 'XRL %1,A', 0x63: 'XRL %1,#%2', 0x64: 'XRL A,#%1',
  0x65: 'XRL A,%1', 0x73: 'JMP @A+DPTR', 0x74: 'MOV A,#%1', 0x75: 'MOV %1,#%b',
  0x80: 'SJMP %1', 0x83: 'MOVC A,@A+PC', 0x84: 'DIV AB', 0x85: 'MOV %b,%1',
  0x90: 'MOV DPTR,#%2', 0x93: 'MOVC A,@A+DPTR', 0x94: 'SUBB A,#%1', 0x95: 'SUBB A,%1',
  0xA3: 'INC DPTR', 0xA4: 'MUL AB', 0xC0: 'PUSH %1', 0xC3: 'CLR C', 0xC4: 'SWAP A',
  0xD0: 'POP %1', 0xD3: 'SETB C', 0xD4: 'DA A', 0xE0: 'MOVX A,@DPTR', 0xE4: 'CLR A',
  0xE5: 'MOV A,%1', 0xF0: 'MOVX @DPTR,A', 0xF4: 'CPL A', 0xF5: 'MOV %1,A'
};
