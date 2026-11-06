/*
 * asm8051.js — 8051 两遍汇编器（纯 JS，零依赖）
 * ==================================================================
 * 存在的意义（重要）：
 *   本平台首选 SDCC 编译 C；但若部署环境缺少 SDCC（例如某些纯云主机
 *   无法携带 280MB 工具链），汇编器保证平台仍具备"源码 → .hex"的完整
 *   通路，所有实验都能跑通。同时在测试中用于手工构造精确用例。
 *
 * 支持：
 *   · 全部 111 条标准 8051 指令 / 7 种寻址方式
 *   · 标号、ORG、EQU、BIT、END、DB、DW、DS
 *   · 表达式：十进制、0x 十六进制、二进制 0b、字符 'c'、标号±偏移、$（当前地址）
 *   · 生成 Intel HEX 文本
 *
 * 用法：
 *   const asm = new Asm8051();
 *   const r = asm.assemble(src);      // { ok, hex, code, listing, errors, symbols }
 */

// ---------------------------------------------------------------- 位地址表
const BITS = {
  IT0: 0x88, IE0: 0x89, IT1: 0x8A, IE1: 0x8B, TR0: 0x8C, TF0: 0x8D, TR1: 0x8E, TF1: 0x8F,
  RI: 0x98, TI: 0x99, RB8: 0x9A, TB8: 0x9B, REN: 0x9C, SM2: 0x9D, SM1: 0x9E, SM0: 0x9F,
  EX0: 0xA8, ET0: 0xA9, EX1: 0xAA, ET1: 0xAB, ES: 0xAC, ET2: 0xAD, EA: 0xAF,
  PX0: 0xB8, PT0: 0xB9, PX1: 0xBA, PT1: 0xBB, PS: 0xBC,
  P: 0xD0, OV: 0xD2, RS0: 0xD3, RS1: 0xD4, F0: 0xD5, AC: 0xD6, CY: 0xD7,
  T2CON_0: 0xC8, TF2: 0xCF, EXF2: 0xCE, RCLK: 0xCD, TCLK: 0xCC, EXEN2: 0xCB, TR2: 0xCA, C_T2: 0xC9, CP_RL2: 0xC8,
  ACC_0: 0xE0, B_0: 0xF0
};
// P0.0-P0.7, P1, P2, P3 位地址
for (let p = 0; p < 4; p++) for (let b = 0; b < 8; b++) BITS[`P${p}.${b}`] = (0x80 + p * 0x10) + b;
// 位寻址区 20H-2FH 的位
for (let n = 0; n < 128; n++) BITS[n.toString()] = n;   // 纯数字视为位地址（0-127）

// ---------------------------------------------------------------- SFR 名
const SFR_NAMES = {
  P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87, TCON: 0x88, TMOD: 0x89,
  TL0: 0x8A, TL1: 0x8B, TH0: 0x8C, TH1: 0x8D, P1: 0x90, SCON: 0x98, SBUF: 0x99,
  P2: 0xA0, IE: 0xA8, P3: 0xB0, IP: 0xB8, P4: 0xC0, PSW: 0xD0, ACC: 0xE0, B: 0xF0,
  // STC89C52 扩展
  AUXR: 0x8E, AUXR1: 0xA2, WDTRST: 0xA6, T2CON: 0xC8, RCAP2L: 0xCA, RCAP2H: 0xCB,
  TL2: 0xCC, TH2: 0xCD, IPH: 0xB7
};

/* ---------------------------------------------------------------- 指令编码表
 * 每条规则： mn 操作数形态 → 字节生成函数
 * op 类型标签：
 *   A / Rn / Ri / DPTR / ADPTR / APC / C / NC(取反位) / BIT / AB / DIRECT / IMM / IMM16 / REL / ADDR11 / ADDR16 / NUM
 */
class Asm8051 {
  constructor() { this.reset(); }

