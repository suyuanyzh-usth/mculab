import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname,'..','..');
const { CPU8051 } = await import('file://'+path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { SFR } = await import('file://'+path.join(ROOT,'public/js/core/sfr.js').replace(/\\/g,'/'));
const { assemble } = await import('file://'+path.join(ROOT,'public/js/core/asm8051.js').replace(/\\/g,'/'));
const prog = `
        ORG 0000H
        LJMP  START
        ORG 0030H
START:  MOV  SP, #60H
        MOV  A, #0
        MOV  R7, #10
SUM:    ADD  A, R7
        DJNZ R7, SUM
        MOV  30H, A
        MOV  DPTR, #TAB
        MOV  A, #2
        MOVC A, @A+DPTR
        MOV  31H, A
        SJMP $
TAB:    DB   11H, 22H, 33H, 44H
        END
`;
const r = assemble(prog);
console.log('ok=',r.ok, r.errors.map(e=>e.line+':'+e.msg).join('; '));
console.log('符号:', JSON.stringify(r.symbols));
for (const l of r.listing) console.log(`  ${l.addr.toString(16).padStart(4,'0')}: ${l.bytes.map(b=>b.toString(16).padStart(2,'0')).join(' ').padEnd(12)} ${l.src}`);
const cpu = new CPU8051(); cpu.loadHex(r.hex);
for (let i=0;i<40;i++){
  const pc0=cpu.pc, op=cpu.code[pc0];
  cpu.stepOne();
  if (i>18||i<4) console.log(`#${i} @${pc0.toString(16)} op=${op.toString(16)} A=${cpu.sfr[SFR.ACC].toString(16)} DPTR=${(((cpu.sfr[SFR.DPH]<<8)|cpu.sfr[SFR.DPL])).toString(16)} -> pc=${cpu.pc.toString(16)}`);
}
console.log('iram[30]=',cpu.iram[0x30].toString(16),' iram[31]=',cpu.iram[0x31].toString(16));
