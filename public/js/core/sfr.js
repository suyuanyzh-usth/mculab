/*
 * sfr.js — 8051 / STC89C52 特殊功能寄存器 (SFR) 与位地址定义
 * 地址与位序严格遵循 Intel 8051 与 STC89C52RC 数据手册
 */

export const SFR = {
  // ---- 端口
  P0: 0x80, P1: 0x90, P2: 0xA0, P3: 0xB0, P4: 0xC0,
  // ---- 系统
  SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87, PSW: 0xD0, ACC: 0xE0, B: 0xF0,
  // ---- 定时器
  TCON: 0x88, TMOD: 0x89, TL0: 0x8A, TL1: 0x8B, TH0: 0x8C, TH1: 0x8D,
  // ---- 串口
  SCON: 0x98, SBUF: 0x99,
  // ---- 中断
  IE: 0xA8, IP: 0xB8, IPH: 0xB7,
  // ---- STC89C52 扩展
  AUXR: 0x8E, AUXR1: 0xA2, WDTRST: 0xA6,
  T2CON: 0xC8, RCAP2L: 0xCA, RCAP2H: 0xCB, TL2: 0xCC, TH2: 0xCD
};

/** 位地址（供 SETB/CLR/JB 等位操作使用） */
export const BIT = {
  // P0
  P0_0: 0x80, P0_1: 0x81, P0_2: 0x82, P0_3: 0x83, P0_4: 0x84, P0_5: 0x85, P0_6: 0x86, P0_7: 0x87,
  // TCON
  IT0: 0x88, IE0: 0x89, IT1: 0x8A, IE1: 0x8B, TR0: 0x8C, TF0: 0x8D, TR1: 0x8E, TF1: 0x8F,
  // P1
  P1_0: 0x90, P1_1: 0x91, P1_2: 0x92, P1_3: 0x93, P1_4: 0x94, P1_5: 0x95, P1_6: 0x96, P1_7: 0x97,
  // SCON
  RI: 0x98, TI: 0x99, RB8: 0x9A, TB8: 0x9B, REN: 0x9C, SM2: 0x9D, SM1: 0x9E, SM0: 0x9F,
  // P2
  P2_0: 0xA0, P2_1: 0xA1, P2_2: 0xA2, P2_3: 0xA3, P2_4: 0xA4, P2_5: 0xA5, P2_6: 0xA6, P2_7: 0xA7,
  // IE
  EX0: 0xA8, ET0: 0xA9, EX1: 0xAA, ET1: 0xAB, ES: 0xAC, EA: 0xAF,
  // P3
  P3_0: 0xB0, P3_1: 0xB1, P3_2: 0xB2, P3_3: 0xB3, P3_4: 0xB4, P3_5: 0xB5, P3_6: 0xB6, P3_7: 0xB7,
  // IP
  PX0: 0xB8, PT0: 0xB9, PX1: 0xBA, PT1: 0xBB, PS: 0xBC,
  // T2CON
  T2CON_0: 0xC8,
  // PSW
  P: 0xD0, OV: 0xD2, RS0: 0xD3, RS1: 0xD4, F0: 0xD5, AC: 0xD6, CY: 0xD7,
  // ACC
  ACC_0: 0xE0,
  // B
  B_0: 0xF0
};

/** 端口位 → 引脚编号 (port<<3)|bit */
export const PIN_ID = (port, bit) => (port << 3) | bit;
export const pinIdFromPxy = (p) => PIN_ID(p.port, p.bit);
export function pinName(pinId) {
  const port = (pinId >> 3) & 7, bit = pinId & 7;
  if (port > 4) return 'P?' + bit;
  return `P${port}.${bit}`;
}
/** P3 引脚第二功能名 */
export const P3_ALT = {
  0: 'RXD', 1: 'TXD', 2: 'INT0', 3: 'INT1', 4: 'T0', 5: 'T1', 6: 'WR', 7: 'RD'
};
export const P1_ALT = { 0: 'T2', 1: 'T2EX', 2: 'ECI', 3: 'CEX0', 4: 'CEX1', 5: 'CEX2', 6: 'CEX3', 7: 'CEX4' };
