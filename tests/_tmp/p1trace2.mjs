import fs from 'node:fs';
const ROOT='C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { CPU8051 } = await import('file://'+ROOT+'/public/js/core/cpu8051.js');
const hex = fs.readFileSync(ROOT+'/public/hex/led_flow.hex','utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
const chg=[]; let last=0xFF;
for (let i=0;i<2_000_000;i++){ cpu.step(); const v=cpu.readPort(1); if(v!==last){chg.push(cpu.cycles); last=v;} }
const t=chg.slice(0,9);
console.log('每步机器周期:', t.slice(1).map((x,i)=>x-t[i]).join(', '));
console.log('每步毫秒:', ((t[1]-t[0])/921.6).toFixed(1));
