/*
 * circuit.js — 元件模型 / 网表求解 / 仿真调度
 * ==================================================================
 * 设计原则
 *   1) 引脚严格对应真实封装：STC89C52 为 DIP-40，P0/P2 在实物上为倒序排布，
 *      这里按真实物理引脚号建模，学生接错即诊断报错。
 *   2) 网表 = (元件, 引脚) 的等价类（并查集）。导线只改变等价类，不改变引脚。
 *   3) 电平模型为"5V TTL + 准双向口"：
 *        · MCU 引脚 = 端口锁存值 & 外部拉低掩码（复用 cpu8051 的准双向模型）
 *        · 网络存在 GND 或"闭合到地"的器件 → 网络被强拉低
 *        · 网络接 VCC 且无器件拉低 → 网络为高
 *        · 其余（悬空）按 51 的内部弱上拉视为高
 *   4) 器件按固定时间片（默认 20µs 仿真时间）刷新，兼顾性能与动态扫描类
 *      实验（数码管 1kHz 扫描）的可见性。
 */

// ---------------------------------------------------------------- 引脚定义
// 每个引脚：name(逻辑名) num(物理引脚号) dx,dy(相对元件原点的格数) side(引线方向)
// kind:  p=无源  i=输入  o=输出  io=双向  pwr=电源  gnd=地
const p = (name, num, dx, dy, side, kind = 'p', alt = '') => ({ name, num, dx, dy, side, kind, alt });

/** STC89C52RC / STC89C51RC  DIP-40（物理引脚号 1..40，逆时针） */
export const MCU_DIP40_PINS = [
  // 左列（自上而下 1..20）
  p('P1.0', 1, 0, 0, 'left'), p('P1.1', 2, 0, 1, 'left'), p('P1.2', 3, 0, 2, 'left'), p('P1.3', 4, 0, 3, 'left'),
  p('P1.4', 5, 0, 4, 'left'), p('P1.5', 6, 0, 5, 'left'), p('P1.6', 7, 0, 6, 'left'), p('P1.7', 8, 0, 7, 'left'),
  p('RST', 9, 0, 8, 'left', 'i'),
  p('P3.0', 10, 0, 9, 'left', 'io', 'RXD'),
  p('P3.1', 11, 0, 10, 'left', 'io', 'TXD'),
  p('P3.2', 12, 0, 11, 'left', 'io', 'INT0'),
  p('P3.3', 13, 0, 12, 'left', 'io', 'INT1'),
  p('P3.4', 14, 0, 13, 'left', 'io', 'T0'),
  p('P3.5', 15, 0, 14, 'left', 'io', 'T1'),
  p('P3.6', 16, 0, 15, 'left', 'io', 'WR'),
  p('P3.7', 17, 0, 16, 'left', 'io', 'RD'),
  p('XTAL2', 18, 0, 17, 'left', 'p'),
  p('XTAL1', 19, 0, 18, 'left', 'p'),
  p('GND', 20, 0, 19, 'left', 'gnd'),
  // 右列（自下而上 21..40）—— 注意 P0/P2 为倒序，是学生最易错之处
  p('P2.0', 21, 12, 19, 'right'), p('P2.1', 22, 12, 18, 'right'), p('P2.2', 23, 12, 17, 'right'), p('P2.3', 24, 12, 16, 'right'),
  p('P2.4', 25, 12, 15, 'right'), p('P2.5', 26, 12, 14, 'right'), p('P2.6', 27, 12, 13, 'right'), p('P2.7', 28, 12, 12, 'right'),
  p('PSEN', 29, 12, 11, 'right', 'o'),
  p('ALE', 30, 12, 10, 'right', 'o'),
  p('EA', 31, 12, 9, 'right', 'i'),
  p('P0.7', 32, 12, 8, 'right'), p('P0.6', 33, 12, 7, 'right'), p('P0.5', 34, 12, 6, 'right'), p('P0.4', 35, 12, 5, 'right'),
  p('P0.3', 36, 12, 4, 'right'), p('P0.2', 37, 12, 3, 'right'), p('P0.1', 38, 12, 2, 'right'), p('P0.0', 39, 12, 1, 'right'),
  p('VCC', 40, 12, 0, 'right', 'pwr')
];

const segPins = (commonName) => [
  p('a', 1, 0, 0, 'left'), p('b', 2, 0, 1, 'left'), p('c', 3, 0, 2, 'left'), p('d', 4, 0, 3, 'left'),
  p('e', 5, 0, 4, 'left'), p('f', 6, 0, 5, 'left'), p('g', 7, 0, 6, 'left'), p('dp', 8, 0, 7, 'left'),
  p(commonName, 9, 6, 8, 'bottom')
];

