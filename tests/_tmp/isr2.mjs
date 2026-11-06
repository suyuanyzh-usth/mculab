import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/buzzer_music.hex'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
console.log('0x23 起字节:', Array.from(cpu.code.slice(0x23,0x45)).map(v=>v.toString(16).padStart(2,'0')).join(' '));
let a=0x23; for(let k=0;k<14;k++){ const d=cpu.disasm(a); console.log('0x'+a.toString(16).padStart(2,'0'), ' '.repeat(0), d.text); a+=d.len; }
// 单步跟踪一次 ISR，打印每条指令后 P1 与 BEEP 位
console.log('--- 单步到第一次 ISR ---');
let guard=0; while(cpu.pc!==0x23 && guard++<300000){ const c=cpu.step(); cpu.tick(c); }
for (let k=0;k<10;k++){
  const pc0=cpu.pc; const op=cpu.code[pc0]; const c=cpu.step(); cpu.tick(c);
  console.log(`0x${pc0.toString(16)} op=0x${op.toString(16)} -> P1=0x${cpu.readPort(1).toString(16)} latch1=0x${cpu.portLatch[1].toString(16)} bit0x90=${cpu.getBit(0x90)} SP=0x${cpu.sfr[0x81].toString(16)}`);
}
