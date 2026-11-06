import fs from 'node:fs';
const ROOT='C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab';
const { CPU8051 } = await import('file://'+ROOT+'/public/js/core/cpu8051.js');
const hex = fs.readFileSync(ROOT+'/public/hex/led_flow.hex','utf8');
const a = new CPU8051(); a.loadHex(hex);
const used = a.runCycles(500000);
console.log('runCycles(500000): 返回', used, '累计 cycles', a.cycles, '指令', a.instrCount);
const b = new CPU8051(); b.loadHex(hex);
let sum = 0; for (let i=0;i<200000;i++){ const c=b.step(); b.tick(c); sum+=c; }
console.log('手工 step+tick 20 万条: 累计 cycles', b.cycles);