export const DEVICE_DEFS = {
  // ---------------------------------------------------------- MCU
  mcu: {
    label: 'STC89C52RC', category: 'microcontroller', w: 12, h: 20, isMcu: true,
    pins: MCU_DIP40_PINS,
    props: { model: 'STC89C52RC', fosc: 11059200, flash: 8192, xram: 512 }
  },
  mcu51: {
    label: 'STC89C51RC', category: 'microcontroller', w: 12, h: 20, isMcu: true,
    pins: MCU_DIP40_PINS,
    props: { model: 'STC89C51RC', fosc: 11059200, flash: 4096, xram: 128 }
  },

  // ---------------------------------------------------------- 无源元件
  resistor: {
    label: '电阻', category: 'passive', w: 4, h: 2,
    pins: [p('1', 1, 0, 0, 'left'), p('2', 2, 4, 0, 'right')],
    props: { ohm: 220, text: '220Ω' }
  },
  resistor_net: {
    label: '排阻', category: 'passive', w: 3, h: 8,
    pins: [p('COM', 1, 0, 0, 'left'), p('R1', 2, 3, 1, 'right'), p('R2', 3, 3, 2, 'right'),
    p('R3', 4, 3, 3, 'right'), p('R4', 5, 3, 4, 'right'), p('R5', 6, 3, 5, 'right'),
    p('R6', 7, 3, 6, 'right'), p('R7', 8, 3, 7, 'right'), p('R8', 9, 3, 8, 'right')],
    props: { ohm: 1000, text: '1k×8' }
  },
  capacitor: {
    label: '电容', category: 'passive', w: 3, h: 2,
    pins: [p('1', 1, 0, 0, 'left'), p('2', 2, 3, 0, 'right')],
    props: { farad: 30e-12, text: '30pF' }
  },
  capacitor_pol: {
    label: '电解电容', category: 'passive', w: 3, h: 2,
    pins: [p('+', 1, 0, 0, 'left'), p('-', 2, 3, 0, 'right')],
    props: { farad: 10e-6, text: '10µF' }
  },
  inductor: {
    label: '电感', category: 'passive', w: 4, h: 2,
    pins: [p('1', 1, 0, 0, 'left'), p('2', 2, 4, 0, 'right')],
    props: { henry: 1e-3, text: '1mH' }
  },
  crystal: {
    label: '晶振', category: 'passive', w: 4, h: 2,
    pins: [p('1', 1, 0, 0, 'left'), p('2', 2, 4, 0, 'right')],
    props: { hz: 11059200, text: '11.0592MHz' }
  },

  // ---------------------------------------------------------- 二极管类
  led: {
    label: '发光二极管', category: 'diode', w: 3, h: 3,
    pins: [p('A', 1, 0, 1, 'left'), p('K', 2, 3, 1, 'right')],
    props: { color: 'red', vf: 1.8 },
    sim: 'led'
  },
  diode: {
    label: '二极管', category: 'diode', w: 3, h: 3,
    pins: [p('A', 1, 0, 1, 'left'), p('K', 2, 3, 1, 'right')],
    props: { vf: 0.7 },
    sim: 'led'
  },

  // ---------------------------------------------------------- 数码管
  seg7: {
    label: '数码管(共阴)', category: 'display', w: 6, h: 9,
    pins: segPins('COM'),
    props: { type: 'cc', text: '共阴' },
    sim: 'seg7'
  },
  seg7_ca: {
    label: '数码管(共阳)', category: 'display', w: 6, h: 9,
    pins: segPins('COM'),
    props: { type: 'ca', text: '共阳' },
    sim: 'seg7'
  },
  seg7x4: {
    label: '四位数码管(扫描)', category: 'display', w: 11, h: 9,
    pins: [
      p('a', 1, 0, 0, 'left'), p('b', 2, 0, 1, 'left'), p('c', 3, 0, 2, 'left'), p('d', 4, 0, 3, 'left'),
      p('e', 5, 0, 4, 'left'), p('f', 6, 0, 5, 'left'), p('g', 7, 0, 6, 'left'), p('dp', 8, 0, 7, 'left'),
      p('D1', 9, 11, 0, 'right'), p('D2', 10, 11, 1, 'right'), p('D3', 11, 11, 2, 'right'), p('D4', 12, 11, 3, 'right')
    ],
    props: { type: 'cc', text: '共阴 4位' },
    sim: 'seg7x4'
  },

  // ---------------------------------------------------------- 指示与声
  buzzer: {
    label: '蜂鸣器', category: 'output', w: 4, h: 4,
    pins: [p('+', 1, 0, 1, 'left'), p('-', 2, 4, 1, 'right')],
    props: { type: 'active', text: '有源' },
    sim: 'buzzer'
  },
  buzzer_passive: {
    label: '蜂鸣器(无源)', category: 'output', w: 4, h: 4,
    pins: [p('1', 1, 0, 1, 'left'), p('2', 2, 4, 1, 'right')],
    props: { type: 'passive', text: '无源' },
    sim: 'buzzer'
  },
  speaker: {
    label: '扬声器', category: 'output', w: 4, h: 4,
    pins: [p('1', 1, 0, 1, 'left'), p('2', 2, 4, 1, 'right')],
    props: { type: 'passive' },
    sim: 'buzzer'
  },

  // ---------------------------------------------------------- 输入
  key: {
    label: '按键', category: 'input', w: 4, h: 4,
    pins: [p('1', 1, 0, 1, 'left'), p('2', 2, 4, 1, 'right')],
    props: { momentary: true },
    sim: 'key'
  },
  keypad4x4: {
    label: '4×4 矩阵键盘', category: 'input', w: 10, h: 10,
    pins: [
      p('R1', 1, 0, 0, 'left'), p('R2', 2, 0, 1, 'left'), p('R3', 3, 0, 2, 'left'), p('R4', 4, 0, 3, 'left'),
      p('C1', 5, 10, 0, 'right'), p('C2', 6, 10, 1, 'right'), p('C3', 7, 10, 2, 'right'), p('C4', 8, 10, 3, 'right')
    ],
    props: { keys: '123A456B789C*0#D' },
    sim: 'keypad'
  },
  dipswitch: {
    label: '拨码开关(8位)', category: 'input', w: 8, h: 6,
    pins: [
      p('1', 1, 0, 0, 'left'), p('2', 2, 0, 1, 'left'), p('3', 3, 0, 2, 'left'), p('4', 4, 0, 3, 'left'),
      p('5', 5, 0, 4, 'left'), p('6', 6, 0, 5, 'left'),
      p('1b', 7, 8, 0, 'right'), p('2b', 8, 8, 1, 'right'), p('3b', 9, 8, 2, 'right'), p('4b', 10, 8, 3, 'right'),
      p('5b', 11, 8, 4, 'right'), p('6b', 12, 8, 5, 'right')
    ],
    props: { value: 0 },
    sim: 'dipswitch'
  },

  // ---------------------------------------------------------- 电源 / 地
  vcc: {
    label: 'VCC (+5V)', category: 'power', w: 3, h: 4,
    pins: [p('VCC', 1, 1, 4, 'bottom', 'pwr')],
    props: {}
  },
  gnd: {
    label: 'GND', category: 'power', w: 3, h: 4,
    pins: [p('GND', 1, 1, 4, 'bottom', 'gnd')],
    props: {}
  },

  // ---------------------------------------------------------- 显示模块
  lcd1602: {
    label: 'LCD1602', category: 'module', w: 16, h: 10,
    pins: [
      p('VSS', 1, 0, 0, 'left', 'gnd'), p('VDD', 2, 0, 1, 'left', 'pwr'), p('V0', 3, 0, 2, 'left'),
      p('RS', 4, 0, 3, 'left', 'i'), p('RW', 5, 0, 4, 'left', 'i'), p('E', 6, 0, 5, 'left', 'i'),
      p('D0', 7, 0, 6, 'left', 'io'), p('D1', 8, 0, 7, 'left', 'io'), p('D2', 9, 0, 8, 'left', 'io'), p('D3', 10, 0, 9, 'left', 'io'),
      p('D4', 11, 16, 3, 'right', 'io'), p('D5', 12, 16, 4, 'right', 'io'), p('D6', 13, 16, 5, 'right', 'io'), p('D7', 14, 16, 6, 'right', 'io'),
      p('A', 15, 16, 7, 'right', 'pwr'), p('K', 16, 16, 8, 'right', 'gnd')
    ],
    props: { cols: 16, rows: 2, addr: 0x27 },
    sim: 'lcd1602'
  },
  oled12864: {
    label: 'OLED 0.96" I2C', category: 'module', w: 14, h: 8,
    pins: [p('GND', 1, 0, 0, 'left', 'gnd'), p('VCC', 2, 0, 1, 'left', 'pwr'),
    p('SCL', 3, 14, 2, 'right', 'i'), p('SDA', 4, 14, 3, 'right', 'io')],
    props: { addr: 0x3C },
    sim: 'i2cdev'
  },

  // ---------------------------------------------------------- 接口器件
  at24c02: {
    label: 'AT24C02 EEPROM (I2C)', category: 'module', w: 8, h: 8,
    pins: [
      p('A0', 1, 0, 0, 'left', 'i'), p('A1', 2, 0, 1, 'left', 'i'), p('A2', 3, 0, 2, 'left', 'i'), p('GND', 4, 0, 3, 'left', 'gnd'),
      p('SDA', 5, 8, 0, 'right', 'io'), p('SCL', 6, 8, 1, 'right', 'i'), p('WP', 7, 8, 2, 'right', 'i'), p('VCC', 8, 8, 3, 'right', 'pwr')
    ],
    props: { addr: 0xA0, size: 256 },
    sim: 'i2cdev'
  },
  hc595: {
    label: '74HC595 移位寄存器 (SPI)', category: 'module', w: 10, h: 12,
    pins: [
      p('Q1', 15, 0, 0, 'left', 'o'), p('Q2', 1, 0, 1, 'left', 'o'), p('Q3', 2, 0, 2, 'left', 'o'), p('Q4', 3, 0, 3, 'left', 'o'),
      p('Q5', 4, 0, 4, 'left', 'o'), p('Q6', 5, 0, 5, 'left', 'o'), p('Q7', 6, 0, 6, 'left', 'o'), p('Q0', 7, 0, 7, 'left', 'o'),
      p('GND', 8, 0, 8, 'left', 'gnd'),
      p('VCC', 16, 10, 0, 'right', 'pwr'), p('Q7S', 9, 10, 1, 'right', 'o'), p('MR', 10, 10, 2, 'right', 'i'),
      p('SHCP', 11, 10, 3, 'right', 'i', 'SRCLK'), p('STCP', 12, 10, 4, 'right', 'i', 'RCLK'),
      p('OE', 13, 10, 5, 'right', 'i'), p('DS', 14, 10, 6, 'right', 'i', 'SER')
    ],
    props: {},
    sim: 'hc595'
  },
  ds1302: {
    label: 'DS1302 实时时钟', category: 'module', w: 8, h: 8,
    pins: [p('VCC2', 1, 0, 0, 'left', 'pwr'), p('X1', 2, 0, 1, 'left'), p('X2', 3, 0, 2, 'left'), p('GND', 4, 0, 3, 'left', 'gnd'),
    p('CE', 5, 8, 0, 'right', 'i'), p('I/O', 6, 8, 1, 'right', 'io'), p('SCLK', 7, 8, 2, 'right', 'i'), p('VCC1', 8, 8, 3, 'right')],
    props: {}, sim: 'none'
  },

  // ---------------------------------------------------------- 电子管类
  npn: {
    label: 'NPN 三极管', category: 'transistor', w: 5, h: 5,
    pins: [p('B', 1, 0, 2, 'left', 'i'), p('C', 2, 5, 0, 'right', 'o'), p('E', 3, 5, 4, 'right', 'gnd')],
    props: { hfe: 100 }, sim: 'npn'
  },
  pnp: {
    label: 'PNP 三极管', category: 'transistor', w: 5, h: 5,
    pins: [p('B', 1, 0, 2, 'left', 'i'), p('C', 2, 5, 4, 'right', 'gnd'), p('E', 3, 5, 0, 'right', 'o')],
    props: { hfe: 100 }, sim: 'npn'
  },

  // ---------------------------------------------------------- 虚拟仪器
  probe: {
    label: '逻辑探针', category: 'instrument', w: 5, h: 3,
    pins: [p('IN', 1, 0, 1, 'left', 'i')],
    props: { channel: 0, label: 'CH' }, sim: 'probe'
  },
  uart_term: {
    label: '虚拟串口终端', category: 'instrument', w: 10, h: 6,
    pins: [p('RXD', 1, 0, 1, 'left', 'i'), p('TXD', 2, 0, 2, 'left', 'o'), p('GND', 3, 0, 3, 'left', 'gnd')],
    props: { baud: 9600 }, sim: 'uartterm'
  }
};

