import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT, 'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const name = process.argv[2] || 'int_bit';
const K = Number(process.argv[3] || 200);
const ihx = fs.readFileSync(path.join(ROOT, 'tests/fixtures', name + '.ihx'), 'utf8');
const refTxt = fs.readFileSync(path.join(ROOT, 'tests/fixtures', name + '.trace.pc'), 'utf8');
const ref = refTxt.trim().split(/\s+/).map(Number);
const cpu = new CPU8051();
cpu.loadHex(ihx);
const mine = [];
for (let i = 0; i < K; i++) { cpu.stepOne(); mine.push(cpu.pc); }
let firstDiv = -1;
for (let i = 0; i < Math.min(ref.length, mine.length); i++) {
  if (ref[i] !== mine[i]) { firstDiv = i; break; }
}
console.log(`case=${name} K=${K} oracleSteps=${ref.length}`);
if (firstDiv < 0) { console.log('PC 轨迹完全一致 ✔'); }
else {
  console.log(`首次分歧发生在第 ${firstDiv + 1} 条指令之后`);
  for (let i = Math.max(0, firstDiv - 4); i <= Math.min(ref.length - 1, firstDiv + 3); i++) {
    // 反汇编"分歧前 PC"
    const mark = i === firstDiv ? '  <<< 分歧' : '';
    console.log(`  step ${String(i + 1).padStart(4)}  oracle_PC=0x${(ref[i]||0).toString(16)}  mine_PC=0x${(mine[i]||0).toString(16)}${mark}`);
  }
  // 打印分歧点附近我方执行的指令
  const c2 = new CPU8051(); c2.loadHex(ihx);
  for (let i = 0; i < firstDiv; i++) c2.stepOne();
  console.log('  我方在第 ' + (firstDiv + 1) + ' 步执行的指令序列:');
  for (let j = 0; j < 5; j++) {
    const pc0 = c2.pc; const { text } = c2.disasm(pc0);
    const cyc = c2.stepOne();
    console.log(`    @0x${pc0.toString(16).padStart(4,'0')}  ${text}   (cyc=${cyc})`);
  }
}
