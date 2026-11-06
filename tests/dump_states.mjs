/**
 * dump_states.mjs <caseName> <N>
 * 用本平台内核执行 0..N 条指令，逐条输出状态到
 *     tests/fixtures/<caseName>.mine.states.txt
 * 每行： pc psw acc b sp dptr r0..r7   （十六进制，无前缀，小写）
 * 第 1 行 = 复位后（0 条指令），第 i+1 行 = 执行 i 条指令后
 * 供 tools/find_divergence.sh 与 ucsim 的 oracle_probe.sh 逐点比对
 */
import fs from 'node:fs';
import path from 'node:path';
import { CPU8051 } from '../public/js/core/cpu8051.js';
import { SFR } from '../public/js/core/sfr.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const name = process.argv[2] || 'int_bit';
const N = Number(process.argv[3] || 3000);
const ihx = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name + '.ihx'), 'utf8');
const cpu = new CPU8051();
const ld = cpu.loadHex(ihx);
if (ld.checksumErrors) throw new Error('HEX 校验和错误');

// 统一为"小写、去前导零"的十六进制，以便与 tools/oracle_probe.sh 的输出做字符串比较
const h = (v) => (v & 0xFF).toString(16).toLowerCase();
const hx = (v) => v.toString(16).toLowerCase();
const line = () => [
  hx(cpu.pc), h(cpu.sfr[SFR.PSW]), h(cpu.sfr[SFR.ACC]), h(cpu.sfr[SFR.B]),
  h(cpu.sfr[SFR.SP]), hx((cpu.sfr[SFR.DPH] << 8) | cpu.sfr[SFR.DPL]),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => h(cpu.getRn(i)))
].join(' ');

const out = [line()];
for (let i = 0; i < N; i++) { cpu.stepOne(); out.push(line()); }
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures', name + '.mine.states.txt'), out.join('\n') + '\n');
console.log(`${name}: 已写出 ${out.length} 行状态 (0..${N})`);