export const CATEGORIES = [
  { id: 'microcontroller', label: '单片机' },
  { id: 'display', label: '显示器件' },
  { id: 'output', label: '输出器件' },
  { id: 'input', label: '输入器件' },
  { id: 'module', label: '模块/接口' },
  { id: 'passive', label: '无源元件' },
  { id: 'diode', label: '二极管' },
  { id: 'transistor', label: '三极管' },
  { id: 'power', label: '电源' },
  { id: 'instrument', label: '虚拟仪器' }
];

// ---------------------------------------------------------------- 网表（并查集）
export class Netlist {
  constructor() { this.parent = new Map(); this.reset(); }
  reset() { this.parent.clear(); this.nets = []; }
  key(compId, pinIdx) { return compId + '#' + pinIdx; }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(k) !== r) { const n = this.parent.get(k); this.parent.set(k, r); k = n; }
    return r;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  /** 由元件列表与导线列表构建网表；返回 { nets, pinNet } */
  build(components, wires) {
    this.reset();
    for (const c of components) {
      const def = DEVICE_DEFS[c.type]; if (!def) continue;
      for (let i = 0; i < def.pins.length; i++) this.find(this.key(c.id, i));
    }
    for (const w of wires) {
      if (!w.a || !w.b) continue;
      if (w.segments && w.segments.length) {
        // 折线导线：相邻顶点两两相连
        for (let i = 0; i + 1 < w.segments.length; i++) {
          const s1 = w.segments[i], s2 = w.segments[i + 1];
          this.union(this.key(s1.comp, s1.pin), this.key(s2.comp, s2.pin));
        }
      } else {
        this.union(this.key(w.a.comp, w.a.pin), this.key(w.b.comp, w.b.pin));
      }
    }
    // 聚合
    const groups = new Map();
    for (const c of components) {
      const def = DEVICE_DEFS[c.type]; if (!def) continue;
      for (let i = 0; i < def.pins.length; i++) {
        const r = this.find(this.key(c.id, i));
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push({ comp: c.id, pin: i, name: def.pins[i].name, kind: def.pins[i].kind });
      }
    }
    const nets = [];
    const pinNet = new Map();
    for (const [, members] of groups) {
      const idx = nets.length;
      const net = { index: idx, members, hasGnd: members.some(m => m.kind === 'gnd'), hasVcc: members.some(m => m.kind === 'pwr'), low: false, high: false };
      nets.push(net);
      for (const m of members) pinNet.set(this.key(m.comp, m.pin), idx);
    }
    this.nets = nets; this.pinNet = pinNet;
    return { nets, pinNet };
  }
  /** 与给定元件引脚相连的所有 (元件,引脚) */
  peers(pinNet, nets, compId, pinIdx) {
    const n = pinNet.get(this.key(compId, pinIdx));
    if (n === undefined) return [];
    return nets[n].members.map(m => ({ comp: m.comp, pin: m.pin, name: m.name }));
  }
  netOf(pinNet, compId, pinIdx) { return pinNet.get(this.key(compId, pinIdx)); }
}

