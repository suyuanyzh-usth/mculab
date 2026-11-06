/* 整数除法/取模/长整型/指针（考验 SDCC 库函数与间接寻址） */
#include <8051.h>
volatile unsigned char buf[8];
volatile unsigned int q;
void main(void){
  unsigned char i;
  unsigned int a=0xFFFF, b=0x0007;
  unsigned long L=100000UL;
  q = a / b;
  for(i=0;i<8;i++) buf[i] = (unsigned char)(i*17+3);
  for(i=0;i<8;i++){ buf[i] ^= buf[(i+3)&7]; }
  while(L > 1000UL) { L -= 997UL; }
  while(1);
}
