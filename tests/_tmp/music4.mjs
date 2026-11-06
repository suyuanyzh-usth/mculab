import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { CircuitSim } = await import('file://' + path.join(ROOT,'public/js/core/circuit.js').replace(/\\/g,'/'));
const { PRESETS } = await import('file://' + path.join(ROOT,'public/js/schematic/schematic.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/buzzer_music.hex'),'utf8');
const sch = PRESETS.buzzer();
const cpu = new CPU8051(); const sim = new CircuitSim();
sim.setCircuit(sch.parts, sch.wires); sim.cpu = cpu; sim.rebuild();
cpu.loadHex(hex);
const bz = sch.parts.find(p=>p.type==='buzzer');
for (let i=0;i<12;i++){
  sim.run(20000);
  console.log(`cyc=${cpu.cycles} latch=0x${cpu.portLatch[1].toString(16)} ext=0x${cpu.portExt[1].toString(16)} pin=0x${cpu.pinValue(1).toString(16)} events=${cpu.events.length} bz.on=${sim.devices.get(bz.id).on} bzTok=${sim.devices.get(bz.id).toggleTimes.length}`);
}