// ---------------------------------------------------------------- 器件模型
const SEG_FONT = {
  '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07,
  '8': 0x7F, '9': 0x6F, 'A': 0x77, 'b': 0x7C, 'C': 0x39, 'd': 0x5E, 'E': 0x79, 'F': 0x71,
  '-': 0x40, ' ': 0x00, '.': 0x80, '_': 0x08, 'r': 0x50, 'o': 0x5C, 'n': 0x54, 'y': 0x6E,
  'u': 0x1C, 'H': 0x76, 'L': 0x38, 'P': 0x73, 't': 0x78, 'F': 0x71, 'i': 0x10, 'S': 0x6D, 'g': 0x6F, 'h': 0x74, 'p': 0x73
};
export { SEG_FONT };

/** HD44780 字符点阵：占位实现——用 5x8 简化字模渲染 ASCII 可打印字符 */
function lcdGlyph(ch) { return LCD_FONT[ch] || LCD_FONT['?']; }
const LCD_FONT = (() => {
  // 5×8 字体（每行低 5 位），覆盖 ASCII 0x20..0x7E 的常用可读子集
  const F = {};
  const def = {
    ' ': [0, 0, 0, 0, 0, 0, 0, 0],
    '!': [0x04, 0x04, 0x04, 0x04, 0x00, 0x00, 0x04, 0],
    '"': [0x0A, 0x0A, 0, 0, 0, 0, 0, 0],
    '#': [0x0A, 0x1F, 0x0A, 0x1F, 0x0A, 0, 0, 0],
    '$': [0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04, 0],
    '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03, 0],
    '&': [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D, 0],
    "'": [0x04, 0x04, 0, 0, 0, 0, 0, 0],
    '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02, 0],
    ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08, 0],
    '*': [0x00, 0x0A, 0x04, 0x1F, 0x04, 0x0A, 0, 0],
    '+': [0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0, 0],
    ',': [0, 0, 0, 0, 0, 0x04, 0x04, 0x08],
    '-': [0, 0, 0, 0x1F, 0, 0, 0, 0],
    '.': [0, 0, 0, 0, 0, 0x0C, 0x0C, 0],
    '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10, 0],
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E, 0],
    '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E, 0],
    '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F, 0],
    '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E, 0],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02, 0],
    '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E, 0],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E, 0],
    '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08, 0],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E, 0],
    '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C, 0],
    ':': [0, 0x0C, 0x0C, 0, 0, 0x0C, 0x0C, 0],
    ';': [0, 0x0C, 0x0C, 0, 0, 0x0C, 0x04, 0x08],
    '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02, 0],
    '=': [0, 0, 0x1F, 0, 0x1F, 0, 0, 0],
    '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08, 0],
    '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04, 0],
    '@': [0x0E, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0E, 0],
    'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11, 0],
    'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E, 0],
    'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E, 0],
    'D': [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C, 0],
    'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F, 0],
    'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10, 0],
    'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F, 0],
    'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11, 0],
    'I': [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E, 0],
    'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C, 0],
    'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11, 0],
    'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F, 0],
    'M': [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11, 0],
    'N': [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0],
    'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E, 0],
    'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10, 0],
    'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D, 0],
    'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11, 0],
    'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E, 0],
    'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0],
    'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E, 0],
    'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04, 0],
    'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11, 0],
    'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11, 0],
    'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04, 0],
    'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F, 0],
    '[': [0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E, 0],
    '\\': [0x10, 0x08, 0x08, 0x04, 0x02, 0x02, 0x01, 0],
    ']': [0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E, 0],
    '^': [0x04, 0x0A, 0x11, 0, 0, 0, 0, 0],
    '_': [0, 0, 0, 0, 0, 0, 0, 0x1F],
    '`': [0x08, 0x04, 0, 0, 0, 0, 0, 0],
    '{': [0x02, 0x04, 0x04, 0x08, 0x04, 0x04, 0x02, 0],
    '|': [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0],
    '}': [0x08, 0x04, 0x04, 0x02, 0x04, 0x04, 0x08, 0],
    '~': [0x00, 0x00, 0x08, 0x15, 0x02, 0, 0, 0]
  };
  for (let i = 0x21; i < 0x7F; i++) {
    const ch = String.fromCharCode(i);
    F[ch] = def[ch] || [0x1F, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1F, 0];
  }
  F[' '] = def[' '];
  F['?'] = def['?'];
  return F;
})();
export { LCD_FONT, lcdGlyph };

/* ---------------------------------------------------------------- 时间片调度器
 * 仿真时间以"机器周期"为基准（与 CPU 一致），器件按固定周期刷新。
 * 默认每 20µs（≈18.4 个机器周期）刷新一次器件，可覆盖 1kHz 数码管扫描。
 */
export class CircuitSim {
  constructor(netlist = new Netlist()) {
    this.netlist = netlist;
    this.components = [];
    this.wires = [];
    this.cpu = null;
    this.mcuComp = null;
    this.time = 0;                  // 累计机器周期
    this.dirty = true;
    this.refreshCycles = 18;        // ≈20µs @11.0592MHz
    this._acc = 0;
    this.devices = new Map();       // compId -> 器件运行时状态
    this.events = [];               // 器件级事件（供报告/诊断）
    this.listeners = { deviceChange: [] };
  }

