/* 函数调用 / 栈 / 参数传递（--stack-auto 下验证 SP 与栈行为） */
#include <8051.h>
volatile unsigned int seed;
unsigned int mix(unsigned int x, unsigned char k){
  unsigned char i;
  for(i=0;i<k;i++){ x = x * 3 + 7; x ^= (x >> 3); }
  return x;
}
void main(void){
  unsigned int a = 0x1234, b = 0x5678;
  a = mix(a, 5);
  b = mix(b, 9);
  seed = a ^ b;
  while(1);
}
