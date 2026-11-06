import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/buzzer_music.hex'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
console.log('ISR 0x123 字节:', Array.from(cpu.code.slice(0x123,0x140)).map(v=>v.toString(16).padStart(2,'0')).join(' '));
let a=0x123; for(let k=0;k<12;k++){ const d=cpu.disasm(a); console.log('0x'+a.toString(16), d.text, '| bytes', Array.from(cpu.code.slice(a,a+d.len)).map(v=>v.toString(16)).join(' ')); a+=d.len; }
let guard=0; while(cpu.pc!==0x123 && guard++<900000){ const c=cpu.step(); cpu.tick(c); }
console.log('到达 ISR, P1=0x'+cpu.readPort(1).toString(16));
for (let k=0;k<12;k++){
  const pc0=cpu.pc; const op=cpu.code[pc0]; const c=cpu.step(); cpu.tick(c);
  console.log(`0x${pc0.toString(16)} op=0x${op.toString(16)} -> P1=0x${cpu.readPort(1).toString(16)} latch1=0x${cpu.portLatch[1].toString(16)} bit0x90=${cpu.getBit(0x90)}`);
}
