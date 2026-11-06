import { CPU8051 } from '../../public/js/core/cpu8051.js';
import { SFR } from '../../public/js/core/sfr.js';
import { assemble } from '../../public/js/core/asm8051.js';

// 80C51: set Timer0 mode1, TH0/TL0, TR0=1, EA=1, ET0=1; ISR at 0x000B increments R7
const src = `
  ORG 0x0000
  LJMP main
  ORG 0x000B
  INC R7
  MOV TH0, #0xF0
  MOV TL0, #0x00
  RETI
  ORG 0x0030
main:
  MOV TMOD, #0x01
  MOV TH0, #0xF0
  MOV TL0, #0x00
  SETB TR0
  SETB EA
  SETB ET0
loop:
  SJMP loop
`;
const out = assemble(src);
console.log('assemble:', out.ok ? 'ok' : out.errors, 'bytes', out.bytes ? out.bytes.length : 0);
const cpu = new CPU8051();
const r = cpu.loadHex(out.hex);
console.log('loaded', r.loaded);
for (let i=0;i<10;i++){
  cpu.runCycles(5000);
  console.log(`cyc=${cpu.cycles} TCON=0x${cpu.sfr[SFR.TCON].toString(16)} TH0=0x${cpu.sfr[SFR.TH0].toString(16)} TL0=0x${cpu.sfr[SFR.TL0].toString(16)} R7=${cpu.getRn(7)} PC=0x${cpu.pc.toString(16)} IE=0x${cpu.sfr[SFR.IE].toString(16)}`);
}
