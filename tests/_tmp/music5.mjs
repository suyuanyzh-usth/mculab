import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { CircuitSim } = await import('file://' + path.join(ROOT,'public/js/core/circuit.js').replace(/\\/g,'/'));
const { PRESETS } = await import('file://' + path.join(ROOT,'public/js/schematic/schematic.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/buzzer_music.hex'),'utf8');

function trial(withCircuit) {
  const cpu = new CPU8051();
  let isr = 0;
  const orig = cpu.serviceInterrupt.bind(cpu);
  cpu.serviceInterrupt = (c) => { isr++; return orig(c); };
  let sim = null;
  if (withCircuit) {
    const sch = PRESETS.buzzer();
    sim = new CircuitSim();
    sim.setCircuit(sch.parts, sch.wires); sim.cpu = cpu; sim.rebuild();
  }
  cpu.loadHex(hex);
  for (let i = 0; i < 40; i++) {
    if (sim) sim.run(20000); else cpu.runCycles(20000);
  }
  const ev = cpu.events.filter(e=>e.pin===0x08).length;
  console.log(`circuit=${withCircuit}: ISR=${isr} P1=0x${cpu.readPort(1).toString(16)} latch=0x${cpu.portLatch[1].toString(16)} P1.0事件=${ev} 总事件=${cpu.events.length} instr=${cpu.instrCount}`);
}
trial(false);
trial(false);
trial(true);
