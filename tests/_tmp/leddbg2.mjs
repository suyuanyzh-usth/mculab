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
const leds = sch.parts.filter(p=>p.type==='led');
const seen = new Set();
for (let step=0; step<6; step++){
  sim.run(200000);
  sim.refresh();
  const p1 = cpu.readPort(1);
  const st = leds.map(l=>sim.devices.get(l.id).on).join('');
  seen.add(p1);
  console.log(`after ${(step+1)*200000} cyc: P1=0x${p1.toString(16).toUpperCase().padStart(2,'0')} leds=${st}  Klevels=${leds.map(l=>sim.pinLevel(l,1)).join('')}`);
}
console.log('distinct P1:', [...seen].map(v=>'0x'+v.toString(16)).join(' '));

// 关键验证：run 之后是否只需 refresh 一次即可自洽
const cpu2 = new CPU8051(); const sim2 = new CircuitSim();
sim2.setCircuit(sch.parts, sch.wires); sim2.cpu = cpu2; sim2.rebuild();
cpu2.loadHex(hex);
sim2.run(2500000);
console.log("\n--- before final refresh ---");
console.log("P1=0x"+cpu2.readPort(1).toString(16), "leds="+leds.map(l=>sim2.devices.get(l.id).on).join(''));
sim2.refresh();
console.log("--- after final refresh ---");
console.log("P1=0x"+cpu2.readPort(1).toString(16), "leds="+leds.map(l=>sim2.devices.get(l.id).on).join(''));
