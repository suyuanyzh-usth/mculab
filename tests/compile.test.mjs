/**
 * compile.test.mjs — 编译服务测试
 * ==================================================================
 * 覆盖：
 *   A. 基本 C 编译 → 合法 Intel HEX
 *   B. <intrins.h> 平台垫片（SDCC 不自带，教材代码却普遍使用）
 *   C. Keil C51 语法自动翻译（sbit / code / interrupt / bit / xdata）
 *   D. printf 自动重定向到串口（注入 putchar）
 *   E. 编译错误能带行号返回
 *   F. 零依赖降级通路（__ASM__ 内置汇编器）
 *   G. 生成的 HEX 能被本平台内核执行
 */
import { Compiler } from '../server/compile.js';
import { CPU8051 } from '../public/js/core/cpu8051.js';

let pass = 0, fail = 0;
const rows = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; rows.push(`  [PASS] ${name}`); }
  else { fail++; rows.push(`  [FAIL] ${name}${extra ? '  → ' + extra : ''}`); }
};

const c = new Compiler();
const probe = await c.probe();
if (!probe.ok) {
  console.log('\n编译服务测试跳过：SDCC 不可用（' + probe.error + '）\n');
  process.exit(0);
}
rows.push(`  SDCC: ${(probe.version || '').slice(0, 60)}`);
rows.push('');

/* ---------------------------------------------------------- A. 基本编译 */
{
  const code = `#include <8051.h>
void main(void){ P1 = 0xFE; while(1); }`;
  const r = await c.compile(code, { name: 'basic' });
  ok('A1 基本 C 编译成功', r.ok, r.errors?.[0]?.msg);
  ok('A2 返回 Intel HEX（以冒号开头、含 EOF 记录）',
    !!r.hex && r.hex.trimStart().startsWith(':') && r.hex.trimEnd().endsWith(':00000001FF'));
  ok('A3 代码尺寸合理（< 8KB）', r.size > 0 && r.size < 8192, `size=${r.size}`);

  const cpu = new CPU8051();
  const lr = cpu.loadHex(r.hex);
  ok('A4 HEX 可被平台内核装载（无校验和错误）', lr.loaded > 0 && lr.checksumErrors === 0,
    `loaded=${lr.loaded} err=${lr.checksumErrors}`);
  for (let i = 0; i < 4000; i++) cpu.stepOne();
  ok('A5 内核能执行机器码（无未定义操作码）', (cpu.undefinedOpcode || []).length === 0,
    (cpu.undefinedOpcode || []).map(v => '0x' + v.toString(16)).join(','));
  ok('A6 执行后 P1 = 0xFE', cpu.readPort(1) === 0xFE, '0x' + cpu.readPort(1).toString(16));
}

/* ---------------------------------------------------------- B. intrins.h */
{
  const code = `#include <stc89.h>
#include <intrins.h>
void main(void){
  unsigned char a = 0x81;
  P1 = _crol_(a, 1);     /* 期望 0x03 */
  P2 = _cror_(a, 1);     /* 期望 0xC0 */
  while(1);
}`;
  const r = await c.compile(code, { name: 'intrins' });
  ok('B1 <intrins.h> 可用（平台垫片）', r.ok, r.errors?.[0]?.msg);
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    for (let i = 0; i < 500; i++) cpu.stepOne();
    ok('B2 _crol_(0x81,1) = 0x03', cpu.readPort(1) === 0x03, '0x' + cpu.readPort(1).toString(16));
    ok('B3 _cror_(0x81,1) = 0xC0', cpu.readPort(2) === 0xC0, '0x' + cpu.readPort(2).toString(16));
  }
}