  on(ev, fn) { if (this.listeners[ev]) this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  setCircuit(components, wires) {
    this.components = components;
    this.wires = wires;
    this.rebuild();
  }
  rebuild() {
    this.netlist.build(this.components, this.wires);
    this.mcuComp = this.components.find(c => DEVICE_DEFS[c.type]?.isMcu) || null;
    this.devices.clear();
    for (const c of this.components) this.devices.set(c.id, this.initDevice(c));
    this.dirty = true;
    /*
     * 边沿敏感器件（LCD1602 的 E 选通、74HC595 的移位/锁存时钟）不能靠
     * 每 18 个机器周期一次的轮询来采样：E 脉冲往往只有 1~2 个机器周期宽，
     * 轮询必然漏掉。这里挂到 CPU 的引脚跳变回调上，做到"一变就响应"。
     */
    this.pinWatch = this._buildPinWatch();
    if (this.cpu) this.cpu.onPinChange = (pinId, val) => this.handlePinChange(pinId, val);
  }

  /** pinId → [{comp, kind}]，只在 rebuild 时构建一次 */
  _buildPinWatch() {
    const map = new Map();
    const add = (pinId, entry) => {
      if (pinId === null) return;
      if (!map.has(pinId)) map.set(pinId, []);
      map.get(pinId).push(entry);
    };
    for (const c of this.components) {
      const sim = DEVICE_DEFS[c.type]?.sim;
      if (sim !== 'lcd1602' && sim !== 'hc595') continue;
      const def = DEVICE_DEFS[c.type];
      for (let i = 0; i < def.pins.length; i++) {
        const ni = this.netlist.netOf(this.netlist.pinNet, c.id, i);
        if (ni === undefined) continue;
        const net = this.netlist.nets[ni];
        if (!net) continue;
        for (const m of net.members) {
          const pid = this.pinIdOf(m.comp, m.pin);
          if (pid !== null) add(pid, { comp: c.id, kind: sim });
        }
      }
    }
    return map;
  }

  handlePinChange(pinId, val) {
    const list = this.pinWatch && this.pinWatch.get(pinId);
    if (!list) return;
    for (const e of list) {
      const c = this.components.find(x => x.id === e.comp);
      if (!c) continue;
      const st = this.devices.get(c.id);
      if (!st) continue;
      // 上升沿与下降沿都要通知：LCD 的 tick() 需要看到 E 的完整脉冲才能
      // 正确维护 lastE 状态，否则第二次选通不会被识别。
      if (e.kind === 'lcd1602') this.simLcd(c, st);
      else if (e.kind === 'hc595') this.simHc595(c, st);
    }
  }

  initDevice(c) {
    const def = DEVICE_DEFS[c.type];
    const st = { id: c.id, type: c.type, def };
    switch (def?.sim) {
      case 'led': st.on = 0; st.brightness = 0; st.current = 0; break;
      case 'seg7': st.segments = 0; st.enabled = false; st.type = c.props?.type || 'cc'; break;
      case 'seg7x4': st.segments = [0, 0, 0, 0]; st.active = [0, 0, 0, 0]; st.lastOn = [undefined, undefined, undefined, undefined]; st.type = c.props?.type || 'cc'; break;
      case 'buzzer': st.on = 0; st.freq = 0; st.volume = 0; st.toggleTimes = []; st.type = c.props?.type || 'active'; break;
      case 'key': st.pressed = false; break;
      case 'keypad': st.pressed = -1; break;
      case 'dipswitch': st.value = c.props?.value ?? 0; break;
      case 'lcd1602': st.ctrl = new HD44780(c.props?.cols || 16, c.props?.rows || 2); break;
      case 'i2cdev': st.i2c = new I2CDevice(def.label); break;
      case 'hc595': st.sr = 0; st.out = 0; st.lastShcp = 0; st.lastStcp = 0; st.lastMr = 1; break;
      case 'probe': st.history = []; st.value = 0; break;
      case 'uartterm': st.rx = []; st.txBytes = []; break;
      case 'npn': st.on = 0; break;
      default: break;
    }
    return st;
  }

  /* -------------------------------------------------- 电平读取 */
  /**
   * 网络的逻辑电平（0/1）
   * 优先级：接地 > CPU 引脚驱动 > 接电源 > 器件拉低 > 经无源器件传递 > 悬空(1)
   *
   * 为什么需要"经无源器件传递"：
   *   真实电路里 P1.0 ——1kΩ—— 三极管基极 是常见接法。若只看直连，
   *   基极网络既没有 CPU 引脚也没有电源/地，会被判为悬空高电平，
   *   导致三极管恒导通、蜂鸣器不响。这里沿电阻/电感/排阻做深度受限的
   *   电平穿透（depth ≤ 4），既能处理限流电阻，也不会在大网络里失控。
   */
  netLevel(netIndex, depth = 0, seen = null) {
    const net = this.netlist.nets[netIndex];
    if (!net) return 1;
    if (net.hasGnd) return 0;

    const cpu = this.cpu;
    if (cpu) {
      for (const m of net.members) {
        const pinId = this.pinIdOf(m.comp, m.pin);
        if (pinId !== null) {
          if (net.low) return 0;      // 外部器件把该引脚拉低（准双向口可被拉低）
          if (net.high) return 1;
          return cpu.readPin(pinId);
        }
      }
    }
    if (net.low) return 0;
    if (net.high) return 1;
    if (depth >= 4) return 1;

    // 通过无源器件（电阻 / 电感 / 排阻）把电平传到本网络
    if (!seen) seen = new Set([netIndex]);
    let sawHigh = false;
    for (const m of net.members) {
      const c = this.components.find(x => x.id === m.comp);
      if (!c) continue;
      if (!/^(resistor|resistor_net|inductor)$/.test(c.type)) continue;
      for (const peer of this._passivePeers(c, m.pin)) {
        const ni = this.netlist.netOf(this.netlist.pinNet, c.id, peer);
        if (ni === undefined || seen.has(ni)) continue;
        seen.add(ni);
        const lv = this.netLevel(ni, depth + 1, seen);
        seen.delete(ni);
        if (lv === 0) return 0;        // 任一支路被拉低即低（开集/上拉结构）
        sawHigh = true;
      }
    }
    if (sawHigh) return 1;
    return 1;   // 悬空：按 51 内部弱上拉视为高
  }

  /** 无源器件的"另一端"引脚列表（排阻的 COM 与每个 Rn 配对） */
  _passivePeers(c, pinIdx) {
    const def = DEVICE_DEFS[c.type];
    const n = def?.pins?.length || 0;
    if (c.type === 'resistor_net') {
      if (pinIdx === 0) { const a = []; for (let i = 1; i < n; i++) a.push(i); return a; }
      return [0];
    }
    if (n === 2) return [1 - pinIdx];
    return [];
  }

  pinIndexOf(compId, pin) { return pin; }
  /** 元件引脚 → CPU 引脚编号（P0.0 → 0, P1.0 → 8 ...） */
  pinIdOf(compId, pinIdx) {
    const c = this.components.find(x => x.id === compId);
    if (!c) return null;
    const def = DEVICE_DEFS[c.type];
    if (!def?.isMcu) return null;
    const name = def.pins[pinIdx]?.name || '';
    const m = name.match(/^P([0-4])\.([0-7])$/);
    if (!m) return null;
    return ((+m[1]) << 3) | (+m[2]);
  }

  /* -------------------------------------------------- 器件刷新 */
  refresh() {
    const nets = this.netlist.nets;
    // 1) 先判定每个网络的"被拉低"状态（按键/开关/三极管等）
    for (const n of nets) { n.low = n.hasGnd; n.high = n.hasVcc; }
    for (const c of this.components) {
      const st = this.devices.get(c.id); if (!st) continue;
      const def = DEVICE_DEFS[c.type];
      switch (def?.sim) {
        case 'key': if (st.pressed) this.markNetLow(c, 0), this.markNetLow(c, 1); break;
        case 'keypad': {
          if (st.pressed >= 0) {
            const r = Math.floor(st.pressed / 4), col = st.pressed % 4;
            this.markNetLow(c, r); this.markNetLow(c, 4 + col);
          }
          break;
        }
        case 'dipswitch': {
          for (let i = 0; i < 6; i++) if (st.value & (1 << i)) { this.markNetLow(c, i); this.markNetLow(c, 6 + i); }
          break;
        }
        case 'npn': {
          // 基极为高 → 集电极-发射极导通（集电极被拉低）
          if (this.pinLevel(c, 0) === 1) { st.on = 1; this.markNetLow(c, 1); this.markNetLow(c, 2); }
          else st.on = 0;
          break;
        }
        default: break;
      }
    }
    // 2) CPU 端口外部拉低掩码同步
    if (this.cpu && this.mcuComp) {
      const def = DEVICE_DEFS[this.mcuComp.type];
      for (let i = 0; i < def.pins.length; i++) {
        const pinId = this.pinIdOf(this.mcuComp.id, i);
        if (pinId === null) continue;
        const netIdx = this.netlist.netOf(this.netlist.pinNet, this.mcuComp.id, i);
        const net = netIdx !== undefined ? nets[netIdx] : null;
        const pulled = net ? !!net.low : false;
        this.cpu.setPinExt(pinId, pulled);
      }
      // EA 引脚必须为高，否则程序不执行（教学诊断用）
      const eaIdx = def.pins.findIndex(x => x.name === 'EA');
      if (eaIdx >= 0) {
        const n = nets[this.netlist.netOf(this.netlist.pinNet, this.mcuComp.id, eaIdx)];
        this.eaHigh = n ? (!!n.high || !n.hasGnd) : false;
      }
    }
    // 3) 各器件按网络电平更新状态
    for (const c of this.components) {
      const st = this.devices.get(c.id); if (!st) continue;
      const def = DEVICE_DEFS[c.type];
      switch (def?.sim) {
        case 'led': case 'diode': this.simLed(c, st); break;
        case 'seg7': this.simSeg7(c, st); break;
        case 'seg7x4': this.simSeg7x4(c, st); break;
        case 'buzzer': this.simBuzzer(c, st); break;
        case 'lcd1602': this.simLcd(c, st); break;
        case 'i2cdev': this.simI2c(c, st); break;
        case 'hc595': this.simHc595(c, st); break;
        case 'probe': this.simProbe(c, st); break;
        case 'uartterm': this.simUartTerm(c, st); break;
        default: break;
      }
    }
    this.emit('deviceChange');
  }

  markNetLow(c, pinIdx) {
    const n = this.netlist.nets[this.netlist.netOf(this.netlist.pinNet, c.id, pinIdx)];
    if (n) n.low = true;
  }
  pinLevel(c, pinIdx) {
    const n = this.netlist.netOf(this.netlist.pinNet, c.id, pinIdx);
    if (n === undefined) return 1;
    return this.netLevel(n);
  }

  simLed(c, st) {
    const a = this.pinLevel(c, 0), k = this.pinLevel(c, 1);
    const lit = a === 1 && k === 0;
    if (st.on !== (lit ? 1 : 0)) { st.on = lit ? 1 : 0; st.changedAt = this.time; this.events.push({ t: this.time, type: 'led', id: c.id, on: st.on }); }
  }
  simSeg7(c, st) {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    const def = DEVICE_DEFS[c.type];
    const cc = (c.props?.type || 'cc') === 'cc';
    let seg = 0;
    for (let i = 0; i < 8; i++) {
      const lv = this.pinLevel(c, i);
      const lit = cc ? (lv === 1) : (lv === 0);
      if (lit) seg |= (1 << i);
    }
    const comIdx = def.pins.findIndex(x => x.name === 'COM');
    const com = this.pinLevel(c, comIdx);
    const enabled = cc ? (com === 0) : (com === 1);
    st.segments = enabled ? seg : 0;
    st.enabled = enabled;
  }
  simSeg7x4(c, st) {
    const cc = (c.props?.type || 'cc') === 'cc';
    let seg = 0;
    for (let i = 0; i < 8; i++) {
      const lv = this.pinLevel(c, i);
      if (cc ? lv === 1 : lv === 0) seg |= (1 << i);
    }
    // selected[] = 本刷新时刻真正被驱动的位（瞬时值，用于教学观察扫描时序）
    // active[]   = 视觉保持（动态扫描时人眼看到 4 位都"亮"，靠视觉暂留）
    if (!st.selected) st.selected = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const lv = this.pinLevel(c, 8 + d);
      const en = cc ? lv === 0 : lv === 1;
      st.selected[d] = en ? 1 : 0;
      if (en) { st.segments[d] = seg; st.active[d] = 1; st.lastOn[d] = this.time; }
      else if (st.lastOn && st.lastOn[d] !== undefined && (this.time - st.lastOn[d]) * (12 / 11059200) > 0.2) {
        st.active[d] = 0;
      }
    }
    // 记录扫描周期（相邻两次位切换的机器周期数），供"刷新率"教学计算
    const nowSel = st.selected.findIndex(v => v === 1);
    if (nowSel >= 0 && nowSel !== st._lastSel) {
      if (st._lastSel !== undefined && st._lastT !== undefined) {
        st.scanGapCycles = this.time - st._lastT;
      }
      st._lastSel = nowSel; st._lastT = this.time;
    }
  }
  simBuzzer(c, st) {
    const a = this.pinLevel(c, 0), b = this.pinLevel(c, 1);
    if (st.type === 'active') {
      // 有源蜂鸣器：两端有电压差即发声
      const on = (a !== b);
      st.on = on ? 1 : 0; st.freq = on ? 2048 : 0;
    } else {
      /*
       * 无源蜂鸣器：需要外部方波驱动。
       * 不能只盯 '+' 脚（它可能直接接 VCC 而恒定不变），必须同时观察两端：
       * 任一端电平变化即记为一次半周期。
       */
      const sig = (a << 1) | b;
      if (st.lastSig === undefined) st.lastSig = sig;
      if (sig !== st.lastSig) {
        st.lastSig = sig;
        st.toggleTimes.push(this.time);
        if (st.toggleTimes.length > 64) st.toggleTimes.shift();
      }
      const n = st.toggleTimes.length;
      if (n >= 4) {
        const span = st.toggleTimes[n - 1] - st.toggleTimes[0];
        const half = span / (n - 1);                    // 每个半周期多少机器周期
        const secPerCycle = half * 2 * (12 / 11059200);
        st.freq = secPerCycle > 0 ? Math.round(1 / secPerCycle) : 0;
      } else st.freq = 0;
      const last = n ? st.toggleTimes[n - 1] : -1e9;
      st.on = (this.time - last) < 400 ? 1 : 0;         // 400 周期内仍在振动
    }
    st.effective = st.on && (st.type === 'active' || st.freq > 20);
  }
  simLcd(c, st) {
    const ctrl = st.ctrl;
    const rs = this.pinLevel(c, 3), rw = this.pinLevel(c, 4), e = this.pinLevel(c, 5);
    let data = 0;
    for (let i = 0; i < 8; i++) if (this.pinLevel(c, 6 + i) === 1) data |= (1 << i);
    ctrl.tick(rs, rw, e, data);
  }
  simI2c(c, st) {
    // 需要 SCL/SDA 引脚名定位
    const def = DEVICE_DEFS[c.type];
    const sclIdx = def.pins.findIndex(x => x.name === 'SCL');
    const sdaIdx = def.pins.findIndex(x => x.name === 'SDA');
    if (sclIdx < 0 || sdaIdx < 0) return;
    const scl = this.pinLevel(c, sclIdx), sda = this.pinLevel(c, sdaIdx);
    const res = st.i2c.clock(scl, sda, c.props?.addr ?? 0xA0);
    if (res && res.pullLow) {
      const n = this.netlist.nets[this.netlist.netOf(this.netlist.pinNet, c.id, sdaIdx)];
      if (n) n.low = true;
    }
  }
  simHc595(c, st) {
    const def = DEVICE_DEFS[c.type];
    const idx = (n) => def.pins.findIndex(x => x.name === n);
    const mr = this.pinLevel(c, idx('MR'));
    if (mr === 0) { st.sr = 0; }
    const shcp = this.pinLevel(c, idx('SHCP'));
    const ds = this.pinLevel(c, idx('DS'));
    if (st.lastShcp === 0 && shcp === 1) {
      st.sr = ((st.sr << 1) | ds) & 0xFF;
      st.events = st.events || [];
    }
    st.lastShcp = shcp;
    const stcp = this.pinLevel(c, idx('STCP'));
    if (st.lastStcp === 0 && stcp === 1) { st.out = st.sr; st.latchAt = this.time; }
    st.lastStcp = stcp;
    const oe = this.pinLevel(c, idx('OE'));
    st.enabled = (oe === 0);
    st.bits = st.out;
  }
  simProbe(c, st) {
    const v = this.pinLevel(c, 0);
    st.value = v;
    if (st.last !== v) {
      st.history.push({ t: this.time, v });
      if (st.history.length > 20000) st.history.shift();
      st.last = v;
    }
  }
  simUartTerm(c, st) {
    const txd = this.pinLevel(c, 1);   // TXD 引脚接收来自 MCU 的发送
    if (st.lastTxd === undefined) st.lastTxd = txd;
    if (st.lastTxd === 1 && txd === 0) { st.txBytes.push({ t: this.time }); }
    st.lastTxd = txd;
  }