  reset() {
    this.errors = [];
    this.code = new Uint8Array(65536);
    this.symbols = Object.create(null);
    this.listing = [];
  }

  err(msg, line) { this.errors.push({ msg, line }); }

  /* ---------------------------------------------------------- 一行解析 */
  assemble(src, opts = {}) {
    this.reset();
    const base = opts.org ?? 0;
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');

    // ---------- 预处理：去注释、拆分 ----------
    const items = [];
    for (let i = 0; i < lines.length; i++) {
      let raw = lines[i];
      // 分号注释（引号内的分号保留）
      let text = '', inq = false;
      for (const ch of raw) {
        if (ch === "'") inq = !inq;
        if (ch === ';' && !inq) break;
        text += ch;
      }
      text = text.trim();
      if (!text) continue;
      let label = null, mnem = null, ops = [];
      // 标号后可跟冒号，也可直接空格
      const mLabel = text.match(/^([A-Za-z_.$][\w.$]*)\s*:\s*(.*)$/);
      if (mLabel) { label = mLabel[1]; text = mLabel[2].trim(); }
      else {
        const mLabel2 = text.match(/^([A-Za-z_.$][\w.$]*)\s+(.*)$/);
        if (mLabel2 && !this.isMnemonic(mLabel2[1])) { label = mLabel2[1]; text = mLabel2[2].trim(); }
      }
      if (text) {
        const sp = text.match(/^([A-Za-z_.$][\w.$]*)\s*(.*)$/);
        mnem = sp[1].toUpperCase();
        const rest = sp[2];
        // 按逗号切分操作数（引号/括号内不切）
        ops = [];
        if (rest) {
          let cur = '', depth = 0, inq2 = false;
          for (const ch of rest) {
            if (ch === "'") inq2 = !inq2;
            if (!inq2) {
              if (ch === '(') depth++;
              if (ch === ')') depth--;
              if (ch === ',' && depth === 0) { ops.push(cur.trim()); cur = ''; continue; }
            }
            cur += ch;
          }
          if (cur.trim()) ops.push(cur.trim());
        }
      }
      items.push({ line: i + 1, label, mnem, ops, raw: raw.trim() });
    }

    // ---------- 第 1 遍：确定地址，收集标号 ----------
    let pc = base;
    const sized = [];
    for (const it of items) {
      if (it.label !== null && it.label !== undefined) {
        if (this.symbols[it.label] !== undefined) this.err(`标号重复定义: ${it.label}`, it.line);
        this.symbols[it.label] = pc;
      }
      if (!it.mnem) { sized.push({ ...it, addr: pc, size: 0 }); continue; }
      const m = it.mnem;
      if (m === 'ORG') {
        const v = this.evalExpr(it.ops[0] ?? '0', it.line, true);
        pc = (v ?? pc) & 0xFFFF; sized.push({ ...it, addr: pc, size: 0, org: pc }); continue;
      }
      if (m === 'EQU' || m === 'BIT' || m === 'DATA' || m === 'SET') {
        // 形如  NAME EQU 20H  —— 标号存值
        if (it.label) this.symbols[it.label] = this.evalExpr(it.ops[0] ?? '0', it.line, true) ?? 0;
        sized.push({ ...it, addr: pc, size: 0 }); continue;
      }
      if (m === 'END') { sized.push({ ...it, addr: pc, size: 0 }); break; }
      if (m === 'DB' || m === 'DEFB' || m === 'BYTE') {
        let n = 0; for (const o of it.ops) n += this.dbCount(o);
        sized.push({ ...it, addr: pc, size: n }); pc += n; continue;
      }
      if (m === 'DW') { const n = it.ops.length * 2; sized.push({ ...it, addr: pc, size: n }); pc += n; continue; }
      if (m === 'DS' || m === 'DEFS') {
        const n = this.evalExpr(it.ops[0] ?? '0', it.line, true) ?? 0;
        sized.push({ ...it, addr: pc, size: n }); pc += n; continue;
      }
      const size = this.lengthOf(m, it.ops);
      sized.push({ ...it, addr: pc, size });
      pc += size;
    }

    // ---------- 第 2 遍：生成机器码 ----------
    for (const it of sized) {
      if (it.org !== undefined) continue;
      const m = it.mnem;
      let bytes = null;
      if (!m) bytes = [];
      else if (m === 'ORG' || m === 'EQU' || m === 'BIT' || m === 'DATA' || m === 'SET' || m === 'END') bytes = [];
      else if (m === 'DB' || m === 'DEFB' || m === 'BYTE') bytes = this.dbBytes(it.ops, it.line);
      else if (m === 'DW') bytes = this.dwBytes(it.ops, it.line);
      else if (m === 'DS' || m === 'DEFS') bytes = new Array(this.evalExpr(it.ops[0] ?? '0', it.line, true) ?? 0).fill(0);
      else bytes = this.encode(m, it.ops, it.addr, it.line);
      if (!bytes) continue;
      for (let i = 0; i < bytes.length; i++) this.code[(it.addr + i) & 0xFFFF] = bytes[i] & 0xFF;
      if (it.label) this.symbols[it.label] = it.addr;
      this.listing.push({
        line: it.line, addr: it.addr, bytes: bytes.slice(),
        text: `${it.label ? it.label + ':' : ''}\t${m || ''}\t${it.ops.join(',')}`.trim(),
        src: it.raw
      });
    }

    // ---------- 输出 ----------
    let min = 0x10000, max = -1;
    for (const l of this.listing) if (l.bytes.length) { if (l.addr < min) min = l.addr; if (l.addr + l.bytes.length - 1 > max) max = l.addr + l.bytes.length - 1; }
    const hex = (max < 0) ? '' : this.toHex(this.code, min, max);
    return {
      ok: this.errors.length === 0,
      hex, errors: this.errors, listing: this.listing,
      symbols: { ...this.symbols },
      minAddr: min === 0x10000 ? 0 : min, maxAddr: Math.max(max, 0)
    };
  }

