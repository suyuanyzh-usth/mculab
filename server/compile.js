/*
 * compile.js — 编译服务：C → .hex
 * ==================================================================
 * 链路：sdcc → .ihx → packihx → .hex
 *
 * 三条通路，按可用性自动降级（这是本平台"任意网络、任意环境可用"的关键）：
 *   ① SDCC（首选）：完整 C 语言 + 标准库（<stdio.h> / <string.h> / <math.h> …）
 *   ② 内置汇编器：源码以 "__ASM__" 开头时走此路（零依赖，保证平台永远可用）
 *   ③ 预编译 .hex：实验自带的成品，可直接加载运行
 *
 * 重要实现细节（踩坑记录）：
 *   · SDCC 依赖 PATH 中的 cc1（前端），必须把 <sdcc>/bin 加入子进程 PATH，
 *     否则报 "cannot execute 'cc1': No such file or directory"。
 *   · --stack-auto 时库路径为 lib/small-stack-auto，该目录必须随工具链一起分发。
 *   · printf 需要用户提供 putchar；平台自动注入一个基于 UART 的 putchar 实现，
 *     让学生写 printf 就能从串口输出（对标 Keil 的使用习惯）。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isWin = process.platform === 'win32';

/** 平台注入的 UART printf 支持（仅当用户没有自己定义 putchar 时注入） */
export const PLATFORM_PRINTF_STUB = `
/* ===== 平台自动注入：让 printf/puts 直接输出到串口（9600bps @11.0592MHz）=====
 * 注意：不能写成 while(!TI); 再写 SBUF —— 复位后 TI=0，第一次发送会死等。
 *       正确做法是首次直接写 SBUF，之后每次等待上一字节发送完成。
 */
#ifndef MCULAB_NO_PUTCHAR
#include <stc89.h>
static char mculab_uart_ready = 0;
static char mculab_tx_started = 0;
void mculab_uart_init(void){
  TMOD = (TMOD & 0x0F) | 0x20;   /* Timer1 方式2（8 位自动重装） */
  TH1 = 0xFD; TL1 = 0xFD;        /* 9600bps @ 11.0592MHz, SMOD=0 */
  SCON = 0x50;                   /* 方式1(8 位 UART), REN=1 */
  TR1 = 1;
}
int putchar(int c){
  if (!mculab_uart_ready) { mculab_uart_init(); mculab_uart_ready = 1; }
  if (mculab_tx_started) {
    while (!(SCON & 0x02));      /* 等上一字节的 TI */
  }
  SCON &= ~0x02;                 /* 清 TI */
  SBUF = (unsigned char)c;       /* 启动发送 */
  mculab_tx_started = 1;
  return c;
}
#endif
`;

/**
 * 把代码块插到最后一个 #include 之后。
 * 目的：保证库头文件里的函数原型先出现，这样后续定义才会被 SDCC
 *       以 .globl 输出（putchar 就是典型例子）。
 */
function injectAfterIncludes(src, block) {
  const lines = String(src).split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#\s*include\b/.test(lines[i])) last = i;
  }
  if (last < 0) return block + '\n' + src;
  lines.splice(last + 1, 0, '', block, '');
  return lines.join('\n');
}

