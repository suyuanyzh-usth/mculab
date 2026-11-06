import fs from 'node:fs';
const ROOT='C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { CPU8051 } = await import('file://'+ROOT+'/public/js/core/cpu8051.js');
const cpu = new CPU8051();
cpu.loadHex(fs.readFileSync(ROOT+'/public/hex/buzzer_music.hex','utf8'));
console.log('0x0000:', JSON.stringify(cpu.disasm(0x0000)));
console.log('0x000B:', JSON.stringify(cpu.disasm(0x000B)));
let a=0x123; const lines=[];
for(let k=0;k<10;k++){const d=cpu.disasm(a);lines.push(`0x${a.toString(16)}  ${d.text}`);a+=d.len;}
console.log('ISR:'); console.log(lines.join('\n'));
