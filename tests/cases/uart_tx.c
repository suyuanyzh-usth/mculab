/* UART 模式1 发送（Timer1 方式2 波特率），验证串口发送时序与 TI 标志 */
#include <8051.h>
volatile unsigned char n=0;
void main(void){
  unsigned char i=0;
  TMOD = 0x20; TH1=0xFD; TL1=0xFD; SCON=0x50; TR1=1;
  n=0;
  while(1){
    SBUF = n;
    while(!TI);
    TI=0;
    n++;
  }
}