const ASSEMBLY_MARK = /^\s*(;|#)?\s*__ASM__/i;

/* ------------------------------------------------------------------
 * Keil C51 → SDCC 语法兼容翻译
 * ------------------------------------------------------------------
 * 国内教材、实验指导书与网络例程几乎都是 Keil C51 写法，学生复制粘贴后
 * 若直接交给 SDCC 会报 syntax error。这里做保守的等价替换：
 *
 *   sbit LCD_RS = P2^5;              →  __sbit __at (0xA5) LCD_RS;
 *   unsigned char code tab[] = {...}  →  __code unsigned char tab[] = {...}
 *   void isr() interrupt 1            →  void isr() __interrupt(1)
 *   xdata / idata / bdata             →  __xdata / __idata / __bdata
 *   bit flag;                         →  __bit flag;
 *
 * 只在高置信度上下文替换（类型关键字 + code、SFR^bit、interrupt N），
 * 不会破坏字符串与普通注释中的同名词。
 */
const KEIL_BITBASE = {
  P0: 0x80, P1: 0x90, P2: 0xA0, P3: 0xB0,
  TCON: 0x88, SCON: 0x98, IE: 0xA8, IP: 0xB8, PSW: 0xD0, ACC: 0xE0, B: 0xF0
};
const TYPE_ALT = 'unsigned\\s+char|unsigned\\s+int|unsigned\\s+long|unsigned\\s+short|char|int|long|short|float';

export function keilToSdcc(src) {
  const changes = [];
  const mark = (m) => { if (!changes.includes(m)) changes.push(m); };
  let out = String(src);

  // sbit NAME = P2^5;   （也支持 TCON^0 等位寻址 SFR）
  // 位地址规则：可位寻址 SFR 的位地址 = SFR 字节地址 + 位号（SFR 地址已 8 字节对齐），
  // 例如 P2=0xA0 → P2^5 = 0xA5。注意不是 sfr*8+bit（那只适用于 0x20–0x2F 的 IRAM 位区）。
  out = out.replace(/\bsbit\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\^\s*(\d+)\s*;/g,
    (m, name, reg, bit) => {
      const base = KEIL_BITBASE[reg.toUpperCase()];
      const b = Number(bit);
      if (base === undefined || b > 7) return m;
      mark('sbit → __sbit __at');
      return `__sbit __at (0x${(base + b).toString(16).toUpperCase()}) ${name};`;
    });

  // 类型 code → __code
  out = out.replace(new RegExp(`\\b(${TYPE_ALT})\\s+code\\s+`, 'g'), (m, t) => {
    mark('code → __code'); return `__code ${t} `;
  });
  out = out.replace(new RegExp(`\\bcode\\s+(${TYPE_ALT})\\s+`, 'g'), (m, t) => {
    mark('code → __code'); return `__code ${t} `;
  });

  // 中断向量写法
  out = out.replace(/\binterrupt\s+(\d+)(?:\s+using\s+\d+)?/g, (m, n) => {
    mark('interrupt N → __interrupt(N)'); return `__interrupt(${n})`;
  });

  // 存储器空间关键字
  for (const [k, v] of [['xdata', '__xdata'], ['idata', '__idata'], ['bdata', '__bdata']]) {
    const re = new RegExp(`\\b${k}\\b`, 'g');
    if (re.test(out)) { mark(`${k} → ${v}`); out = out.replace(re, v); }
  }

  // 位变量 / 以 bit 为返回类型的函数：bit flag;   bit i2cSendByte(...)   bit f();
  out = out.replace(/\bbit\s+([A-Za-z_]\w*)\s*([=;,(])/g, (m, name, tail) => {
    mark('bit → __bit'); return `__bit ${name} ${tail}`;
  });

  return { text: out, changes };
}


export class Compiler {
  constructor(opts = {}) {
    this.sdccDir = opts.sdccDir || path.resolve(import.meta.dirname, '..', 'toolchain', 'sdcc');
    // 允许指向系统安装的 SDCC（如 Linux 上 apt install sdcc → /usr/bin）
    //   MCULAB_SDCC_BIN=/usr/bin node server/index.js
    /*
     * 工具链定位顺序（跨平台）：
     *   1. 显式 opts.binDir
     *   2. 环境变量 MCULAB_SDCC_BIN（如 Linux 上 apt 装的 /usr/bin）
     *   3. 项目自带的 toolchain/sdcc/bin（Windows 便携版；Linux 上也可用官方压缩包解压到此）
     *   4. 系统 PATH 里的 sdcc（容器/云主机最常见）
     * 这样同一份代码既能在教师的 Windows 电脑上跑，也能在 Linux 容器里跑。
     */
    this.binDir = opts.binDir || process.env.MCULAB_SDCC_BIN || path.join(this.sdccDir, 'bin');
    this.sdccExe = this._resolveExe('sdcc');
    this.packihxExe = this._resolveExe('packihx');
    // 平台自带头文件（intrins.h 等 SDCC 未提供但教材通用的头文件）
    this.platformInc = opts.platformInc || path.resolve(import.meta.dirname, '..', 'platform', 'include');
    this.workRoot = opts.workRoot || path.resolve(import.meta.dirname, '..', 'data', 'build');
    this.timeoutMs = opts.timeoutMs || 30000;
    this.available = null;             // 探测结果缓存
    this.probeError = null;
    if (!fs.existsSync(this.workRoot)) fs.mkdirSync(this.workRoot, { recursive: true });
  }

  /**
   * 找可执行文件。搜索顺序：
   *   binDir（Windows 便携版 / 用户指定） → 同级的 toolchain/sdcc-linux/bin → PATH
   * 之所以带 Linux 便携版：云沙箱里没有 apt、也装不了包，
   * 只能把 Linux 版编译器随项目一起上传（见 toolchain/sdcc-linux）。
   */
  _resolveExe(name) {
    const names = isWin ? [name + '.exe', name] : [name, name + '.exe'];
    const dirs = [this.binDir, path.join(path.dirname(this.sdccDir), 'sdcc-linux', 'bin')];
    for (const dir of dirs) {
      for (const n of names) {
        const p = path.join(dir, n);
        try { if (fs.existsSync(p)) return p; } catch { }
      }
    }
    return name;      // 交给 PATH；probe() 会验证到底能不能跑
  }

  /**
   * 压缩上传会丢可执行位，导致 EACCES。这里在启动时补一次 chmod。
   * 仅 POSIX 生效，且只对工具链目录内的文件操作，失败也不影响流程。
   */
  _ensureExec() {
    if (isWin) return;
    const dir = path.dirname(this.sdccExe || '');
    if (!dir || dir === '.') return;
    for (const n of ['sdcc', 'sdcpp', 'sdas8051', 'sdld', 'packihx', 'makebin']) {
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        if (!(st.mode & 0o111)) fs.chmodSync(p, 0o755);
      } catch { }
    }
  }

  get supported() {
    // 绝对路径 → 看文件是否存在；裸命令名 → 假定在 PATH（由 probe 实测）
    if (this.sdccExe && this.sdccExe.includes(path.sep)) return fs.existsSync(this.sdccExe);
    return true;
  }
  get isAvailable() { return this.supported && this.available !== false; }

  /** 实测能否真正执行 SDCC（有些运行环境禁止派生子进程） */
  async probe() {
    if (!this.supported) { this.available = false; this.probeError = '未找到 SDCC 工具链目录：' + this.binDir; return { ok: false, error: this.probeError }; }
    this._ensureExec();
    try {
      // 注意：run(args) 的 args[0] 必须是可执行文件路径
      const r = await this.run([this.sdccExe, '--version'], this.workRoot, 8000);
      this.available = r.code === 0 || /SDCC/i.test(r.stdout + r.stderr);
      if (!this.available) this.probeError = (r.stderr || r.stdout || '').slice(0, 500);
      return { ok: this.available, version: (r.stdout || '').split('\n')[0], error: this.probeError };
    } catch (e) {
      this.available = false;
      this.probeError = e.message;
      return { ok: false, error: e.message };
    }
  }

  /** 运行子进程；把 SDCC bin 目录放入 PATH（SDCC 需要能找到 cc1） */
  run(args, cwd, timeout = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      /*
       * 两个容易致命的细节：
       *  1) cwd 必须真实存在。spawn 在 cwd 不存在时抛的是 ENOENT，
       *     看起来像"可执行文件找不到"，实际是工作目录没了——
       *     云端曾因此误判成"SDCC 缺失"（binDir 只带 sdcc-linux，没有 bin）。
       *  2) PATH 要用"可执行文件所在目录"，否则 sdcc 找不到它的 sdcpp / sdas8051 / sdld。
       */
      const execDir = path.dirname(this.sdccExe && this.sdccExe.includes(path.sep) ? this.sdccExe : args[0]);
      const workDir = (cwd && fs.existsSync(cwd)) ? cwd : (this.workRoot || process.cwd());
      const pathDirs = [execDir, this.binDir].filter(d => d && fs.existsSync(d));
      const env = { ...process.env, PATH: [...pathDirs, process.env.PATH || ''].join(path.delimiter) };
      const child = spawn(args[0], args.slice(1), { cwd: workDir, env, windowsHide: true });
      let out = '', err = '';
      const t = setTimeout(() => { try { child.kill(); } catch { } reject(new Error('编译超时（' + timeout + 'ms）')); }, timeout);
      child.stdout.on('data', d => out += d.toString('utf8'));
      child.stderr.on('data', d => err += d.toString('utf8'));
      child.on('error', e => { clearTimeout(t); reject(new Error(`无法启动编译进程（${e.code || ''}）：${e.message}`)); });
      child.on('close', code => { clearTimeout(t); resolve({ code, stdout: out, stderr: err }); });
    });
  }

  /**
   * 编译入口
   * @param {string} source  C 源码（或以 __ASM__ 开头的汇编源码）
   * @param {object} opts    { name, injectPrintf, mcu, includes, defines, extraFiles }
   * @returns {Promise<{ok, hex?, errors, warnings, listing?, via, log, size?}>}
   */
  async compile(source, opts = {}) {
    const name = (opts.name || 'main').replace(/[^\w.-]/g, '_');
    const dir = fs.mkdtempSync(path.join(this.workRoot, name + '-'));
    const errors = [], warnings = [], log = [];

    // ---------- 通路②：内置汇编器 ----------
    if (ASSEMBLY_MARK.test(source) && opts.forceAssembler !== false) {
      try {
        const { assemble } = await import('../public/js/core/asm8051.js');
        const cleaned = String(source).replace(ASSEMBLY_MARK, '');
        const r = assemble(cleaned);
        if (!r.ok) {
          return { ok: false, via: 'assembler', errors: r.errors.map(e => ({ line: e.line, msg: e.msg })), warnings, log: ['使用内置 8051 汇编器（零依赖通路）'] };
        }
        return {
          ok: true, via: 'assembler', hex: r.hex, listing: r.listing,
          errors: [], warnings, log: ['使用内置 8051 汇编器（零依赖通路）'],
          size: r.maxAddr - r.minAddr + 1, symbols: r.symbols
        };
      } catch (e) {
        return { ok: false, via: 'assembler', errors: [{ line: 0, msg: '汇编失败: ' + e.message }], warnings, log: [] };
      }
    }

    // ---------- 通路①：SDCC ----------
    /*
     * 已知不可用时直接给出准确原因。
     * 否则 spawn 失败会落到"编译进程启动失败"那句提示上，
     * 而那句话暗示"运行环境禁止派生子进程"，会把人带偏——实际只是没装 SDCC。
     */
    if (this.available === false && this.probeError && /ENOENT|not found|找不到/i.test(this.probeError)) {
      return {
        ok: false, via: 'none',
        errors: [{ line: 0, msg: '服务器上没有可用的 SDCC 编译器（' + this.sdccExe + '）。安装方式：Linux 执行 `apt install sdcc`；或使用仓库自带 Docker 镜像；临时替代方案是改用 "__ASM__" 开头的汇编写法（内置汇编器零依赖可用）。' }],
        warnings, log
      };
    }
    if (!this.supported) {
      return {
        ok: false, via: 'none',
        errors: [{ line: 0, msg: '未找到可用的 SDCC（尝试：' + this.sdccExe + '）。Linux 服务器可执行 `apt install sdcc` 或用仓库自带 Docker 镜像；也可改用 "__ASM__" 开头的汇编写法（内置汇编器零依赖可用）。' }],
        warnings, log
      };
    }

    // 需要 printf 且用户未自定义 putchar → 注入平台 stub
    let src = String(source);

    // Keil C51 语法兼容翻译（教材与网上代码绝大多数是 Keil 风格）
    const k = keilToSdcc(src);
    if (k.changes.length) {
      src = k.text;
      log.push('已自动把 Keil C51 写法转换为 SDCC 写法：' + k.changes.join('；'));
    }

    const needsPrintf = /#\s*include\s*<stdio\.h>/.test(src) || /\bprintf\s*\(/.test(src) || /\bputs\s*\(/.test(src);
    const hasOwnPutchar = /\b(putchar|_putchar)\s*\(/.test(src);
    let injected = '';
    if (needsPrintf && !hasOwnPutchar && opts.injectPrintf !== false) {
      injected = PLATFORM_PRINTF_STUB;
      /*
       * 必须插在用户最后一个 #include 之后！
       * 若插在文件最前面（早于 #include <stdio.h>），SDCC 不会把 putchar
       * 生成为 .globl 符号，链接 vprintf 时会报
       *   ?ASlink-Warning-Undefined Global _putchar referenced by module vprintf
       * 程序跳飞到非法地址、串口没有任何输出。
       */
      src = injectAfterIncludes(src, injected);
      log.push('已自动注入平台 putchar（printf 输出到串口 9600bps）');
    }

    const srcFile = path.join(dir, name + '.c');
    const ihx = path.join(dir, name + '.ihx');
    const hexRaw = path.join(dir, name + '.raw.hex');
    const hexFile = path.join(dir, name + '.hex');
    const lstFile = path.join(dir, name + '.lst');
    fs.writeFileSync(srcFile, src, 'utf8');

    const mcu = opts.mcu || 'mcs51';
    const args = [
      this.sdccExe,
      // 注意：SDCC 的端口选项是 "-m" + 端口名，8051 端口名为 mcs51，
      // 因此必须是 "-mmcs51"（两个 m）。写成 "-mcs51" 会被解析成 target='cs51'
      // 并报 error 131: cannot generate code for target 'cs51'。
      '-m' + mcu, '--model-small', '--stack-auto',
      '--iram-size', String(opts.iramSize || 128),
      '--code-size', String(opts.codeSize || 8192),
      '--std-c11', '--opt-code-speed',
      '-o', ihx
    ];
    for (const inc of opts.includes || []) args.push('-I', inc);
    // 平台头文件目录必须始终在包含路径中（提供 intrins.h 等）
    if (this.platformInc && fs.existsSync(this.platformInc)) args.push('-I', this.platformInc);
    for (const d of opts.defines || []) args.push('-D', d);
    args.push(srcFile);

    log.push('$ ' + args.slice(1).join(' '));
    let r;
    try {
      r = await this.run(args, dir, this.timeoutMs);
    } catch (e) {
      return {
        ok: false, via: 'sdcc', errors: [{ line: 0, msg: '编译进程启动失败：' + e.message + '（若运行环境禁止派生子进程，请改用内置汇编器通路或直接加载 .hex）' }],
        warnings, log
      };
    }
    log.push(r.stdout, r.stderr);

    // 解析 SDCC 诊断信息
    const parseDiag = (text, isErr) => {
      for (const line of String(text).split(/\r?\n/)) {
        const m = line.match(/^(.*?):(\d+):\s*(error|warning|fatal error|syntax error)\s*\d*:?\s*(.*)$/i);
        if (m) {
          const rec = { file: path.basename(m[1]), line: +m[2], msg: m[4] };
          (isErr || /error/i.test(m[3]) ? errors : warnings).push(rec);
        } else if (line.trim() && /error|warning/i.test(line) && !/^\s*$/.test(line)) {
          (isErr ? errors : warnings).push({ line: 0, msg: line.trim() });
        }
      }
    };
    parseDiag(r.stderr, true);
    parseDiag(r.stdout, false);

    if (!fs.existsSync(ihx)) {
      if (!errors.length) errors.push({ line: 0, msg: r.code === 0 ? '编译器未生成输出文件' : `编译失败（退出码 ${r.code}）` });
      return { ok: false, via: 'sdcc', errors, warnings, log };
    }

    // ---------- .ihx → .hex ----------
    try {
      const pk = this.packihxExe;
      const raw = fs.readFileSync(ihx, 'utf8');
      let hexText;
      if (fs.existsSync(pk)) {
        fs.writeFileSync(path.join(dir, name + '.ihx'), raw, 'utf8');
        const p2 = await this.run([pk, path.join(dir, name + '.ihx')], dir, 10000);
        hexText = p2.stdout;
        // packihx 把结果写到 stdout
        if (!hexText || hexText.trim()[0] !== ':') {
          // 少数版本写文件
          if (fs.existsSync(hexRaw)) hexText = fs.readFileSync(hexRaw, 'utf8');
        }
      }
      if (!hexText || hexText.trim()[0] !== ':') hexText = ihxToHex(raw);
      fs.writeFileSync(hexFile, hexText, 'utf8');

      // 提取 listing（供调试面板）
      let listing = null;
      if (fs.existsSync(lstFile)) listing = fs.readFileSync(lstFile, 'utf8').split('\n').slice(0, 400);

      // 统计代码尺寸
      let size = 0;
      for (const l of hexText.split('\n')) {
        const m = l.match(/^:([0-9A-Fa-f]{2})/);
        if (m) size += parseInt(m[1], 16);
      }
      const meta = this.analyze(hexText);
      return { ok: true, via: 'sdcc', hex: hexText, errors, warnings, log, listing, size, meta };
    } catch (e) {
      return { ok: false, via: 'sdcc', errors: [{ line: 0, msg: '生成 HEX 失败：' + e.message }], warnings, log };
    }
  }

  /** 静态分析：入口、是否含中断向量、使用的 SFR */
  analyze(hexText) {
    const code = new Uint8Array(65536);
    for (const raw of hexText.split(/\r?\n/)) {
      const l = raw.trim();
      if (!l || l[0] !== ':') continue;
      const b = [];
      for (let i = 1; i + 1 < l.length; i += 2) b.push(parseInt(l.substr(i, 2), 16));
      if (b[3] !== 0x00) continue;
      const addr = (b[1] << 8) | b[2];
      for (let i = 0; i < b[0]; i++) code[addr + i] = b[4 + i];
    }
    const vectors = [];
    const vnames = [[0x03, '外部中断0 INT0'], [0x0B, '定时器0'], [0x13, '外部中断1 INT1'], [0x1B, '定时器1'], [0x23, '串口']];
    for (const [a, nm] of vnames) {
      if (code[a] !== 0x00 || code[a + 1] !== 0x00 || code[a + 2] !== 0x00) vectors.push(nm);
    }
    const usedSfr = [];
    const sfrs = { 0x80: 'P0', 0x90: 'P1', 0xA0: 'P2', 0xB0: 'P3', 0x88: 'TCON', 0x89: 'TMOD', 0x98: 'SCON', 0x99: 'SBUF', 0xA8: 'IE', 0xB8: 'IP' };
    // 粗略扫描：MOV direct,#imm / MOV direct,A 形式
    for (let i = 0; i < 8192; i++) {
      const op = code[i];
      if (op === 0x75 || op === 0xF5 || op === 0x85) {
        const d = op === 0x85 ? code[i + 2] : code[i + 1];
        if (sfrs[d] && !usedSfr.includes(sfrs[d])) usedSfr.push(sfrs[d]);
      }
    }
    return { entry: (code[0] === 0x02) ? ((code[1] << 8) | code[2]) : 0, vectors, usedSfr };
  }
}

