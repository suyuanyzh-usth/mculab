import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const { CPU8051 } = await import('file://' + path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { CircuitSim, DEVICE_DEFS } = await import('file://' + path.join(ROOT,'public/js/core/circuit.js').replace(/\\/g,'/'));
const { PRESETS } = await import('file://' + path.join(ROOT,'public/js/schematic/schematic.js').replace(/\\/g,'/'));
const hex = fs.readFileSync(path.join(ROOT,'public/hex/led_flow.hex'),'utf8');
const sch = PRESETS.led_min();
const cpu = new CPU8051(); const sim = new CircuitSim();
sim.setCircuit(sch.parts, sch.wires); sim.cpu = cpu; sim.rebuild();
cpu.loadHex(hex);
const leds = sch.parts.filter(p=>p.type==='led');
console.log('LED ids order:', leds.map((l,i)=>`${i}:${l.id}`).join(' '));
// 打印每个 LED 的 A/K 网络与电平
for (let i=0;i<leds.length;i++){
  const l = leds[i];
  const a = sim.pinLevel(l,0), k = sim.pinLevel(l,1);
  const na = sim.netlist.netOf(sim.netlist.pinNet,l.id,0);
  const nk = sim.netlist.netOf(sim.netlist.pinNet,l.id,1);
  console.log(`led[${i}] A=${a} K=${k} netA=${na} netK=${nk}`);
}
// 找出 P1.0..P1.7 各自的网络
const mcu = sch.parts.find(p=>p.def.isMcu);
for (let i=0;i<8;i++){
  const pi = mcu.def.pins.findIndex(x=>x.name==='P1.'+i);
  const net = sim.netlist.netOf(sim.netlist.pinNet, mcu.id, pi);
  console.log(`P1.${i} pinIdx=${pi} net=${net} level=${sim.netLevel(net)} latchBit=${(cpu.readPort(1)>>i)&1}`);
}
console.log('P1 latch=', '0x'+cpu.readPort(1).toString(16));