  /* -------------------------------------------------- 主循环 */
  /** 推进 delayCycles 个机器周期 */
  run(delayCycles) {
    if (!this.cpu) return;
    let left = delayCycles;
    while (left > 0) {
      const chunk = Math.min(left, Math.max(1, this.refreshCycles - this._acc));
      this.cpu.runCycles(chunk);
      this._acc += chunk;
      left -= chunk;
      this.time = this.cpu.cycles;
      if (this._acc >= this.refreshCycles) { this._acc = 0; this.refresh(); }
    }
  }
  /** 单步（一条指令） */
  step() {
    if (!this.cpu) return 0;
    const c = this.cpu.stepOne();
    this.time = this.cpu.cycles;
    this._acc += c;
    if (this._acc >= this.refreshCycles) { this._acc = 0; this.refresh(); }
    return c;
  }
  reset() {
    this.time = 0; this._acc = 0;
    for (const c of this.components) this.devices.set(c.id, this.initDevice(c));
    this.events = [];
    this.refresh();
  }

  /* -------------------------------------------------- 功耗/电流粗估（教学用） */
  estimateCurrent() {
    let mA = 12;      // MCU 自身
    for (const c of this.components) {
      const st = this.devices.get(c.id); const def = DEVICE_DEFS[c.type];
      if (def?.sim === 'led' && st.on) mA += 8 * (c.props?.count || 1);
      else if (def?.sim === 'seg7') mA += (st.enabled ? 6 * popcount(st.segments) : 0);
      else if (def?.sim === 'seg7x4') mA += st.active.reduce((a, b) => a + b, 0) * 6 * popcount(st.segments[0] | st.segments[1] | st.segments[2] | st.segments[3]) / 4;
      else if (def?.sim === 'buzzer' && st.effective) mA += 25;
      else if (def?.sim === 'lcd1602') mA += 1.5;
    }
    return Math.round(mA);
  }
}
function popcount(v) { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; }

