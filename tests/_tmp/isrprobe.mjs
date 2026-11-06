import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/buzzer_music.hex'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
let isr=0, lastPc=-1, reti=0;
for (let i=0;i<400000;i++){
  const pc0 = cpu.pc;
  const c = cpu.step();
  cpu.tick(c);
  if (cpu.pc === 0x000B && pc0 !== 0x000B) isr++;
  if (cpu.code[pc0] === 0x32) reti++;
}
console.log('ISR 进入次数', isr, 'RETI 次数', reti, '周期', cpu.cycles, 'P1=0x'+cpu.readPort(1).toString(16));
console.log('code[0x0B..0x20]=', Array.from(cpu.code.slice(0x0B,0x22)).map(v=>v.toString(16).padStart(2,'0')).join(' '));
// 找 reload 全局：dump 前 256 字节 code 中 toneReload 表特征（0x...）
// 反汇编 ISR
let a=0x0B; for(let k=0;k<8;k++){ const d=cpu.disasm(a); console.log('0x'+a.toString(16), d.text); a+=d.len; }