  isMnemonic(w) {
    return /^(NOP|AJMP|LJMP|RR|RRC|RL|RLC|INC|DEC|JBC|ACALL|LCALL|JB|RET|RETI|JNB|JC|JNC|JZ|JNZ|JMP|SJMP|MOV|MOVC|MOVX|ORL|ANL|XRL|PUSH|POP|XCH|XCHD|CLR|SETB|CPL|ADD|ADDC|SUBB|MUL|DIV|DA|DJNZ|CJNE|SWAP|ORG|EQU|BIT|END|DB|DW|DS|NOP|NOT|DATA)$/i.test(w);
  }

  /* ---------------------------------------------------------- 表达式求值 */
  evalExpr(expr, line, quiet = false) {
    if (expr == null) return null;
    let e = String(expr).trim();
    if (!e) return null;
    // 替换标识符
    e = e.replace(/\$|\b[0-9A-Za-z_.$][\w.$]*\b/g, (tok) => {
      if (tok === '$') return String(line === undefined ? 0 : 0);   // $ 由调用处替换
      if (/^0[xX][0-9a-fA-F]+$/.test(tok)) return String(parseInt(tok, 16));
      if (/^0[bB][01]+$/.test(tok)) return String(parseInt(tok.slice(2), 2));
      if (/^\d+$/.test(tok)) return tok;
      if (/^[0-9A-Fa-f]+[hH]$/.test(tok)) return String(parseInt(tok.slice(0, -1), 16));
      const v = this.symbols[tok];
      if (v !== undefined) return String(v);
      // SFR 名称（P0/SP/TCON/TMOD/...）可直接作为直接地址使用
      const up = tok.toUpperCase();
      if (SFR_NAMES[up] !== undefined) return String(SFR_NAMES[up]);
      if (up === 'PSW') return '208';
      return tok;  // 保留，稍后判错
    });
    // 字符字面量
    e = e.replace(/'(.|\\.)'/g, (mm, c) => String(c.charCodeAt(0)));
    // 一元 + - 与括号、四则、按位
    if (!/^[\d\s+\-*/%()<>&|^~]+$/.test(e)) {
      if (!quiet) this.err(`表达式无法求值: ${expr}`, line);
      return null;
    }
    if (/[A-Za-z_.]/.test(e.replace(/0[xXbB]/g, ''))) {
      if (!quiet) this.err(`未定义符号: ${expr}`, line);
      return null;
    }
    try {
      // 只允许安全字符，用 Function 求值
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict";return (${e});`)();
      if (typeof v !== 'number' || !isFinite(v)) { if (!quiet) this.err(`表达式结果非法: ${expr}`, line); return null; }
      return Math.trunc(v);
    } catch (ex) {
      // 按位运算失败时（JS 不支持 ^ 位运算的十六进制），直接报错
      if (!quiet) this.err(`表达式语法错误: ${expr}`, line);
      return null;
    }
  }
  /** $ 需要当前地址，单独处理 */
  evalAt(expr, addr, line) {
    if (expr == null) return null;
    const e = String(expr).trim();
    if (e.includes('$')) return this.evalExpr(e.replace(/\$/g, String(addr)), line, true);
    // 也支持 HERE
    return this.evalExpr(e.replace(/\bHERE\b/gi, String(addr)), line, true);
  }