/* ================================================================ HD44780
 * LCD1602 控制器（教学级完整实现）
 * 支持：8/4 位总线、忙标志、DDRAM 写入、光标/移位、CGRAM、显示开关、
 *       屏幕滚动、字符发生器（内置 5×8 点阵字体）
 */
export class HD44780 {
  constructor(cols = 16, rows = 2) {
    this.cols = cols; this.rows = rows;
    this.ddram = new Uint8Array(80).fill(0x20);
    this.cgram = new Uint8Array(64);
    this.address = 0;
    this.shift = 0;
    this.displayOn = true;
    this.cursorOn = false;
    this.blinkOn = false;
    this.incMode = true;
    this.entryShift = false;
    this.busy = false;
    this.busyUntil = 0;
    this.nibble = 0;             // 4 位模式下高低半字节计数
    this.lastE = 0;
    this.functionSet = 0x38;
    this.inited = false;
    this.initStage = 0;
    this.log = [];
  }
  /** 由仿真循环按引脚电平调用；rs/rw/e 为电平，data 为 8 位总线值 */
  tick(rs, rw, e, data) {
    if (e === 1 && this.lastE === 0) this.strobe(rs, rw, data);
    this.lastE = e;
  }
  strobe(rs, rw, data) {
    if (rw === 1) return;              // 读操作不改变状态（忙标志由 busy 模拟）
    const fourBit = !(this.functionSet & 0x10);
    if (fourBit) {
      // 4 位模式：两次写组成一个字节，高半字节在前
      if (!this.halfPending) { this.nibble = data & 0xF0; this.halfPending = true; return; }
      const byte = this.nibble | ((data >> 4) & 0x0F);
      this.halfPending = false;
      this.execute(rs, byte);
      return;
    }
    // 8 位模式
    this.execute(rs, data & 0xFF);
  }
  execute(rs, byte) {
    if (rs === 0) this.command(byte); else this.writeData(byte);
  }
  command(b) {
    this.log.push({ t: 'cmd', v: b });
    if (b & 0x80) { this.address = b & 0x7F; return; }          // Set DDRAM address
    if ((b & 0xF8) === 0x40) { this.cgramAddr = b & 0x3F; this.inCgram = true; return; }  // Set CGRAM
    if (b & 0x20) {                                             // Function set
      this.functionSet = b; this.inCgram = false;
      if (!(b & 0x10)) this.halfPending = false;
      this.inited = true;
      return;
    }
    if ((b & 0xFC) === 0x04) {                                  // Entry mode
      this.incMode = !!(b & 0x02); this.entryShift = !!(b & 0x01); return;
    }
    if ((b & 0xF8) === 0x08) {                                  // Display on/off
      this.displayOn = !!(b & 0x04); this.cursorOn = !!(b & 0x02); this.blinkOn = !!(b & 0x01); return;
    }
    if ((b & 0xF0) === 0x10) {                                  // Cursor/display shift
      const dir = (b & 0x04) ? 1 : -1;
      if (b & 0x08) this.shift = (this.shift + dir + 40) % 40;
      else this.address = (this.address + dir + 80) % 80;
      return;
    }
    if ((b & 0xFC) === 0x20) { return; }                        // Return home / set DDRAM addr 0
  }
  writeData(byte) {
    if (this.inCgram) {
      this.cgram[(this.cgramAddr || 0) & 0x3F] = byte & 0x1F;
      this.cgramAddr = ((this.cgramAddr || 0) + 1) & 0x3F;
      return;
    }
    this.ddram[this.address & 0x7F] = byte;
    if (this.incMode) this.address = (this.address + 1) & 0x7F;
    else this.address = (this.address - 1 + 128) & 0x7F;
  }
  /** 取某行某列要显示的字符码 */
  charAt(row, col) {
    // 常见 16×2 行地址：0x00 与 0x40
    const base = row === 0 ? 0x00 : 0x40;
    const a = (base + col + (row === 0 ? this.shift : this.shift)) & 0x7F;
    return this.ddram[a] || 0x20;
  }
  /** 当前地址所在行列（用于光标显示） */
  cursorPos() {
    const a = this.address & 0x7F;
    const row = a >= 0x40 ? 1 : 0;
    const base = row === 0 ? 0x00 : 0x40;
    return { row, col: (a - base + 40) % 40 };
  }
  getText() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      let s = '';
      for (let c = 0; c < this.cols; c++) s += String.fromCharCode(this.charAt(r, c));
      out.push(s);
    }
    return out;
  }
}

