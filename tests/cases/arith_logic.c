/* 算术 / 逻辑 / 移位 / 条件分支 —— 不含外设依赖，结果完全确定 */
#include <8051.h>
volatile unsigned char r0v, r1v;
void main(void){
  unsigned char a=0x35, b=0x7A, i;
  unsigned int s=0;
  for(i=0;i<40;i++){
    a = a + b;
    b = b ^ 0x5A;
    a = (a << 1) | (a >> 7);
    s += (unsigned int)a * (i+1);
    if(a > 0x80) b -= 3;
    else b += 5;
    a = a & 0x7F;
  }
  a = 0x8A; b = 0x07;
  a = a / b; b = a % 3;
  r0v = a; r1v = b;
  while(1){ a++; b--; }
}