  dbCount(o) { return /^['"]/.test(o.trim()) ? this.strLen(o) : 1; }
  strLen(o) {
    const m = String(o).trim().match(/^(['"])([\s\S]*)\1$/);
    return m ? m[2].replace(/\\./g, 'x').length : 1;
  }
  dbBytes(ops, line) {
    const out = [];
    for (const o of ops) {
      const t = o.trim();
      const ms = t.match(/^(['"])([\s\S]*)\1$/);
      if (ms) {
        const s = ms[2];
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '\\' && i + 1 < s.length) {
            const n = s[++i];
            out.push(n === 'n' ? 10 : n === 't' ? 9 : n === 'r' ? 13 : n === '0' ? 0 : n.charCodeAt(0));
          } else out.push(s.charCodeAt(i) & 0xFF);
        }
        continue;
      }
      const v = this.evalExpr(t, line, true);
      if (v === null) { this.err(`DB 参数无法求值: ${t}`, line); out.push(0); }
      else out.push(v & 0xFF);
    }
    return out;
  }
  dwBytes(ops, line) {
    const out = [];
    for (const o of ops) {
      const v = this.evalExpr(o, line, true);
      if (v === null) { this.err(`DW 参数无法求值: ${o}`, line); out.push(0, 0); }
      else { out.push((v >> 8) & 0xFF, v & 0xFF); }   // 大端
    }
    return out;
  }

  /* ---------------------------------------------------------- 操作数形态
   * 只做"语法形态"判断，不做数值分类：
   *   数值/表达式一律记作 DIR，具体是"直接地址"还是"位地址"由所在指令决定
   *   （例如 MOV A,20H 是直接地址，而 MOV C,20H 是位地址）
   */
  shapeOf(o) {
    const t = String(o).trim();
    if (/^A$/i.test(t)) return 'A';
    if (/^AB$/i.test(t)) return 'AB';
    if (/^C$/i.test(t)) return 'C';
    if (/^DPTR$/i.test(t)) return 'DPTR';
    if (/^\//.test(t)) return 'NOTBIT';
    if (/^@\s*D?PTR$/i.test(t)) return 'ADPTR';
    if (/^@\s*R[01]$/i.test(t)) return 'Ri';
    if (/^@\s*A\s*\+/.test(t)) return 'APLUS';
    if (/^R[0-7]$/i.test(t)) return 'Rn';
    if (/^#/.test(t)) return 'IMM';
    return 'DIR';
  }

  /* ---------------------------------------------------------- 指令长度（第 1 遍）
   * 8051 指令长度只由"助记符 + 操作数形态"决定，与具体地址无关，
   * 因此第一遍即可精确算出每条指令长度，无需迭代。
   * tests/asm.test.mjs 会逐条校验此表与 encode() 的实际输出长度一致。
   */
  lengthOf(m, ops) {
    const s = ops.map(o => this.shapeOf(o));
    switch (m) {
      case 'NOP': case 'RET': case 'RETI':
      case 'RR': case 'RRC': case 'RL': case 'RLC':
      case 'MUL': case 'DIV': case 'DA': case 'SWAP':
      case 'MOVC': case 'MOVX': case 'XCHD': case 'JMP':
        return 1;
      case 'INC': case 'DEC':
        return (s[0] === 'A' || s[0] === 'Rn' || s[0] === 'Ri') ? 1 : 2;
      case 'ADD': case 'ADDC': case 'SUBB': case 'XRL':
        if (s[0] === 'A') return (s[1] === 'Ri' || s[1] === 'Rn') ? 1 : 2;
        return (s[1] === 'IMM') ? 3 : 2;
      case 'ORL': case 'ANL':
        if (s[0] === 'A') return (s[1] === 'Ri' || s[1] === 'Rn') ? 1 : 2;
        if (s[0] === 'C') return 2;
        return (s[1] === 'IMM') ? 3 : 2;
      case 'MOV':
        if (s[0] === 'A') return (s[1] === 'Ri' || s[1] === 'Rn') ? 1 : 2;
        if (s[0] === 'Rn' || s[0] === 'Ri') return (s[1] === 'A') ? 1 : 2;
        if (s[0] === 'DPTR') return 3;
        if (s[0] === 'C' || s[1] === 'C') return 2;
        if (s[1] === 'A') return 2;
        if (s[1] === 'Rn' || s[1] === 'Ri') return 2;
        if (s[1] === 'IMM') return 3;
        return 3;                       // MOV direct,direct
      case 'PUSH': case 'POP': case 'JC': case 'JNC': case 'JZ': case 'JNZ':
      case 'SJMP': case 'AJMP': case 'ACALL':
        return 2;
      case 'XCH': return (s[1] === 'Rn' || s[1] === 'Ri') ? 1 : 2;
      case 'CLR': case 'SETB': case 'CPL':
        return (s[0] === 'A' || s[0] === 'C') ? 1 : 2;
      case 'JB': case 'JNB': case 'JBC': case 'CJNE':
        return 3;
      case 'LJMP': case 'LCALL': return 3;
      case 'DJNZ': return (s[0] === 'Rn') ? 2 : 3;
      default: return 2;
    }
  }

  /* ---------------------------------------------------------- 位地址求值
   * 支持：位名（EA/TR0/P1.3/CY ...）、P0-P3 的 Px.y、以及任何求值为
   * 0..0xFF 的表达式（即标准 8051 的位地址空间）
   */
  bitVal(t, line, addr) {
    const s = String(t).trim();
    const up = s.toUpperCase();
    if (BITS[s] !== undefined) return BITS[s];
    if (BITS[up] !== undefined) return BITS[up];
    const m = s.match(/^P([0-3])\.([0-7])$/i);
    if (m) return 0x80 + (+m[1]) * 0x10 + (+m[2]);
    const v = this.evalAt(s, addr, line);
    if (v === null) { this.err(`位地址无法求值: ${t}`, line); return 0; }
    if (v < 0 || v > 0xFF) { this.err(`位地址超出 0..0xFF: ${t}`, line); return 0; }
    return v & 0xFF;
  }

  /* ---------------------------------------------------------- 编码（第 2 遍） */
  encode(m, ops, addr, line) {
    const t = ops.map(o => String(o).trim());
    const L = (v) => this.evalAt(v, addr, line);
    const imm8 = (k) => { const v = this.evalAt(t[k].slice(1), addr, line); return v === null ? (this.err(`立即数无法求值 ${t[k]}`, line), 0) : (v & 0xFF); };
    const dir = (k) => { const v = this.evalAt(t[k], addr, line); if (v === null) { this.err(`直接地址无法求值 ${t[k]}`, line); return 0; } return v & 0xFF; };
    const relFrom = (k, nextLen) => {
      const v = this.evalAt(t[k], addr, line);
      if (v === null) { this.err(`跳转目标无法求值 ${t[k]}`, line); return 0; }
      let d = v - (addr + nextLen);
      if (d > 127 || d < -128) this.err(`相对跳转超出 ±128 字节: ${t[k]} (偏移 ${d})`, line);
      return d & 0xFF;
    };
    const isRn = (k) => /^R[0-7]$/i.test(t[k] || '');
    const isRi = (k) => /^@\s*R[01]$/i.test(t[k] || '');
    const isA = (k) => /^A$/i.test(t[k] || '');
    const isC = (k) => /^C$/i.test(t[k] || '');
    const isDir = (k) => t[k] !== undefined && !isA(k) && !isC(k) && !isRn(k) && !isRi(k) && !/^#/.test(t[k]) && !/^@/.test(t[k]);
    const rn = (k) => +t[k].match(/^R([0-7])$/i)[1];
    const ri = (k) => +t[k].match(/^@\s*R([01])$/i)[1];

    switch (m) {
      case 'NOP': return [0x00];
      case 'RET': return [0x22];
      case 'RETI': return [0x32];
      case 'RR': return [0x03];
      case 'RRC': return [0x13];
      case 'RL': return [0x23];
      case 'RLC': return [0x33];
      case 'AB': return [0x00];
      case 'MUL': return [0xA4];
      case 'DIV': return [0x84];
      case 'DA': return [0xD4];
      case 'SWAP': return [0xC4];

      case 'INC':
      case 'DEC': {
        const b = m === 'INC' ? 0x00 : 0x10;
        if (isA(0)) return [b + 0x04];
        if (isRn(0)) return [b + 0x08 + rn(0)];
        if (isRi(0)) return [b + 0x06 + ri(0)];
        return [b + 0x05, dir(0)];
      }
      case 'ADD': case 'ADDC': case 'SUBB': case 'ORL': case 'ANL': case 'XRL': {
        const map = {
          ADD: { imm: 0x24, dir: 0x25, ri: 0x26, rn: 0x28 },
          ADDC: { imm: 0x34, dir: 0x35, ri: 0x36, rn: 0x38 },
          SUBB: { imm: 0x94, dir: 0x95, ri: 0x96, rn: 0x98 },
          ORL: { imm: 0x44, dir: 0x45, ri: 0x46, rn: 0x48 },
          ANL: { imm: 0x54, dir: 0x55, ri: 0x56, rn: 0x58 },
          XRL: { imm: 0x64, dir: 0x65, ri: 0x66, rn: 0x68 }
        }[m];
        // 累加器在左
        if (isA(0)) {
          if (/^#/.test(t[1] || '')) return [map.imm, imm8(1)];
          if (isRi(1)) return [map.ri + ri(1)];
          if (isRn(1)) return [map.rn + rn(1)];
          return [map.dir, dir(1)];
        }
        // 位运算类：direct,A / direct,#imm / C,bit / C,/bit
        if ((m === 'ORL' || m === 'ANL')) {
          if (isC(0) && /^\//.test(t[1] || '')) return [m === 'ORL' ? 0xA0 : 0xB0, this.bitVal(t[1].slice(1), line, addr)];
          if (isC(0)) return [m === 'ORL' ? 0x72 : 0x82, this.bitVal(t[1], line, addr)];
        }
        if (/^#/.test(t[1] || '')) return [m === 'ORL' ? 0x43 : m === 'ANL' ? 0x53 : 0x63, dir(0), imm8(1)];
        if (isA(1)) return [m === 'ORL' ? 0x42 : m === 'ANL' ? 0x52 : 0x62, dir(0)];
        this.err(`${m} 的操作数组合不受支持: ${t.join(',')}`, line); return null;
      }

      case 'MOV': {
        // MOV A, ...
        if (isA(0)) {
          if (/^#/.test(t[1] || '')) return [0x74, imm8(1)];
          if (isRi(1)) return [0xE6 + ri(1)];
          if (isRn(1)) return [0xE8 + rn(1)];
          return [0xE5, dir(1)];
        }
        // MOV Rn, ...
        if (isRn(0)) {
          if (/^#/.test(t[1] || '')) return [0x78 + rn(0), imm8(1)];
          if (isA(1)) return [0xF8 + rn(0)];
          return [0xA8 + rn(0), dir(1)];
        }
        // MOV @Ri, ...
        if (isRi(0)) {
          if (/^#/.test(t[1] || '')) return [0x76 + ri(0), imm8(1)];
          if (isA(1)) return [0xF6 + ri(0)];
          return [0xA6 + ri(0), dir(1)];
        }
        // MOV direct, ...
        if (/^DPTR$/i.test(t[0] || '')) {
          // 注意：16 位立即数带 '#' 前缀，必须先剥掉再求值
          const v = this.evalAt(String(t[1] || '').replace(/^#\s*/, ''), addr, line);
          if (v === null) { this.err(`DPTR 立即数无法求值: ${t[1]}`, line); return [0x90, 0, 0]; }
          return [0x90, (v >> 8) & 0xFF, v & 0xFF];
        }
        if (/^C$/i.test(t[0] || '')) return [0xA2, this.bitVal(t[1], line, addr)];      // MOV C,bit
        if (/^C$/i.test(t[1] || '')) return [0x92, this.bitVal(t[0], line, addr)];      // MOV bit,C
        if (isA(1)) return [0xF5, dir(0)];
        if (isRn(1)) return [0x88 + rn(1), dir(0)];
        if (isRi(1)) return [0x86 + ri(1), dir(0)];
        if (/^#/.test(t[1] || '')) return [0x75, dir(0), imm8(1)];
        return [0x85, dir(1), dir(0)];                                                   // MOV direct,direct
      }
      case 'MOVC': {
        if (/^@\s*A\s*\+\s*DPTR$/i.test(t[1] || '')) return [0x93];
        if (/^@\s*A\s*\+\s*PC$/i.test(t[1] || '')) return [0x83];
        this.err('MOVC 仅支持 A,@A+DPTR 或 A,@A+PC', line); return null;
      }
      case 'MOVX': {
        if (isA(0)) {
          if (/^@\s*DPTR$/i.test(t[1] || '')) return [0xE0];
          if (isRi(1)) return [0xE2 + ri(1)];
        }
        if (/^@\s*DPTR$/i.test(t[0] || '')) return [0xF0];
        if (isRi(0)) return [0xF2 + ri(0)];
        this.err('MOVX 操作数不受支持', line); return null;
      }
      case 'PUSH': return [0xC0, dir(0)];
      case 'POP': return [0xD0, dir(0)];
      case 'XCH': {
        if (/^@/i.test(t[1] || '')) return [0xC6 + ri(1)];
        if (isRn(1)) return [0xC8 + rn(1)];
        return [0xC5, dir(1)];
      }
      case 'XCHD': return [0xD6 + ri(1)];
      case 'CLR': {
        if (isA(0)) return [0xE4];
        if (isC(0)) return [0xC3];
        return [0xC2, this.bitVal(t[0], line, addr)];
      }
      case 'SETB': {
        if (isC(0)) return [0xD3];
        return [0xD2, this.bitVal(t[0], line, addr)];
      }
      case 'CPL': {
        if (isA(0)) return [0xF4];
        if (isC(0)) return [0xB3];
        return [0xB2, this.bitVal(t[0], line, addr)];
      }
      case 'JC': return [0x40, relFrom(0, 2)];
      case 'JNC': return [0x50, relFrom(0, 2)];
      case 'JZ': return [0x60, relFrom(0, 2)];
      case 'JNZ': return [0x70, relFrom(0, 2)];
      case 'JB': return [0x20, this.bitVal(t[0], line, addr), relFrom(1, 3)];
      case 'JNB': return [0x30, this.bitVal(t[0], line, addr), relFrom(1, 3)];
      case 'JBC': return [0x10, this.bitVal(t[0], line, addr), relFrom(1, 3)];
      case 'JMP': return [0x73];
      case 'SJMP': return [0x80, relFrom(0, 2)];
      case 'LJMP': { const v = L(t[0]); if (v === null) { this.err('LJMP 目标无法求值', line); return null; } return [0x02, (v >> 8) & 0xFF, v & 0xFF]; }
      case 'LCALL': { const v = L(t[0]); if (v === null) { this.err('LCALL 目标无法求值', line); return null; } return [0x12, (v >> 8) & 0xFF, v & 0xFF]; }
      case 'AJMP': case 'ACALL': {
        const v = L(t[0]);
        if (v === null) { this.err(`${m} 目标无法求值`, line); return null; }
        const next = addr + 2;
        if ((v & 0xF800) !== (next & 0xF800)) this.err(`${m} 目标必须与下一条指令在同一 2KB 页内`, line);
        const a10a8 = (v >> 8) & 0x07, a7a0 = v & 0xFF;
        return [(m === 'AJMP' ? 0x01 : 0x11) | (a10a8 << 5), a7a0];
      }
      case 'DJNZ': {
        if (isRn(0)) return [0xD8 + rn(0), relFrom(1, 2)];
        return [0xD5, dir(0), relFrom(1, 3)];
      }
      case 'CJNE': {
        if (isA(0) && /^#/.test(t[1] || '')) return [0xB4, imm8(1), relFrom(2, 3)];
        if (isA(0) && isA(1)) { /* 不合法 */ }
        if (isA(0)) return [0xB5, dir(1), relFrom(2, 3)];
        if (isRi(0)) return [0xB6 + ri(0), imm8(1), relFrom(2, 3)];
        return [0xB8 + rn(0), imm8(1), relFrom(2, 3)];
      }
      default:
        this.err(`不支持的助记符: ${m}`, line);
        return null;
    }
  }

  /* ---------------------------------------------------------- Intel HEX */
  toHex(code, start, end) {
    const out = [];
    const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
    for (let a = start & 0xFFF0; a <= end; a += 16) {
      const data = [];
      for (let i = 0; i < 16; i++) data.push(code[(a + i) & 0xFFFF] & 0xFF);
      // 尾部全 0 且超出 end 的裁剪
      while (data.length && a + data.length - 1 > end && data[data.length - 1] === 0) data.pop();
      if (!data.length) continue;
      const addr = a & 0xFFFF;
      const rec = [data.length, (addr >> 8) & 0xFF, addr & 0xFF, 0x00, ...data];
      const sum = (-rec.reduce((x, y) => (x + y) & 0xFF, 0)) & 0xFF;
      out.push(':' + rec.map(h2).join('') + h2(sum));
    }
    out.push(':00000001FF');
    return out.join('\n');
  }
}

/* ---------------------------------------------------------------- 指令长度表
 * 仅对"同一助记符因寻址方式不同而长度不同"的指令给出映射；其余按默认 2 字节。
 * 与 encode() 保持严格一致（tests/asm.test.mjs 会逐条校验长度）。
 */
const LENGTHS = null;

export { Asm8051 };
export function assemble(src, opts) { return new Asm8051().assemble(src, opts); }
