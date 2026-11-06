import fs from 'node:fs';
const ROOT='C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { CPU8051 } = await import('file://'+ROOT+'/public/js/core/cpu8051.js');
const hex = fs.readFileSync(ROOT+'/public/hex/led_flow.hex','utf8');
const cpu = new CPU8051(); cpu.loadHex(hex);
const chg = [];
let last = 0xFF;
for (let i=0;i<2_000_000;i++){
  const c = cpu.step(); cpu.tick(c);
  const v = cpu.readPort(1);
  if (v !== last) { chg.push(`${cpu.cycles}:0x${v.toString(16)}`); last = v; }
}
console.log('P1 变化序列（前 14 个）:'); console.log(chg.slice(0,14).join('  '));
const t = chg.slice(0,10).map(s=>Number(s.split(':')[0]));
console.log('相邻间隔(机器周期):', t.slice(1).map((x,i)=>x-t[i]).join(', '));