/* ================================================================ I2C 器件
 * 通用 I2C 从机：采样 SCL/SDA 的起始/停止/位传输，实现字节级收发。
 * 支持 AT24C02 EEPROM（读写内部 256B 存储）与 SSD1306 命令接收。
 */
export class I2CDevice {
  constructor(label = '') {
    this.label = label;
    this.reset();
    this.mem = new Uint8Array(256);
    this.wordAddr = 0;
    this.mode = 'idle';
  }
  reset() {
    this.lastScl = 1; this.lastSda = 1;
    this.state = 'idle';        // idle | addr | data | ack
    this.bitCnt = 0; this.shiftReg = 0;
    this.rw = 0; this.addr = 0;
    this.pullLow = false;
    this.bytes = [];
    this.ackPending = false;
    this.dataOut = 0;
    this.phase = 0;
  }
  /** 每个仿真刷新周期调用一次 */
  clock(scl, sda, addrBase = 0xA0) {
    let pullLow = false;
    const sclRise = (this.lastScl === 0 && scl === 1);
    const sclFall = (this.lastScl === 1 && scl === 0);
    const sdaChangeWhileSclHigh = (scl === 1 && this.lastSda !== sda);
    if (scl === 1 && sdaChangeWhileSclHigh) {
      if (this.lastSda === 1 && sda === 0) { this.start(); }      // START
      else if (this.lastSda === 0 && sda === 1) { this.stop(); }  // STOP
    } else if (sclRise) {
      this.sample(sda, addrBase);
    } else if (sclFall) {
      this.shiftOut();
    }
    this.lastScl = scl; this.lastSda = sda;
    // ACK 阶段：从机拉低 SDA
    if (this.state === 'ack' && scl === 0) pullLow = true;
    this.pullLow = pullLow;
    return { pullLow, data: this.dataOut, state: this.state };
  }
  start() { this.state = 'addr'; this.bitCnt = 0; this.shiftReg = 0; this.bytes = []; }
  stop() { this.onStop(); this.state = 'idle'; this.bitCnt = 0; }
  sample(sda, addrBase) {
    if (this.state === 'ack') { this.state = 'data'; this.bitCnt = 0; this.shiftReg = 0; return; }
    this.shiftReg = ((this.shiftReg << 1) | (sda & 1)) & 0xFF;
    this.bitCnt++;
    if (this.bitCnt === 8) {
      this.bytes.push(this.shiftReg);
      if (this.state === 'addr') {
        this.addr = (this.shiftReg >> 1) & 0x7F;
        this.rw = this.shiftReg & 1;
        this.state = 'ack';
        this.onAddress();
      } else {
        this.onByte(this.shiftReg);
        this.state = 'ack';
      }
      this.bitCnt = 0; this.shiftReg = 0;
    }
  }
  shiftOut() {
    if (this.state === 'ack' || this.bitCnt < 0) return;
    // 从机在读模式下逐位输出
    if (this.rw === 1 && this.state === 'data') {
      this.dataOut = (this.readByte >> (7 - this.bitCnt)) & 1;
      this.bitCnt++;
      if (this.bitCnt === 8) this.bitCnt = 0;
    }
  }
  onAddress() {
    if (this.rw === 0) { this.phase = 'wordaddr'; }
    else { this.readByte = this.mem[this.wordAddr & 0xFF]; this.phase = 'read'; }
  }
  onByte(b) {
    if (this.label && this.label.includes('AT24')) {
      if (this.phase === 'wordaddr') { this.wordAddr = b; this.phase = 'mem'; return; }
      if (this.rw === 0) { this.mem[this.wordAddr & 0xFF] = b; this.wordAddr = (this.wordAddr + 1) & 0xFF; }
    } else {
      this.cmds = this.cmds || []; this.cmds.push(b);
      if (this.cmds.length > 512) this.cmds.shift();
    }
  }
  onStop() { this.phase = 'idle'; }
}
