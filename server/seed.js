/*
 * seed.js — 内置实验题目（C51 起始代码 / 原理图预设 / 判定要点）
 * ==================================================================
 * 每个题目包含：
 *   id        唯一标识（同时作为练习记录里的 problem_id）
 *   preset    对应 public/js/schematic/schematic.js 中的 PRESETS 键
 *   starter   学生打开题目时载入 IDE 的起始代码
 *   tests     平台自动判定的检查项（在学生点击"检查"时执行）
 *   hex       预编译产物（由 tools/precompile_experiments.sh 生成，可离线直接运行）
 */

export const DEFAULT_SETTINGS = {
  site_name: '微控制器原理及应用 · 教学仿真实验平台',
  announce: '',
  require_roster: '1',
  allow_self_register: '1',
  roster: '[]',
  llm: JSON.stringify({
    enabled: false, baseUrl: 'https://api.deepseek.com/v1', apiKey: '',
    model: 'deepseek-chat', temperature: 0.3, maxTokens: 1200, systemExtra: ''
  })
};

/* 通用延时（11.0592MHz，约 1ms @ unsigned int i） */
const DELAY_MS = `
/* 软件延时：11.0592MHz 晶振、12T 模式，约 ms 毫秒。
   · volatile 必不可少，否则 SDCC 会把没有副作用的空循环整个优化掉；
   · 内层次数 28 是用本平台仿真器实测标定的：内层一次约 33 个机器周期，
     28 次 ≈ 916 个机器周期 ≈ 1ms（误差 <1%）。
   · 对时序要求高的场合（波特率、精确计时）请改用定时器。 */
void delay_ms(unsigned int ms){
    volatile unsigned int i, j;
    for(i = 0; i < ms; i++)
        for(j = 0; j < 28; j++);
}
`;