/* ---------------------------------------------------------- C. Keil 语法 */
{
  const code = `#include <reg52.h>
sbit LED = P1^3;
sbit KEY = P3^2;
unsigned char code tab[4] = {0x3F, 0x06, 0x5B, 0x4F};
bit flag = 0;
void isr(void) interrupt 0 { flag = 1; }
void main(void){
  unsigned char i = 0;
  LED = 0;
  while(1){ P0 = tab[i & 3]; i++; }
}`;
  const r = await c.compile(code, { name: 'keil' });
  ok('C1 Keil 语法（sbit/code/interrupt/bit/reg52.h）可编译', r.ok, r.errors?.[0]?.msg);
  ok('C2 日志中记录了自动翻译',
    (r.log || []).some(l => /Keil|sbit|__code/.test(l)),
    (r.log || []).join(' | ').slice(0, 120));
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    for (let i = 0; i < 3000; i++) cpu.stepOne();
    ok('C3 sbit LED=P1^3 生效（P1.3 被拉低）', (cpu.readPort(1) & 0x08) === 0,
      '0x' + cpu.readPort(1).toString(16));
    ok('C4 code 表被正确读取（P0 输出段码）', [0x3F, 0x06, 0x5B, 0x4F, 0x3F].includes(cpu.readPort(0)),
      '0x' + cpu.readPort(0).toString(16));
  }
}

/* ---------------------------------------------------------- D. printf */
{
  const code = `#include <stc89.h>
#include <stdio.h>
void main(void){
  printf("OK %d\\n", 42);
  while(1);
}`;
  const r = await c.compile(code, { name: 'printf' });
  ok('D1 使用 printf 的代码可编译（自动注入 putchar）', r.ok, r.errors?.[0]?.msg);
  ok('D2 日志提示已注入平台 putchar', (r.log || []).some(l => /putchar/.test(l)));
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    cpu.drainTx();
    for (let i = 0; i < 60000; i++) cpu.stepOne();
    const tx = cpu.drainTx();
    const s = tx.map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    ok('D3 printf 输出经 UART 发出且内容正确', s.includes('OK 42'), `TX="${s}"`);
  }
}

/* ---------------------------------------------------------- E. 错误信息 */
{
  const code = `#include <8051.h>
void main(void){
  P1 = 0xFE
  while(1);
}`;
  const r = await c.compile(code, { name: 'badsyntax' });
  ok('E1 语法错误被识别', r.ok === false);
  ok('E2 返回带行号的错误（指向缺失分号附近）', (r.errors || []).some(e => e.line >= 3 && e.line <= 4), JSON.stringify(r.errors).slice(0, 160));
}

/* ---------------------------------------------------------- F. 汇编降级通路 */
{
  const code = `__ASM__
        ORG 0x0000
        LJMP start
        ORG 0x0030
start:  MOV P1, #0x55
loop:   SJMP loop
`;
  const r = await c.compile(code, { name: 'ananas' });
  ok('F1 __ASM__ 走内置汇编器（不依赖 SDCC）', r.ok && r.via === 'assembler', `via=${r.via} ${r.errors?.[0]?.msg || ''}`);
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    for (let i = 0; i < 20; i++) cpu.stepOne();
    ok('F2 汇编产物可执行且 P1=0x55', cpu.readPort(1) === 0x55, '0x' + cpu.readPort(1).toString(16));
  }
}

/* ---------------------------------------------------------- G. 大程序 / 库 */
{
  const code = `#include <stc89.h>
#include <string.h>
#include <stdio.h>
int putchar(int c){ while(!(SCON & 0x02)); SBUF=(unsigned char)c; SCON&=~0x02; return c; }
void main(void){
  char buf[16];
  strcpy(buf, "MCU");
  strcat(buf, "-LAB");
  printf("%s %u\\n", buf, strlen(buf));
  while(1);
}`;
  const r = await c.compile(code, { name: 'lib' });
  ok('G1 string.h / stdio.h 库函数可链接', r.ok, r.errors?.[0]?.msg);
  ok('G2 代码仍在 8KB Flash 内', r.size > 0 && r.size <= 8192, `size=${r.size}`);
}

console.log('\n===== 编译服务测试 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
