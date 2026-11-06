import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname,'..','..');
const m = await import('file://'+path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { CPU8051 } = m;
const ihx = fs.readFileSync(path.join(ROOT,'tests/fixtures/arith_logic.ihx'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(ihx);
console.log('CYCLE[0x02]=',m.CYCLE[0x02],'CYCLE[0x00]=',m.CYCLE[0x00]);
for(let i=0;i<8;i++){
  const pc0=cpu.pc, op=cpu.code[pc0];
  const cyc=cpu.stepOne();
  console.log(`#${i} pc0=0x${pc0.toString(16)} op=0x${op.toString(16)} cyc=${cyc} -> pc=0x${cpu.pc.toString(16)} instr=${cpu.instrCount}`);
}
