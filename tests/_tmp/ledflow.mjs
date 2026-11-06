import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { CircuitSim } = await import('file://' + path.join(ROOT,'public/js/core/circuit.js').replace(/\\/g,'/'));
const { PRESETS } = await import('file://' + path.join(ROOT,'public/js/schematic/schematic.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/led_flow.hex'),'utf8');
const sch = PRESETS.led_min();
const cpu = new CPU8051(); const sim = new CircuitSim();
sim.setCircuit(sch.parts, sch.wires); sim.cpu = cpu; sim.rebuild();
cpu.loadHex(hex);
const seen = new Map();
for (let i=0;i<1000;i++){
  sim.run(6000);
  const v = cpu.readPort(1);
  seen.set(v, (seen.get(v)||0)+1);
}
console.log('P1 分布:', [...seen.entries()].map(([k,n])=>`0x${k.toString(16)}×${n}`).join(' '));
console.log('总周期', cpu.cycles, 'instr', cpu.instrCount, 'PC', cpu.pc.toString(16));
// 也看 latch 与 pin 是否不同
console.log('latch1=0x'+cpu.portLatch[1].toString(16), 'ext1=0x'+cpu.portExt[1].toString(16), 'pin1=0x'+cpu.pinValue(1).toString(16));