export const PROBLEMS = [
  /* ------------------------------------------------------------ 实验一：LED 流水灯 */
  {
    id: 'led_flow', title: '实验一 LED 流水灯（P1 口位移法）', chapter: '第2章 单片机结构', difficulty: '基础',
    preset: 'led_min',
    statement: `**实验目的**：掌握 8051 并行 I/O 口的输出控制与循环移位。
**硬件连接**：VCC → 1kΩ 排阻 → LED 阳极 → LED 阴极 → P1.0~P1.7（灌电流接法）。
**现象要求**：8 只 LED 依次点亮，形成"流水"效果，循环不止。

**要点**
1. 采用灌电流接法时，P1 口输出 **0** 才点亮对应 LED（所以初值 0xFE 表示 P1.0 亮）。
2. 循环左移可用 \`_crol_(a,1)\`（需 \`#include <intrins.h>\`），也可手写 \`A=(A<<1)|(A>>7)\`。
3. 要观察流动效果，每步之间必须有延时，否则人眼只能看到全部常亮。`,
    starter: `#include <stc89.h>
#include <intrins.h>
${DELAY_MS}
void main(void){
    unsigned char led = 0xFE;      /* 0 表示点亮：P1.0 先亮 */
    P1 = 0xFF;                     /* 先全灭 */
    while(1){
        P1 = led;                  /* 输出当前图案 */
        delay_ms(200);             /* 延时 200ms，便于观察 */
        led = _crol_(led, 1);      /* 循环左移一位 */
    }
}
`,
    tests: [
      { kind: 'compile', desc: '代码能编译通过并生成 .hex' },
      { kind: 'portPattern', port: 1, desc: 'P1 口出现 0xFE、0xFD 等"单个 0"的循环图案', expect: 'singleZeroCycle' },
      { kind: 'toggleMin', port: 1, min: 8, desc: 'P1 口在一次仿真中至少变化 8 次（说明在循环）' }
    ]
  },

  /* ------------------------------------------------------------ 实验二：LED 二进制计数 */
  {
    id: 'led_binary', title: '实验二 LED 二进制计数显示', chapter: '第2章 单片机结构', difficulty: '基础',
    preset: 'led_min',
    statement: `**实验目的**：理解二进制数与端口输出位的一一对应关系。
**现象要求**：8 只 LED 以二进制方式从 0 累加到 255，然后自动回零，循环往复。

**要点**：LED 按"灌电流"接法，所以 P1 = ~count 才能得到"亮灯数=二进制值"的直观效果。`,
    starter: `#include <stc89.h>
${DELAY_MS}
void main(void){
    unsigned char count = 0;
    while(1){
        P1 = ~count;               /* 取反：count 的二进制位直接对应 8 只 LED */
        delay_ms(120);
        count++;                   /* unsigned char 自动回绕 255→0 */
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'toggleMin', port: 1, min: 20, desc: 'P1 至少变化 20 次（说明在连续计数）' }
    ]
  },

  /* ------------------------------------------------------------ 实验三：蜂鸣器鸣叫 */
  {
    id: 'buzzer_beep', title: '实验三 蜂鸣器控制（有源蜂鸣器鸣叫）', chapter: '第3章 定时器', difficulty: '基础',
    preset: 'buzzer',
    statement: `**实验目的**：掌握通过三极管驱动蜂鸣器的方法与定时器初值计算。
**现象要求**：蜂鸣器每响 0.5 秒、停 0.5 秒，循环往复。

**要点**
1. 有源蜂鸣器只需给直流电平即发声；无源蜂鸣器必须给方波。
2. 用 P1.0 经 1kΩ 电阻驱动 NPN 三极管基极，蜂鸣器接集电极，发射极接地。
3. 若用定时器做时基：\`TH0/TL0 = 65536 - 50000\`（50ms @ 11.0592MHz，12T）。
   - 50000 = 0x C350 → TH0=0xC3, TL0=0x50`,
    starter: `#include <stc89.h>
${DELAY_MS}
sbit BEEP = P1^0;                  /* 蜂鸣器驱动脚 */

void main(void){
    unsigned char i;
    BEEP = 0;                      /* 上电先关闭 */
    while(1){
        BEEP = 1;                  /* 鸣叫 500ms */
        delay_ms(500);
        BEEP = 0;                  /* 静音 500ms */
        delay_ms(500);
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'pinToggle', pin: 'P1.0', min: 4, desc: 'P1.0 在仿真中至少翻转 4 次（蜂鸣器有鸣叫/停止交替）' }
    ]
  },

  /* ------------------------------------------------------------ 实验四：蜂鸣器播放音乐 */
  {
    id: 'buzzer_music', title: '实验四 蜂鸣器播放音乐（无源蜂鸣器）', chapter: '第3章 定时器', difficulty: '进阶',
    preset: 'buzzer',
    statement: `**实验目的**：用定时器产生不同频率的方波驱动无源蜂鸣器，理解"频率→音调、时长→节拍"。
**现象要求**：依次播放 1 2 3 4 5 6 7 共 7 个音，每个音持续约 0.4 秒。

**要点**
1. 无源蜂鸣器要发声必须输入方波，方波周期 = 1/频率。中音区参考频率：
   - do(1) 262Hz、re(2) 294Hz、mi(3) 330Hz、fa(4) 349Hz、sol(5) 392Hz、la(6) 440Hz、si(7) 494Hz
2. 半周期定时 = 振荡周期数 / 2 / 频率。11.0592MHz、12T 时 1 个机器周期 = 1.085µs。
   例：262Hz 半周期 ≈ 1908µs ≈ 1758 个机器周期 → 定时器初值 = 65536 - 1758 = 63778 = 0xF922。
3. 更简洁的做法是在定时器中断里翻转蜂鸣器引脚。`,
    starter: `#include <stc89.h>
${DELAY_MS}
sbit BEEP   = P1^0;
sbit SPEAK  = P3^4;                 /* 也可用 T0 引脚输出 */

/* 各音名对应的定时器重装值（11.0592MHz, 12T 近似值） */
unsigned int code toneReload[8] = {
    0,      /* 休止 */
    63778,  /* 1 do  262Hz */
    63879,  /* 2 re  294Hz */
    63977,  /* 3 mi  330Hz */
    64053,  /* 4 fa  349Hz */
    64156,  /* 5 sol 392Hz */
    64262,  /* 6 la  440Hz */
    64350   /* 7 si  494Hz */
};

unsigned int reload;
unsigned char idx = 0;

/* 定时器0 中断：每次溢出翻转蜂鸣器，得到方波 */
void T0_isr(void) __interrupt(1){
    TH0 = (reload >> 8) & 0xFF;
    TL0 = reload & 0xFF;
    BEEP = ~BEEP;
}

void main(void){
    unsigned char n, beat;
    TMOD = 0x01;                    /* T0 方式1，16 位 */
    EA = 1; ET0 = 1;                /* 允许 T0 中断 */
    BEEP = 0;
    while(1){
        for(n = 1; n <= 7; n++){
            reload = toneReload[n];
            TH0 = (reload >> 8) & 0xFF;
            TL0 = reload & 0xFF;
            TR0 = 1;                /* 开始发声 */
            for(beat = 0; beat < 12; beat++) delay_ms(35);   /* 约 0.42s */
            TR0 = 0;                /* 停声，形成音之间的间隔 */
            BEEP = 0;
            delay_ms(60);
        }
        delay_ms(500);              /* 一轮结束后的停顿 */
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'pinToggle', pin: 'P1.0', min: 20, desc: '蜂鸣器引脚高频翻转（在发声）' },
      { kind: 'isrVector', vector: 'TIMER0', desc: '使用了定时器 0 中断' }
    ]
  },

  /* ------------------------------------------------------------ 实验五：数码管静态显示 */
  {
    id: 'seg_static', title: '实验五 数码管静态显示', chapter: '第4章 显示器件', difficulty: '基础',
    preset: 'seg_static',
    statement: `**实验目的**：掌握共阴数码管的段码表与静态显示方法。
**现象要求**：数码管以 1 秒为间隔循环显示 0→1→2→…→9→0。

**要点**
1. 共阴数码管：公共端接地，段码为高电平时该段点亮。
2. 段码表（a 为最低位）：0=0x3F, 1=0x06, 2=0x5B, 3=0x4F, 4=0x66, 5=0x6D, 6=0x7D, 7=0x07, 8=0x7F, 9=0x6F。
3. 数字 6 用 0x7D（含上半段 a 段），数字 9 用 0x6F。`,
    starter: `#include <stc89.h>
${DELAY_MS}
/* 共阴段码表：0-9（不含小数点） */
unsigned char code segCode[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};

void main(void){
    unsigned char n = 0;
    while(1){
        P0 = segCode[n];            /* 段码输出到 P0，经排阻限流 */
        delay_ms(1000);
        n++;
        if(n > 9) n = 0;
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'segValue', device: 'seg7', min: 5, desc: '数码管显示过至少 5 个不同的数字' }
    ]
  },

  /* ------------------------------------------------------------ 实验六：数码管动态扫描 */
  {
    id: 'seg_scan', title: '实验六 数码管动态扫描显示（1234）', chapter: '第4章 显示器件', difficulty: '进阶',
    preset: 'seg_scan',
    statement: `**实验目的**：理解动态扫描原理（视觉暂留）与刷新率要求。
**现象要求**：四位数码管稳定显示 1234，无可见闪烁。

**要点**
1. 动态扫描的本质是"分时复用"：同一时刻只有一位被点亮，靠人眼视觉暂留形成连续显示。
2. 刷新率必须 ≥ 50Hz（即每位点亮时间 ≤ 5ms，四位一轮 ≤ 20ms）。建议每位 1~2ms。
3. 扫描间隔过长会看到明显闪烁；过短则亮度不足。可在逻辑分析仪上观察位选信号的周期，
   验证"刷新率 = 1 / (4 × 每位时间)"。`,
    starter: `#include <stc89.h>
${DELAY_MS}
unsigned char code segCode[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
unsigned char code digit[4] = {1, 2, 3, 4};      /* 要显示的四位数字 */

void main(void){
    unsigned char i;
    unsigned char sel;
    while(1){
        sel = 0xFE;                  /* 0xFE=1111 1110，第 1 位选通（共阴：位选低有效） */
        for(i = 0; i < 4; i++){
            P0 = 0x00;               /* 消隐：先关段码，避免"鬼影" */
            P2 = sel;                /* 位选 */
            P0 = segCode[digit[i]];  /* 输出段码 */
            delay_ms(2);             /* 每位点亮 2ms */
            sel = (sel << 1) | 0x01; /* 移到下一位 */
        }
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'scanRate', port: 2, minHz: 40, desc: '位选扫描刷新率 ≥ 40Hz（逻辑分析仪自动测量）' },
      { kind: 'segValue', device: 'seg7x4', min: 4, desc: '四位数码管均被点亮过' }
    ]
  },

  /* ------------------------------------------------------------ 实验七：矩阵键盘 */
  {
    id: 'matrix_keypad', title: '实验七 4×4 矩阵键盘按键识别', chapter: '第5章 输入接口', difficulty: '进阶',
    preset: 'matrix_keypad',
    statement: `**实验目的**：掌握矩阵键盘的行扫描法与按键消抖。
**现象要求**：按下任意键，能正确识别出该键的行列位置。

**要点**
1. 行线接 P1.0–P1.3，列线接 P1.4–P1.7。
2. 行扫描法：依次将一行拉低，读列线；若某列为低，说明该行该列交叉处的按键被按下。
3. **必须消抖**：机械按键按下瞬间有 5~10ms 的抖动，需延时 10~20ms 后二次确认。
4. 还要考虑"松手检测"，否则一次按下会被识别成多次。`,
    starter: `#include <stc89.h>
${DELAY_MS}
/* 行扫描法识别 4x4 矩阵键盘；返回 0~15 表示键号，16 表示无按键 */
unsigned char keyScan(void){
    unsigned char row, col, val;
    for(row = 0; row < 4; row++){
        P1 = ~(0x01 << row);            /* 第 row 行拉低，其余行拉高 */
        val = P1;                       /* 读回端口 */
        for(col = 0; col < 4; col++){
            if(((val >> (col + 4)) & 0x01) == 0){   /* 该列为低 → 命中 */
                delay_ms(15);                           /* 消抖 */
                val = P1;
                if(((val >> (col + 4)) & 0x01) == 0)
                    return row * 4 + col;
            }
        }
    }
    P1 = 0xFF;
    return 16;
}

void main(void){
    unsigned char key;
    unsigned int  count = 0;
    P1 = 0xFF;
    while(1){
        key = keyScan();
        if(key < 16){
            count++;                    /* 有按键：累加计数（可用数码管显示） */
            while(keyScan() < 16);      /* 等待松手，避免重复计数 */
        }
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'keypadDetect', desc: '仿真中注入按键后 P1 端口出现预期的行列电平' }
    ]
  },

  /* ------------------------------------------------------------ 实验八：LCD1602 */
  {
    id: 'lcd1602', title: '实验八 LCD1602 显示字符', chapter: '第4章 显示器件', difficulty: '进阶',
    preset: 'lcd1602',
    statement: `**实验目的**：掌握 HD44780 控制器的 4 位总线驱动方法。
**现象要求**：第一行显示 "Hello STC89C52"，第二行显示 "MCU Lab 2026"。

**要点**
1. 4 位总线只接 D4–D7，每次先发高 4 位、再发低 4 位（本平台 LCD 模型已实现该时序）。
2. 初始化顺序（缺一不可）：\`0x33 → 0x32 → 0x28 → 0x0C → 0x06 → 0x01\`。
   - 0x33/0x32 是 8 位→4 位切换的标准"软复位"序列，用来保证上电状态不确定时也能正确进入 4 位模式。
   - 0x28 = 4 位、2 行、5×7 点阵；0x0C = 开显示、关光标；0x06 = 地址自增；0x01 = 清屏（需延时 >1.5ms）。
3. RS=0 写指令、RS=1 写数据；E 需要一个"高→低"的下降沿把数据锁进 LCD。`,
    starter: `#include <stc89.h>
${DELAY_MS}
sbit LCD_RS = P2^5;
sbit LCD_E  = P2^6;
/* RW 直接接地（只写模式） */

void lcdWriteByte(unsigned char val, unsigned char isData){
    unsigned char hi = val >> 4, lo = val & 0x0F;
    LCD_RS = isData;
    /* 先发高 4 位 */
    P0 = (P0 & 0x0F) | (hi << 4);
    LCD_E = 1; LCD_E = 0;
    /* 再发低 4 位 */
    P0 = (P0 & 0x0F) | (lo << 4);
    LCD_E = 1; LCD_E = 0;
    delay_ms(1);
}
#define lcdCmd(c)  lcdWriteByte((c), 0)
#define lcdData(c) lcdWriteByte((c), 1)

void lcdInit(void){
    delay_ms(20);                  /* 上电等待 >15ms */
    lcdCmd(0x33);                  /* 8 位 → 4 位 切换序列 */
    lcdCmd(0x32);
    lcdCmd(0x28);                  /* 4 位总线, 2 行, 5x7 */
    lcdCmd(0x0C);                  /* 开显示, 关光标, 不闪烁 */
    lcdCmd(0x06);                  /* 写一个字符后地址自增 */
    lcdCmd(0x01);                  /* 清屏 */
    delay_ms(2);                   /* 清屏需要 >1.53ms */
}

void lcdPuts(unsigned char row, unsigned char col, char *s){
    lcdCmd((row == 0 ? 0x80 : 0xC0) + col);   /* 设置 DDRAM 地址 */
    while(*s) lcdData(*s++);
}

void main(void){
    lcdInit();
    lcdPuts(0, 0, "Hello STC89C52");
    lcdPuts(1, 0, "MCU Lab 2026");
    while(1);
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'lcdText', row0: 'Hello', row1: 'MCU', desc: 'LCD 两行内容与题目要求一致' }
    ]
  },

  /* ------------------------------------------------------------ 实验九：串口通信 */
  {
    id: 'uart_echo', title: '实验九 串口通信（UART 回显）', chapter: '第6章 串行通信', difficulty: '进阶',
    preset: 'uart',
    statement: `**实验目的**：掌握 UART 方式 1 的初始化、波特率计算与收发流程。
**现象要求**：从串口助手发送任意字符，单片机原样发回（回显）；同时在逻辑分析仪上能看到完整的 UART 波形。

**要点**
1. 方式 1（8 位 UART，可变波特率）由 Timer1 方式 2 做波特率发生器。
2. 11.0592MHz、SMOD=0：9600bps → \`TH1 = TL1 = 0xFD\`；19200 → \`0xF4\`；4800 → \`0xFA\`。
   > 为什么选 11.0592MHz 而不是 12MHz？因为它能被波特率整除，9600bps 的误差为 0；
   > 12MHz 下 9600bps 误差约 8.5%，会丢字节。
3. 发送：写 SBUF 后硬件自动置 TI，软件必须清 TI；接收：RI 置位后软件清 RI。
4. **不要在中断和主循环里同时清 TI/RI，容易丢标志。**`,
    starter: `#include <stc89.h>
${DELAY_MS}
/* 串口初始化：9600bps @ 11.0592MHz，方式1，允许接收 */
void uartInit(void){
    TMOD = (TMOD & 0x0F) | 0x20;    /* T1 方式2（8 位自动重装），保留 T0 设置 */
    TH1 = 0xFD;
    TL1 = 0xFD;
    TR1 = 1;                        /* 启动 T1 */
    SCON = 0x50;                    /* 方式1，REN=1 允许接收 */
    /* PCON &= 0x7F;  若需要 19200bps，则 PCON |= 0x80（SMOD=1） */
}

void uartSend(unsigned char c){
    SBUF = c;
    while(!TI);                     /* 等发送完成 */
    TI = 0;                         /* 软清标志 */
}

void main(void){
    unsigned char c;
    uartInit();
    while(1){
        if(RI){                     /* 收到一个字节 */
            c = SBUF;
            RI = 0;                 /* 先清标志再处理，避免丢字节 */
            uartSend(c);            /* 回显 */
        }
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'uartTx', min: 1, desc: '注水测试：向 RXD 注入字符后 TXD 应发出相同字符' }
    ]
  },

  /* ------------------------------------------------------------ 实验十：外部中断 */
  {
    id: 'ext_int', title: '实验十 外部中断计数', chapter: '第3章 中断系统', difficulty: '进阶',
    preset: 'external_int',
    statement: `**实验目的**：掌握外部中断的触发方式选择与中断服务函数编写。
**现象要求**：每按下一次 K1（接 P3.2/INT0），LED 状态翻转一次。

**要点**
1. INT0 的中断向量地址是 **0003H**，INT1 是 **0013H**（易错点：写成 000BH 就跑到定时器 0 去了）。
2. \`IT0=1\` 表示**下降沿触发**，\`IT0=0\` 表示**低电平触发**（按键用下降沿更可靠）。
3. 开中断三步：\`EX0=1\`（允许外部中断 0）、\`EA=1\`（开总中断）、\`IT0=1\`（选边沿触发）。
4. 中断服务函数中如修改主循环要用的变量，该变量必须声明为 \`volatile\`。`,
    starter: `#include <stc89.h>
sbit LED = P1^0;

volatile unsigned char pressCount = 0;   /* 必须 volatile：中断与主循环共享 */

/* 外部中断 0 服务函数：向量地址 0003H */
void INT0_isr(void) __interrupt(0){
    pressCount++;
    LED = ~LED;                          /* 翻转 LED */
}

void main(void){
    LED = 0;
    IT0 = 1;                             /* 下降沿触发 */
    EX0 = 1;                             /* 允许外部中断 0 */
    EA  = 1;                             /* 开总中断 */
    while(1){
        /* 主循环可以做别的事，按键由中断处理 */
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'isrVector', vector: 'EXT0', desc: '正确使用了外部中断 0（向量 0003H）' },
      { kind: 'pinToggle', pin: 'P1.0', min: 2, desc: '按键后 LED 引脚翻转' }
    ]
  },

  /* ------------------------------------------------------------ 实验十一：定时器时钟 */
  {
    id: 'timer_clock', title: '实验十一 定时器精确定时（1 秒计时）', chapter: '第3章 定时器', difficulty: '进阶',
    preset: 'seg_scan',
    statement: `**实验目的**：用定时器中断实现精确 1 秒计时，理解定时器初值计算。
**现象要求**：四位数码管显示秒计数 0000 → 9999 循环，每 1 秒加 1。

**要点**
1. 一次定时 50ms：\`初值 = 65536 - 50ms/1.085µs = 65536 - 46083 = 0x4BFD\`。
   （准确算法：50ms × 11.0592MHz / 12 = 46080 个机器周期，初值 = 65536-46080 = 19456 = 0x4C00）
2. 方式 1 不自动重装，所以 **中断里必须重写 TH0/TL0**，否则第二次溢出要等 65.5ms×1024。
3. 累计 20 次 50ms 中断 = 1 秒。`,
    starter: `#include <stc89.h>
${DELAY_MS}
unsigned char code segCode[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
volatile unsigned char tick50ms = 0;
volatile unsigned int  seconds  = 0;

/* 50ms @ 11.0592MHz, 12T：初值 65536 - 46080 = 0x4C00 */
#define T0_H 0x4C
#define T0_L 0x00

void T0_isr(void) __interrupt(1){
    TH0 = T0_H;                     /* 关键：方式 1 必须手动重装！ */
    TL0 = T0_L;
    if(++tick50ms >= 20){           /* 20 × 50ms = 1s */
        tick50ms = 0;
        seconds++;
        if(seconds > 9999) seconds = 0;
    }
}

void main(void){
    unsigned int v;
    unsigned char d[4], i, sel;
    TMOD = 0x01;                    /* T0 方式1，16 位 */
    TH0 = T0_H; TL0 = T0_L;
    EA = 1; ET0 = 1; TR0 = 1;
    while(1){
        v = seconds;
        d[0] = v / 1000;            /* 千位 */
        d[1] = v / 100 % 10;
        d[2] = v / 10 % 10;
        d[3] = v % 10;
        sel = 0xFE;
        for(i = 0; i < 4; i++){
            P0 = 0x00;
            P2 = sel;
            P0 = segCode[d[i]];
            delay_ms(2);
            sel = (sel << 1) | 0x01;
        }
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'isrVector', vector: 'TIMER0', desc: '使用定时器 0 中断' },
      { kind: 'timerReload', desc: '中断服务函数中重装了 TH0/TL0（否则定时不再准确）' }
    ]
  },

  /* ------------------------------------------------------------ 实验十二：I2C EEPROM */
  {
    id: 'i2c_eeprom', title: '实验十二 I2C 总线读写 AT24C02', chapter: '第6章 串行通信', difficulty: '综合',
    preset: 'i2c',
    statement: `**实验目的**：用软件模拟 I2C 总线时序（起始/停止/应答/字节收发），掌握 I2C 协议。
**现象要求**：向 AT24C02 的 0x00 地址写入 0x55，再读回校验，结果正确时 LED 点亮。

**要点**
1. I2C 两根线 SCL/SDA **都必须外接 4.7kΩ 上拉电阻**（开漏总线，无上拉无法输出高电平）。
2. 起始条件：SCL 为高时 SDA 由高变低；停止条件：SCL 为高时 SDA 由低变高。
3. 数据位在 SCL 高电平期间必须保持稳定，只在 SCL 低电平时改变。
4. 每传输 1 字节后，接收方拉低 SDA 产生应答（ACK）。`,
    starter: `#include <stc89.h>
${DELAY_MS}
sbit SCL = P2^0;
sbit SDA = P2^1;

#define AT24_ADDR 0xA0              /* AT24C02 的 7 位地址 1010000，左移后 0xA0 */

void i2cDelay(void){ unsigned char i; for(i=0;i<20;i++); }

void i2cStart(void){
    SDA = 1; SCL = 1; i2cDelay();
    SDA = 0; i2cDelay();            /* SCL 高时 SDA 下降 = 起始 */
    SCL = 0; i2cDelay();
}
void i2cStop(void){
    SDA = 0; SCL = 1; i2cDelay();
    SDA = 1; i2cDelay();            /* SCL 高时 SDA 上升 = 停止 */
}
/* 发送一个字节，返回 0 表示收到应答 */
bit i2cSendByte(unsigned char b){
    unsigned char i;
    for(i = 0; i < 8; i++){
        SDA = (b & 0x80) ? 1 : 0;
        b <<= 1;
        SCL = 1; i2cDelay();        /* 高电平期间数据稳定 */
        SCL = 0; i2cDelay();
    }
    SDA = 1;                        /* 释放 SDA 准备读应答 */
    SCL = 1; i2cDelay();
    i = SDA;                        /* 0 = ACK */
    SCL = 0; i2cDelay();
    return i;
}
unsigned char i2cReadByte(void){
    unsigned char i, b = 0;
    SDA = 1;
    for(i = 0; i < 8; i++){
        SCL = 1; i2cDelay();
        b = (b << 1) | (SDA ? 1 : 0);
        SCL = 0; i2cDelay();
    }
    SDA = 1; SCL = 1; i2cDelay();   /* 主机不应答，发送 NACK */
    SCL = 0; i2cDelay();
    return b;
}

void main(void){
    unsigned char v;
    SCL = 1; SDA = 1;
    /* 写：器件地址(写) → 字地址 → 数据 */
    i2cStart();
    i2cSendByte(AT24_ADDR);
    i2cSendByte(0x00);
    i2cSendByte(0x55);
    i2cStop();
    delay_ms(10);                   /* EEPROM 写周期约 5ms */
    /* 读：器件地址(写) → 字地址 → 器件地址(读) → 数据 */
    i2cStart();
    i2cSendByte(AT24_ADDR);
    i2cSendByte(0x00);
    i2cStart();
    i2cSendByte(AT24_ADDR | 0x01);
    v = i2cReadByte();
    i2cStop();
    P1 = (v == 0x55) ? 0xFE : 0xFF; /* 校验正确点亮 P1.0 */
    while(1);
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'i2cAccess', device: 'at24c02', desc: 'I2C 总线上出现完整的地址与数据帧' }
    ]
  },

  /* ------------------------------------------------------------ 实验十三：SPI 74HC595 */
  {
    id: 'spi_595', title: '实验十三 SPI 移位寄存器 74HC595 驱动 LED', chapter: '第6章 串行通信', difficulty: '综合',
    preset: 'spi_595',
    statement: `**实验目的**：掌握 SPI 类同步串行接口（DS/SHCP/STCP 三线）与串并转换。
**现象要求**：8 只 LED 呈现流水灯效果，但数据是通过 74HC595 串行移位输出的。

**要点**
1. 74HC595 的三根控制线：\`DS\`（串行数据）、\`SHCP\`（移位时钟，上升沿移入）、\`STCP\`（锁存时钟，上升沿送到输出）。
2. 数据是"先移入高位"：连续发 8 个位后，最早发的位跑到 Q7，最后发的位停在 Q0。
   所以要让 Q0 输出 1，应最后发送该位。
3. \`MR\`（低电平复位）必须接 VCC，\`OE\`（输出使能，低有效）必须接 GND，否则输出被关断。
4. 移位过程中输出不变（因为还没锁存），这是 595 的"无抖动"特性。`,
    starter: `#include <stc89.h>
${DELAY_MS}
sbit DS   = P2^0;                   /* 串行数据 */
sbit SHCP = P2^1;                   /* 移位时钟 */
sbit STCP = P2^2;                   /* 锁存时钟 */

void hc595Send(unsigned char b){
    unsigned char i;
    for(i = 0; i < 8; i++){
        DS = (b & 0x80) ? 1 : 0;    /* 先发最高位 */
        b <<= 1;
        SHCP = 0;                   /* 先拉低，保证产生上升沿 */
        SHCP = 1;                   /* 上升沿移入 */
    }
    STCP = 0;                       /* 产生锁存上升沿，数据送到 Q0-Q7 */
    STCP = 1;
}

void main(void){
    unsigned char led = 0x01;       /* 595 输出高电平点亮 LED（共阴接法） */
    while(1){
        hc595Send(led);
        delay_ms(200);
        led = (led << 1);
        if(led == 0) led = 0x01;
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'hc595Shift', desc: '74HC595 内部移位寄存器随 SHCP 上升沿移位，STCP 上升沿更新输出' }
    ]
  },

  /* ------------------------------------------------------------ 实验十四：PWM 调光 */
  {
    id: 'pwm_led', title: '实验十四 定时器实现 PWM 呼吸灯', chapter: '第7章 综合应用', difficulty: '综合',
    preset: 'led_min',
    statement: `**实验目的**：用定时器中断实现软件 PWM，理解占空比与平均亮度的关系。
**现象要求**：8 只 LED 依次呈现"渐亮 → 渐暗"的呼吸效果。

**要点**
1. PWM 原理：在一个固定周期内改变高电平所占比例（占空比），负载上的平均电压随之变化。
2. 用定时器产生 100 级（0~99）的计数，把它与"亮度阈值"比较来决定 LED 通断：
   \`if (counter < duty) LED = 0; else LED = 1;\`
3. PWM 频率要高于人眼闪烁融合频率（>100Hz）。100 级 × 每级 100µs = 10ms → 100Hz，刚好合适。
4. 在逻辑分析仪上量得的"高电平时间 ÷ 周期"就是占空比，可与代码里的 duty 值对照验证。`,
    starter: `#include <stc89.h>
${DELAY_MS}
volatile unsigned char pwmCnt = 0;
volatile unsigned char duty    = 10;      /* 0~99，占空比百分比 */
volatile signed   char  dir    = 1;

/* 100µs 定时：65536 - 100/1.085 ≈ 65536 - 92 = 0x FFA4 */
void T0_isr(void) __interrupt(1){
    TH0 = 0xFF; TL0 = 0xA4;
    pwmCnt++;
    if(pwmCnt >= 100){                       /* 10ms 一个 PWM 周期 → 100Hz */
        pwmCnt = 0;
        duty += dir;
        if(duty >= 95) dir = -1;
        if(duty <= 5)  dir = 1;
    }
}

void main(void){
    TMOD = 0x01;
    TH0 = 0xFF; TL0 = 0xA4;
    EA = 1; ET0 = 1; TR0 = 1;
    while(1){
        /* 所有 LED 一起按占空比通断；pwmCnt < duty 时为低电平（点亮） */
        P1 = (pwmCnt < duty) ? 0x00 : 0xFF;
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'isrVector', vector: 'TIMER0', desc: '使用定时器 0 中断产生 PWM' },
      { kind: 'pwmDuty', port: 1, desc: 'P1 口波形占空比随时间变化（呼吸效果）' }
    ]
  },

  /* ------------------------------------------------------------ 实验十五：综合实验 */
  {
    id: 'final_project', title: '实验十五 综合实验：按键设定 + 数码管显示 + 串口上报',
    chapter: '第7章 综合应用', difficulty: '综合',
    preset: 'seg_scan',
    statement: `**实验目的**：综合运用 I/O、中断、定时器、串口与显示器件完成一个小系统。

**任务**
1. 四位数码管动态扫描显示一个 4 位十进制数。
2. 每按一次独立按键，数值加 1（按键必须消抖）。
3. 每次数值变化时，通过串口以 ASCII 形式上报："COUNT=0007\\r\\n"。
4. 系统节拍由定时器中断提供，主循环只负责显示与状态判断。

**评分要点**
- 显示是否稳定（扫描刷新率 ≥ 50Hz，无可见闪烁）
- 按键是否只加一次（消抖 + 松手检测）
- 串口输出格式是否严格符合 "COUNT=%04d\\r\\n"
- 中断服务函数是否足够短（不阻塞定时与串口）`,
    starter: `#include <stc89.h>
#include <stdio.h>
${DELAY_MS}
unsigned char code segCode[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
sbit KEY = P3^2;
volatile unsigned int count = 0;
volatile unsigned char dirty = 0;

void T0_isr(void) __interrupt(1){          /* 2ms 节拍：数码管扫描 */
    static unsigned char idx = 0;
    static unsigned char sel = 0xFE;
    unsigned int v;
    TH0 = 0xF8; TL0 = 0x30;                /* 约 2ms */
    switch(idx){
        case 0: v = count / 1000; break;
        case 1: v = count / 100 % 10; break;
        case 2: v = count / 10 % 10; break;
        default: v = count % 10; break;
    }
    P0 = 0x00;                             /* 消隐 */
    P2 = sel;
    P0 = segCode[v];
    sel = (sel << 1) | 0x01;
    if(++idx >= 4){ idx = 0; sel = 0xFE; }
}

void main(void){
    unsigned char last = 1;
    TMOD = 0x01;
    TH0 = 0xF8; TL0 = 0x30;
    EA = 1; ET0 = 1; TR0 = 1;
    P3 |= 0x04;                            /* P3.2 作为输入 */
    while(1){
        if(KEY == 0){                      /* 按键按下 */
            delay_ms(15);                  /* 消抖 */
            if(KEY == 0){
                count++;
                dirty = 1;
                while(KEY == 0);           /* 等松手 */
            }
        }
        if(dirty){                         /* 数值变化才上报，避免刷屏 */
            dirty = 0;
            printf("COUNT=%04u\\r\\n", count);
        }
    }
}
`,
    tests: [
      { kind: 'compile', desc: '编译通过' },
      { kind: 'isrVector', vector: 'TIMER0', desc: '使用定时器中断做扫描节拍' },
      { kind: 'scanRate', port: 2, minHz: 40, desc: '数码管扫描刷新率 ≥ 40Hz' },
      { kind: 'uartFormat', pattern: '^COUNT=\\d{4}\\r?\\n', desc: '串口输出符合 COUNT=0007 格式' }
    ]
  }
];
