/* 位寻址 / 条件判断 / 端口写读（P1 无外设拉低，读回等于锁存值） */
#include <8051.h>
volatile unsigned char out;
void main(void){
  unsigned char i, k=0;
  P1 = 0xF0;
  for(i=0;i<12;i++){
    P1 ^= 0x0F;
    if (P1 & 0x01) k++;
    P1 = (P1 << 1) | (P1 >> 7);
    if (i == 6) k += 7;
    else k -= 1;
  }
  out = k;
  while(1);
}
