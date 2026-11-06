import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname,'..','..');
const { CPU8051 } = await import('file://'+path.join(ROOT,'public/js/core/cpu8051.js').replace(/\\/g,'/'));
const { SFR } = await import('file://'+path.join(ROOT,'public/js/core/sfr.js').replace(/\\/g,'/'));
const ihx = fs.readFileSync(path.join(ROOT,'tests/fixtures/timer0_irq.ihx'),'utf8');
const cpu = new CPU8051(); cpu.loadHex(ihx);
const h2=v=>v.toString(16).padStart(2,'0');
let lastTF=0, irqCount=0, last2s=-1, last2i=-1, last2t=-1;
const origService = cpu.serviceInterrupt.bind(cpu);
cpu.serviceInterrupt = (c)=>{ irqCount++; if(irqCount<=6||irqCount>40) console.log(`  >>> IRQ#${irqCount} ${c.v.name} @cycle=${cpu.cycles} pc=0x${cpu.pc.toString(16)} stackSP=0x${h2(cpu.sp)}`); return origService(c); };
for(let i=1;i<=1900;i++){
  const pc0=cpu.pc;
  const cyc=cpu.stepOne();
  const tf = (cpu.sfr[SFR.TCON]&0x20)?1:0;
  if(i===45||i===50||i===60||i===80||(tf&&!lastTF)||cpu.sfr[SFR.TMOD]!==last2s||cpu.sfr[SFR.IE]!==last2i||(cpu.sfr[SFR.TCON]&0x10)!==last2t) console.log(`step${i} pc=0x${pc0.toString(16)} op=0x${h2(cpu.code[pc0])} cyc=${cyc} TCON=0x${h2(cpu.sfr[SFR.TCON])} IE=0x${h2(cpu.sfr[SFR.IE])} TMOD=0x${h2(cpu.sfr[SFR.TMOD])} TH0=0x${h2(cpu.sfr[SFR.TH0])} TL0=0x${h2(cpu.sfr[SFR.TL0])} IP=0x${h2(cpu.sfr[SFR.IP])} intLvl=${cpu.intLevelActive} irqs=${irqCount}`);
  lastTF=tf; last2s=cpu.sfr[SFR.TMOD]; last2i=cpu.sfr[SFR.IE]; last2t=cpu.sfr[SFR.TCON]&0x10;
}
console.log('总中断次数 =', irqCount, ' cycles=', cpu.cycles, ' iram[? ticks]=?');
