import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT, 'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { SFR } = await import('file://' + path.join(ROOT, 'public/js/core/sfr.js').replace(/\\/g,'/'));
const ihx = fs.readFileSync(path.join(ROOT, 'tests/fixtures/arith_logic.ihx'), 'utf8');
const cpu = new CPU8051();
const r = cpu.loadHex(ihx);
console.log('loadHex =', JSON.stringify(r));
console.log('code[0..15] =', Array.from(cpu.code.slice(0,16)).map(v=>v.toString(16).padStart(2,'0')).join(' '));
for (let i=0;i<14;i++){
  const pc0 = cpu.pc;
  const {text} = cpu.disasm(pc0);
  const c = cpu.stepOne();
  console.log(`#${i} PC=${pc0.toString(16).padStart(4,'0')} ${text.padEnd(14)} cyc=${c} -> PC=${cpu.pc.toString(16).padStart(4,'0')} A=${cpu.sfr[SFR.ACC].toString(16)} SP=${cpu.sfr[SFR.SP].toString(16)} R7=${cpu.getRn(7).toString(16)}`);
}
console.log('--- 3000 条后 ---');
const c2 = new CPU8051(); c2.loadHex(ihx);
for (let i=0;i<3000;i++) c2.stepOne();
console.log('PC=',c2.pc.toString(16),'cyc=',c2.cycles,'instr=',c2.instrCount,'undef=',c2.undefinedOpcode.map(v=>v.toString(16)));
