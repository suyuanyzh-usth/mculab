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
const st = sim.devices.get(bz.id);
for (let i=0;i<8;i++){
  sim.run(150000); sim.refresh();
  console.log(`cyc=${cpu.cycles} TMOD=0x${cpu.sfr[0x89].toString(16)} TCON=0x${cpu.sfr[0x88].toString(16)} IE=0x${cpu.sfr[0xA8].toString(16)} TH0=0x${cpu.sfr[0x8C].toString(16)} TL0=0x${cpu.sfr[0x8A].toString(16)} P1=0x${cpu.readPort(1).toString(16)} toggles=${st.toggleTimes.length} freq=${st.freq} on=${st.on}`);
}
console.log('P1.0 事件数:', cpu.events.filter(e=>e.pin===0x08).length);
console.log('全部事件数:', cpu.events.length);
