/* Timer0 模式1 + 中断，验证定时器/中断/压栈行为 */
#include <8051.h>
volatile unsigned char ticks=0;
void t0isr(void) __interrupt(1) { TH0=0xFC; TL0=0x18; ticks++; }
void main(void){
  unsigned char k=0;
  TMOD = 0x01; TH0=0xFC; TL0=0x18;
  EA=1; ET0=1; TR0=1;
  while(1){ k = ticks; }
}
