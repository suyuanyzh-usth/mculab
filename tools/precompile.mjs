/**
 * precompile.mjs — 用平台的编译服务预编译全部内置实验
 * ------------------------------------------------------------------
 * 产物：public/hex/<id>.hex       学生即使没有 SDCC 也能直接加载仿真
 *       public/hex/<id>.build.log 编译日志
 *       public/hex/<id>.rst       符号表（可选，供反汇编显示）
 *
 * 为什么用 Node 而不是 bash 直接调 SDCC：
 *   平台的编译服务还包含 Keil→SDCC 语法翻译、intrins.h 注入、printf stub 等，
 *   必须走同一条链路，否则"预编译产物"与"学生实际编译结果"可能不一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Compiler } from '../server/compile.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'data', 'experiments');
const OUT = path.join(ROOT, 'public', 'hex');

fs.mkdirSync(OUT, { recursive: true });
const compiler = new Compiler();
const probe = await compiler.probe();
console.log('SDCC:', probe.ok ? (probe.version || 'OK') : ('不可用 — ' + probe.error));
if (!probe.ok) process.exit(2);

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.c')).sort();
let ok = 0, bad = 0;
const rows = [];

for (const f of files) {
  const id = f.replace(/\.c$/, '');
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  const t0 = Date.now();
  const r = await compiler.compile(code, { name: id });
  const ms = Date.now() - t0;
  const logTxt = (r.log || []).join('\n');
  fs.writeFileSync(path.join(OUT, id + '.build.log'), logTxt, 'utf8');

  if (r.ok) {
    fs.writeFileSync(path.join(OUT, id + '.hex'), r.hex, 'utf8');
    ok++;
    rows.push(`  ✓ ${id.padEnd(16)} ${String(r.size).padStart(5)} B   ${ms} ms`);
  } else {
    bad++;
    rows.push(`  ✗ ${id.padEnd(16)} 失败: ${(r.errors?.[0]?.msg || '未知').slice(0, 110)}`);
    try { fs.unlinkSync(path.join(OUT, id + '.hex')); } catch { }
  }
}
console.log('\n' + rows.join('\n'));
console.log(`\n结果：${ok} 成功 / ${bad} 失败  →  ${OUT}`);
process.exit(bad ? 1 : 0);
