import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname,'..','..');
const { CPU8051 } = await import('file://'+path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { SFR } = await import('file://'+path.join(ROOT,'public/js/core/sfr.js').replace(/\\/g,'/'));
const ihx = fs.readFileSync(path.join(ROOT,'tests/fixtures/int_bit.ihx'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(ihx);
const h2=v=>v.toString(16).padStart(2,'0');
console.log('code[0xEC..0x10F] =');
for(let a=0xEC;a<0x110;a+=16) console.log('  0x'+a.toString(16)+': '+Array.from(cpu.code.slice(a,a+16)).map(h2).join(' '));
for(let i=1;i<=830;i++){
  const pc0=cpu.pc; const op=cpu.code[pc0];
  cpu.stepOne();
  if(i>=805) console.log(`step${i} pc0=0x${pc0.toString(16)} op=0x${h2(op)} cyc→ pc=0x${cpu.pc.toString(16)} PSW=0x${h2(cpu.sfr[SFR.PSW])} ACC=0x${h2(cpu.sfr[SFR.ACC])} B=0x${h2(cpu.sfr[SFR.B])} SP=0x${h2(cpu.sfr[SFR.SP])} R4=0x${h2(cpu.getRn(4))} R5=0x${h2(cpu.getRn(5))} R6=0x${h2(cpu.getRn(6))}`);
}
