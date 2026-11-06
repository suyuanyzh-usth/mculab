/**
 * calibrate_delay.mjs — 标定软件延时循环的常数
 * 目标：delay_ms(1) ≈ 921.6 个机器周期（11.0592MHz / 12T）
 */
import { Compiler } from '../server/compile.js';
import { CPU8051 } from '../public/js/core/cpu8051.js';

const compiler = new Compiler();
const probe = await compiler.probe();
if (!probe.ok) { console.error('SDCC 不可用：', probe.error); process.exit(2); }

async function measure(inner) {
  const src = `
#include <stc89.h>
void delay_ms(unsigned int ms){
    volatile unsigned int i, j;
    for(i = 0; i < ms; i++)
        for(j = 0; j < ${inner}; j++);
}
void main(void){
    P1 = 0x00;
    delay_ms(100);
    P1 = 0xFF;
    while(1);
}
`;
  const r = await compiler.compile(src, { name: 'cal' + inner });
  if (!r.ok) throw new Error(r.errors?.[0]?.msg || 'compile failed');
  const cpu = new CPU8051();
  cpu.loadHex(r.hex);
  // 先等到 P1=0x00（延时开始），再等到 P1=0xFF（延时结束）
  let guard = 0, t0 = null;
  // 注意：step() 内部已经调用 tick() 推进外设与 cycles，
  //       外部再调 tick() 会把时间记账翻倍（这正是早期标定偏小一半的原因）。
  while (guard++ < 60_000_000) {
    cpu.step();
    const p1 = cpu.readPort(1);
    if (t0 === null && p1 === 0x00) t0 = cpu.cycles;
    else if (t0 !== null && p1 === 0xFF) break;
  }
  if (t0 === null) throw new Error('未捕捉到延时起点');
  return (cpu.cycles - t0) / 100;   // 每 1ms 的机器周期数
}

for (const inner of [26, 27, 28, 30, 32]) {
  const perMs = await measure(inner);
  console.log(`inner=${String(inner).padStart(3)}  →  delay_ms(1) ≈ ${perMs.toFixed(1)} 机器周期  (目标 921.6, 误差 ${((perMs/921.6-1)*100).toFixed(1)}%)`);
}