/** 兜底：把 Intel HEX(.ihx) 规范化（合并连续记录、重算校验和） */
export function ihxToHex(ihxText) {
  const map = new Map();
  let ext = 0;
  for (const raw of String(ihxText).split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l[0] !== ':') continue;
    const b = [];
    for (let i = 1; i + 1 < l.length; i += 2) b.push(parseInt(l.substr(i, 2), 16));
    const len = b[0], addr = (b[1] << 8) | b[2], type = b[3];
    if (type === 0x01) break;
    if (type === 0x02) { ext = (((b[4] << 8) | b[5]) << 4); continue; }
    if (type === 0x04) { ext = (((b[4] << 8) | b[5]) << 16); continue; }
    if (type !== 0x00) continue;
    for (let i = 0; i < len; i++) map.set((ext + addr + i) & 0xFFFF, b[4 + i]);
  }
  const addrs = [...map.keys()].sort((a, b) => a - b);
  const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
  const out = [];
  let i = 0;
  while (i < addrs.length) {
    const start = addrs[i];
    let data = [map.get(start)];
    let j = i + 1;
    while (j < addrs.length && addrs[j] === addrs[j - 1] + 1 && data.length < 32) { data.push(map.get(addrs[j])); j++; }
    const rec = [data.length, (start >> 8) & 0xFF, start & 0xFF, 0x00, ...data];
    const sum = (-rec.reduce((a, b) => (a + b) & 0xFF, 0)) & 0xFF;
    out.push(':' + rec.map(h2).join('') + h2(sum));
    i = j;
  }
  out.push(':00000001EMPTY'.replace('EMPTY', 'FF'));
  return out.join('\n');
}
