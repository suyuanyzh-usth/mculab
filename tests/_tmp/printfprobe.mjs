import { Compiler } from '../../server/compile.js';
import { CPU8051 } from '../../public/js/core/cpu8051.js';
const c = new Compiler(); await c.probe();
const code = `#include <stc89.h>
#include <stdio.h>
void main(void){ printf("OK %d\\n", 42); while(1); }`;
const r = await c.compile(code, { name: 'pf' });
console.log('compile ok', r.ok, 'size', r.size, r.errors?.[0]?.msg || '');
const cpu = new CPU8051(); cpu.loadHex(r.hex); cpu.drainTx();
for (const n of [20000, 100000, 400000]) {
  cpu.runCycles(n);
  console.log(`cyc=${cpu.cycles} pc=0x${cpu.pc.toString(16)} SCON=0x${cpu.sfr[0x98].toString(16)} TI=${(cpu.sfr[0x98]>>1)&1} txBytes=${cpu.txBytes.length} instr=${cpu.instrCount}`);
}
console.log('TX:', cpu.drainTx().map(b=>b>=32&&b<127?String.fromCharCode(b):'.').join(''), '| SBUF=0x'+cpu.sfr[0x99].toString(16));
