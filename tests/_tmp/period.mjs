import fs from 'node:fs';
const ROOT='C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { CPU8051 } = await import('file://'+ROOT+'/public/js/core/cpu8051.js');
const hex = fs.readFileSync(ROOT+'/public/hex/led_flow.hex','utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
const rises = [];
let prev = 1;
for (let i=0;i<900000;i++){
  const c = cpu.step(); cpu.tick(c);
  const v = cpu.readPin(0x08);
  if (prev === 0 && v === 1) rises.push(cpu.cycles);
  prev = v;
}
console.log('P1.0 上升沿周期(机器周期):', rises.slice(1).map((t,i)=>t-rises[i]).join(', '));
const p = rises.length>1 ? (rises[rises.length-1]-rises[0])/(rises.length-1) : 0;
console.log('平均周期', p.toFixed(0), '周期 =', (p/921600*1000).toFixed(0), 'ms →', (921600/p).toFixed(3), 'Hz');
