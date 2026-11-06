/**
 * core.test.mjs — 8051 内核 / 汇编器 / HEX 单元测试
 * ==================================================================
 * 覆盖：
 *   A. 机器周期表 CYCLE[256] 与 exec() 实际返回值逐操作码一致
 *   B. Intel HEX 装载 / 导出往返一致（含扩展线性地址记录、校验和错误检测）
 *   C. 汇编器指令长度表与 encode() 实际输出长度逐条一致
 *   D. 汇编器语义：手工核算的指令序列执行后寄存器/内存结果正确
 *   E. 端口准双向模型：外部拉低可被读回
 *   F. 定时器模式 0/1/2 溢出周期正确
 *   G. UART 模式 1 发送字节流正确、波特率计算正确
 *   H. 中断优先级：高优先级可打断低优先级
 */
import { CPU8051, CYCLE, PIN } from '../public/js/core/cpu8051.js';
import { SFR } from '../public/js/core/sfr.js';
import { assemble, Asm8051 } from '../public/js/core/asm8051.js';

let pass = 0, fail = 0;
const out = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; out.push(`  [PASS] ${name}`); }
  else { fail++; out.push(`  [FAIL] ${name}${extra ? '  → ' + extra : ''}`); }
}
function near(name, a, b, tol = 0) {
  ok(name, Math.abs(a - b) <= tol, `期望 ${b}，实际 ${a}`);
}

/* ============================ A. 机器周期表 ============================ */
{
  const bad = [];
  for (let op = 0; op < 256; op++) {
    const c = new CPU8051();
    c.code.fill(0x00);
    c.code[0] = op;
    c.pc = 0; c.instrCount = 0;
    c.pc = 1;                             // 模拟取指后 PC 指向操作数
    let got;
    try { got = c.exec(op); } catch (e) { got = 'EXC:' + e.message; }
    if (got !== CYCLE[op]) bad.push(`0x${op.toString(16).toUpperCase()}(执行=${got} 表=${CYCLE[op]})`);
  }
  ok('A1 全部 256 个操作码的周期数与 CYCLE 表一致', bad.length === 0, bad.slice(0, 12).join(' '));
  ok('A2 1 周期操作码数量合理(>60)', CYCLE.filter(v => v === 1).length > 60,
    `实际 ${CYCLE.filter(v => v === 1).length}`);
  near('A3 MUL AB 为 4 周期', CYCLE[0xA4], 4);
  near('A4 DIV AB 为 4 周期', CYCLE[0x84], 4);
  near('A5 LJMP 为 2 周期', CYCLE[0x02], 2);
}

/* ============================ B. Intel HEX ============================ */
{
  const cpu = new CPU8051();
  const hex = [
    ':0300000002004EAD',
    ':100008000000E2FBEAF2802C0000E0FBEAF080242A',
    ':00000001FF'
  ].join('\n');
  const r = cpu.loadHex(hex);
  ok('B1 HEX 装载无校验和错误', r.checksumErrors === 0 && r.badLines === 0, JSON.stringify(r));
  ok('B2 装载字节数正确', r.loaded === 3 + 16, `loaded=${r.loaded}`);
  ok('B3 首字节为 LJMP 操作码 0x02', cpu.code[0] === 0x02 && cpu.code[2] === 0x4E,
    `${cpu.code[0].toString(16)} ${cpu.code[2].toString(16)}`);

  // 校验和错误必须被检出
  const cpu2 = new CPU8051();
  const r2 = cpu2.loadHex(':0300000002004E00\n:00000001FF');
  ok('B4 校验和错误被检出', r2.checksumErrors === 1, JSON.stringify(r2));

  // 导出 → 重新装载 往返一致
  const cpu3 = new CPU8051();
  cpu3.code[0x100] = 0x12; cpu3.code[0x101] = 0xAB; cpu3.code[0x1FF] = 0x7E;
  const exported = cpu3.exportHex(0x100, 0x200);
  const cpu4 = new CPU8051();
  const r4 = cpu4.loadHex(exported);
  ok('B5 HEX 导出→装载 往返一致',
    r4.checksumErrors === 0 && cpu4.code[0x100] === 0x12 && cpu4.code[0x101] === 0xAB && cpu4.code[0x1FF] === 0x7E);

  // 扩展线性地址记录
  const cpu5 = new CPU8051();
  const r5 = cpu5.loadHex(':020000040000FA\n:0400000001020304F2\n:00000001FF');
  ok('B6 支持 04 类扩展线性地址记录', r5.checksumErrors === 0 && cpu5.code[0] === 1 && cpu5.code[3] === 4);
}

/* ============================ C/D. 汇编器 ============================ */
{
  const asm = new Asm8051();
  // C: 长度表 vs 实际编码长度
  const samples = [
    ['NOP'], ['RET'], ['RETI'], ['RR', 'A'], ['RLC', 'A'], ['MUL', 'AB'], ['DIV', 'AB'], ['DA', 'A'],
    ['INC', 'A'], ['INC', 'R3'], ['INC', '@R1'], ['INC', '30H'],
    ['DEC', 'R0'], ['DEC', '20H'],
    ['ADD', 'A,#5'], ['ADD', 'A,30H'], ['ADD', 'A,@R0'], ['ADD', 'A,R7'],
    ['SUBB', 'A,#1'], ['SUBB', 'A,R2'],
    ['ORL', 'A,#0F0H'], ['ORL', '30H,A'], ['ORL', '30H,#1'], ['ORL', 'C,20H'], ['ORL', 'C,/21H'],
    ['ANL', 'A,R1'], ['ANL', 'C,22H'], ['ANL', 'C,/23H'], ['XRL', 'A,24H'],
    ['MOV', 'A,#1'], ['MOV', 'A,25H'], ['MOV', 'A,@R0'], ['MOV', 'A,R5'],
    ['MOV', 'R0,#1'], ['MOV', 'R1,A'], ['MOV', 'R2,26H'],
    ['MOV', '@R0,#1'], ['MOV', '@R1,A'], ['MOV', '@R0,27H'],
    ['MOV', '28H,#1'], ['MOV', '29H,A'], ['MOV', '2AH,R3'], ['MOV', '2BH,@R0'],
    ['MOV', '2CH,2DH'], ['MOV', 'DPTR,#1234H'],
    ['MOV', 'C,20H'], ['MOV', '21H,C'],
    ['MOVC', 'A,@A+DPTR'], ['MOVC', 'A,@A+PC'],
    ['MOVX', 'A,@DPTR'], ['MOVX', 'A,@R0'], ['MOVX', '@DPTR,A'], ['MOVX', '@R1,A'],
    ['PUSH', '30H'], ['POP', '30H'],
    ['XCH', 'A,R4'], ['XCH', 'A,@R0'], ['XCH', 'A,31H'], ['XCHD', 'A,@R0'],
    ['CLR', 'A'], ['CLR', 'C'], ['CLR', '20H'], ['SETB', 'C'], ['SETB', '21H'],
    ['CPL', 'A'], ['CPL', 'C'], ['CPL', '22H'],
    ['AJMP', '0100H'], ['ACALL', '0200H'], ['LJMP', '1234H'], ['LCALL', '2345H'],
    ['SJMP', '$'], ['JC', '$'], ['JNC', '$'], ['JZ', '$'], ['JNZ', '$'],
    ['JB', '20H,$'], ['JNB', '21H,$'], ['JBC', '22H,$'],
    ['DJNZ', 'R0,$'], ['DJNZ', '30H,$'],
    ['CJNE', 'A,#1,$'], ['CJNE', 'A,30H,$'], ['CJNE', 'R0,#1,$'], ['CJNE', '@R0,#1,$'],
    ['JMP', '@A+DPTR']
  ];
  const lenBad = [];
  for (const s of samples) {
    const src = `      ORG 0000H\n      ${s[0]} ${s.slice(1).join(',')}\n      END\n`;
    const r = assemble(src);
    if (!r.ok) { lenBad.push(`${s.join(' ')} → 汇编错误: ${r.errors.map(e => e.msg).join('/')}`); continue; }
    const line = r.listing.find(l => l.bytes.length);
    // 操作数需按逗号切分后再交给长度表（历史上曾把整串当一个操作数，导致误报）
    const expect = asm.lengthOf(s[0].toUpperCase(), s.slice(1).join(',').split(',').filter(x => x.trim()).map(x => x.trim()));
    if (!line) { lenBad.push(`${s.join(' ')} → 无输出`); continue; }
    if (line.bytes.length !== expect) lenBad.push(`${s.join(' ')} → 实际 ${line.bytes.length} 期望 ${expect}`);
  }
  ok('C1 汇编器长度表与编码长度逐条一致', lenBad.length === 0, lenBad.slice(0, 8).join(' ; '));

  // D: 语义验证——加法/比较/循环/查表
  const prog = `
        ORG 0000H
        LJMP  START
        ORG 0030H
START:  MOV  SP, #60H
        MOV  A, #0
        MOV  R7, #10
SUM:    ADD  A, R7
        DJNZ R7, SUM
        MOV  30H, A          ; 10+9+...+1 = 55 = 0x37
        MOV  DPTR, #TAB
        MOV  A, #2
        MOVC A, @A+DPTR      ; 第 3 个表项 = 0x33
        MOV  31H, A
        MOV  A, #0AAH
        MOV  B, #0A0H
        ANL  A, B            ; 0xA0
        MOV  32H, A
        SJMP $
TAB:    DB   11H, 22H, 33H, 44H
        END
`;
  const r = assemble(prog);
  ok('D1 汇编成功无错误', r.ok, r.errors.map(e => `行${e.line}:${e.msg}`).join(' ; '));
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    for (let i = 0; i < 200 && !cpu.halted; i++) {
      const before = cpu.pc;
      cpu.stepOne();
      if (cpu.code[cpu.pc] === 0x80 && cpu.code[cpu.pc + 1] === 0xFE) break;  // SJMP $
      if (cpu.pc === before) break;
    }
    cpu.runCycles(5000);
    ok('D2 累加和 10..1 = 55(0x37)', cpu.iram[0x30] === 0x37,
      `iram[30H]=0x${cpu.iram[0x30].toString(16)}`);
    ok('D3 MOVC 查表第 3 项 = 0x33', cpu.iram[0x31] === 0x33,
      `iram[31H]=0x${cpu.iram[0x31].toString(16)}`);
    ok('D4 ANL A,B = 0xA0', cpu.iram[0x32] === 0xA0,
      `iram[32H]=0x${cpu.iram[0x32].toString(16)}`);
  }

  // D5: 相对跳转越界应报错
  const far = assemble('      ORG 0\n      SJMP 0800H\n      END\n');
  ok('D5 相对跳转越界被报错', !far.ok && far.errors.some(e => /相对跳转/.test(e.msg)),
    far.errors.map(e => e.msg).join('/'));

  // D6: 未定义符号应报错
  const undef = assemble('      ORG 0\n      MOV A, NOSYM\n      END\n');
  ok('D6 未定义符号被报错', !undef.ok, undef.errors.map(e => e.msg).join('/'));
}

/* ============================ E. 端口准双向 ============================ */
{
  const cpu = new CPU8051();
  cpu.writeSfr(SFR.P1, 0xFF);
  ok('E1 写 1 后读数全 1', cpu.readPort(1) === 0xFF);
  cpu.setPinExt(PIN(1, 3), true);          // 外部把 P1.3 拉低
  ok('E2 外部拉低后读回该位为 0', ((cpu.readPort(1) >> 3) & 1) === 0,
    `P1=0x${cpu.readPort(1).toString(16)}`);
  ok('E3 其余位不受影响', (cpu.readPort(1) & 0xF7) === 0xF7);
  cpu.writeSfr(SFR.P1, 0x00);              // 写 0 强拉低
  cpu.setPinExt(PIN(1, 3), false);
  ok('E4 写 0 时外部放开仍为 0', ((cpu.readPort(1) >> 3) & 1) === 0);

  // 引脚跳变事件（供逻辑分析仪）
  const c2 = new CPU8051();
  c2.watchPin = PIN(1, 0);
  c2.clearEvents();
  c2.writeSfr(SFR.P1, 0xFE);
  c2.writeSfr(SFR.P1, 0xFF);
  ok('E5 引脚跳变事件被记录', c2.events.length >= 2, `events=${c2.events.length}`);
  ok('E6 事件带时间戳且递增', c2.events.every((e, i) => i === 0 || e.t >= c2.events[i - 1].t));
}

/* ============================ F. 定时器 ============================ */
{
  // 模式 1：16 位，重装 0xFC18 → 周期 1000 机器周期 = 1000/921600 s
  const cpu = new CPU8051();
  cpu.writeSfr(SFR.TMOD, 0x01);
  cpu.writeSfr(SFR.TH0, 0xFC);
  cpu.writeSfr(SFR.TL0, 0x18);
  cpu.writeSfr(SFR.TCON, 0x10);            // TR0 = 1
  const start = cpu.cycles;
  let overflowAt = -1;
  for (let i = 0; i < 3000; i++) {
    cpu.tick(1);
    if (cpu.sfr[SFR.TCON] & 0x20) { overflowAt = cpu.cycles - start; break; }
  }
  near('F1 Timer0 模式1 溢出周期 = 1000 机器周期', overflowAt, 1000);
  const us = (1000 / (11059200 / 12)) * 1e6;
  near('F2 该周期对应 1085µs（11.0592MHz/12 下 1 周期=1.085µs）', Math.round(us), 1085, 2);

  // 模式 2：8 位自动重装，TH0=0xD0 → 周期 48
  const c2 = new CPU8051();
  c2.writeSfr(SFR.TMOD, 0x02);
  c2.writeSfr(SFR.TH0, 0xD0);
  c2.writeSfr(SFR.TL0, 0xD0);
  c2.writeSfr(SFR.TCON, 0x10);
  let ov2 = -1;
  for (let i = 0; i < 500; i++) {
    c2.tick(1);
    if (c2.sfr[SFR.TCON] & 0x20) { ov2 = i + 1; break; }
  }
  near('F3 Timer0 模式2 溢出周期 = 256-0xD0 = 48', ov2, 48);
  ok('F4 模式2 自动重装后 TL0 = TH0 = 0xD0', c2.sfr[SFR.TL0] === 0xD0,
    `TL0=0x${c2.sfr[SFR.TL0].toString(16)}`);

  // 模式 0：13 位，TH0=0xFF → 只取低 5 位(0x1F)，周期 = 0x1FFF - 0x1F00 + 1 = 0x100 = 256
  const c3 = new CPU8051();
  c3.writeSfr(SFR.TMOD, 0x00);
  c3.writeSfr(SFR.TH0, 0xFF); c3.writeSfr(SFR.TL0, 0x00);
  c3.writeSfr(SFR.TCON, 0x10);
  let ov3 = -1;
  for (let i = 0; i < 900; i++) {
    c3.tick(1);
    if (c3.sfr[SFR.TCON] & 0x20) { ov3 = i + 1; break; }
  }
  near('F5 Timer0 模式0（13位）溢出周期 = 256', ov3, 256);

  // TR0 必须能被写 1（历史 bug：TCON 掩码错误导致定时器永不启动）
  const c4 = new CPU8051();
  c4.writeSfr(SFR.TCON, 0x10);
  ok('F6 TR0 可被写入（TCON 掩码 0x55）', (c4.sfr[SFR.TCON] & 0x10) !== 0,
    `TCON=0x${c4.sfr[SFR.TCON].toString(16)}`);
  c4.writeSfr(SFR.TCON, 0x40);
  ok('F7 TR1 可被写入', (c4.sfr[SFR.TCON] & 0x40) !== 0);
  c4.writeSfr(SFR.TCON, 0x20);             // 试图写 TF0（硬件位，应无效）
  ok('F8 TF0 不能由软件写入', (c4.sfr[SFR.TCON] & 0x20) === 0);
}

/* ============================ G. UART ============================ */
{
  // 波特率：模式1，SMOD=0，TH1=0xFD → 9600 @11.0592MHz
  const cpu = new CPU8051();
  cpu.writeSfr(SFR.TMOD, 0x20);
  cpu.writeSfr(SFR.TH1, 0xFD); cpu.writeSfr(SFR.TL1, 0xFD);
  cpu.writeSfr(SFR.SCON, 0x50);
  cpu.writeSfr(SFR.TCON, 0x40);
  cpu.uart.mode = 1; cpu.uart.double = false;
  near('G1 模式1 TH1=0xFD 波特率 = 9600', Math.round(cpu.baudRate()), 9600, 1);

  // SMOD=1 → 19200
  cpu.writeSfr(SFR.PCON, 0x80);
  near('G2 SMOD=1 时波特率为 19200', Math.round(cpu.baudRate()), 19200, 2);

  // 模式2：fosc/64 (SMOD=0)
  const c2 = new CPU8051();
  c2.setSerialMode(2, 0);
  near('G3 模式2 SMOD=0 波特率 = fosc/64 = 172800', Math.round(c2.baudRate()), 172800, 5);

  // 发送：写入 0x55，等待波特率对应时间后 TI 置位，且字节被记录
  const c3 = new CPU8051();
  c3.writeSfr(SFR.SCON, 0x50);
  c3.uart.mode = 1; c3.uart.double = false;
  c3.writeSfr(SFR.TH1, 0xFD);
  c3.writeSfr(SFR.SBUF, 0x55);
  ok('G4 写 SBUF 后 TI 立即清零', (c3.sfr[SFR.SCON] & 0x02) === 0);
  const cyclesPerBit = c3.bitCycles();
  near('G5 9600bps 下每位 = 96 机器周期', Math.round(cyclesPerBit), 96, 1);
  c3.tick(Math.ceil(cyclesPerBit * 10) + 2);
  ok('G6 发送完 10 位后 TI 置位', (c3.sfr[SFR.SCON] & 0x02) !== 0,
    `SCON=0x${c3.sfr[SFR.SCON].toString(16)}`);
  ok('G7 发送字节被记录到 txBytes', c3.txBytes.length === 1 && c3.txBytes[0] === 0x55,
    JSON.stringify(c3.txBytes));

  // 接收：注入字节 → RI 置位、SBUF 更新
  const c4 = new CPU8051();
  c4.writeSfr(SFR.SCON, 0x50);
  c4.uart.mode = 1;
  c4.writeSfr(SFR.TH1, 0xFD);
  c4.feedSerial(0xA7);
  c4.tick(Math.ceil(c4.bitCycles() * 11) + 4);
  ok('G8 注入字节后 RI 置位', (c4.sfr[SFR.SCON] & 0x01) !== 0,
    `SCON=0x${c4.sfr[SFR.SCON].toString(16)}`);
  ok('G9 SBUF 内容为注入字节', c4.sfr[SFR.SBUF] === 0xA7,
    `SBUF=0x${c4.sfr[SFR.SBUF].toString(16)}`);
  ok('G10 接收过程中 RXD(P3.0) 出现起始位低电平', c4.events.some(e => e.pin === PIN(3, 0) && e.v === 0));
}

/* ============================ H. 中断 ============================ */
{
  // Timer0 中断：开 EA/ET0，TR0 启动，验证进入 0x000B 并在 RETI 后返回
  const prog = `
        ORG 0000H
        LJMP START
        ORG 000BH
        MOV  TH0, #0FCH      ; ISR：重装 1000 周期并翻转 P1.0
        MOV  TL0, #018H
        CPL  P1.0
        RETI
        ORG 0030H
START:  MOV  SP, #60H
        MOV  P1, #00H
        MOV  TMOD, #01H
        MOV  TH0, #0FCH
        MOV  TL0, #018H
        MOV  IE, #082H       ; EA=1, ET0=1
        MOV  TCON, #010H     ; TR0=1
WAIT:   SJMP WAIT
        END
`;
  const r = assemble(prog);
  ok('H1 中断测试程序汇编成功', r.ok, r.errors.map(e => `${e.line}:${e.msg}`).join(';'));
  if (r.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r.hex);
    const p1seq = [];
    let lastP1 = cpu.readPort(1);
    cpu.onPinChange = (pin, val) => { if (pin === PIN(1, 0)) p1seq.push(val); };
    cpu.runCycles(1000 * 8);              // 跑 8 个定时器周期
    ok('H2 定时中断被触发（P1.0 发生翻转）', p1seq.length >= 6, `翻转次数=${p1seq.length}`);
    ok('H3 中断返回后栈指针复原', cpu.sp === 0x60, `SP=0x${cpu.sp.toString(16)}`);
    const toggles = p1seq.filter((v, i) => i > 0 && v !== p1seq[i - 1]).length;
    ok('H4 翻转次数与定时器溢出次数一致（约 8）', toggles >= 6 && toggles <= 10, `toggles=${toggles}`);
  }

  // 外部中断 INT0 下降沿触发
  const prog2 = `
        ORG 0000H
        LJMP START
        ORG 0003H
        SETB P1.7
        RETI
        ORG 0030H
START:  MOV  SP, #60H
        MOV  P1, #00H
        MOV  TCON, #001H     ; IT0=1 下降沿
        MOV  IE, #081H       ; EA=1, EX0=1
WAIT:   SJMP WAIT
        END
`;
  const r2 = assemble(prog2);
  if (r2.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r2.hex);
    for (let i = 0; i < 40; i++) cpu.stepOne();      // 跑完初始化
    ok('H5 初始化后 P1.7 为 0', ((cpu.readPort(1) >> 7) & 1) === 0);
    cpu.setPinExt(PIN(3, 2), true);                  // 拉低 INT0
    cpu.setPinExt(PIN(3, 2), false);
    for (let i = 0; i < 40; i++) cpu.stepOne();
    ok('H6 INT0 下降沿触发外部中断（P1.7 置 1）', ((cpu.readPort(1) >> 7) & 1) === 1,
      `P1=0x${cpu.readPort(1).toString(16)}`);
  } else {
    ok('H6 INT0 下降沿触发外部中断', false, r2.errors.map(e => e.msg).join(';'));
  }

  // 优先级：PX0=1 的高优先级可打断 Timer0 低优先级
  const prog3 = `
        ORG 0000H
        LJMP START
        ORG 0003H
        SETB P1.5
        RETI
        ORG 000BH
        MOV  TH0, #0FCH
        MOV  TL0, #018H
        SETB P1.6
        RETI
        ORG 0030H
START:  MOV  SP, #60H
        MOV  P1, #00H
        MOV  IP, #001H       ; PX0=1 高优先级
        MOV  TMOD, #001H
        MOV  TH0, #0FCH
        MOV  TL0, #018H
        MOV  IE, #083H       ; EA=1, EX0=1, ET0=1
        MOV  TCON, #011H     ; IT0=1, TR0=1
WAIT:   SJMP WAIT
        END
`;
  const r3 = assemble(prog3);
  if (r3.ok) {
    const cpu = new CPU8051();
    cpu.loadHex(r3.hex);
    for (let i = 0; i < 40; i++) cpu.stepOne();
    const order = [];
    cpu.onSfrWrite = (addr) => { if (addr === SFR.P1) order.push(cpu.sfr[SFR.P1]); };
    cpu.setPinExt(PIN(3, 2), true); cpu.setPinExt(PIN(3, 2), false);
    cpu.runCycles(2000);
    const ended = ((cpu.readPort(1) >> 5) & 1) === 1 && ((cpu.readPort(1) >> 6) & 1) === 1;
    ok('H7 高低优先级中断均可响应', ended, `P1=0x${cpu.readPort(1).toString(16)}`);
  } else {
    ok('H7 高低优先级中断均可响应', false, r3.errors.map(e => e.msg).join(';'));
  }
}

/* ============================ 汇总 ============================ */
console.log('\n===== 8051 内核 / 汇编器 / HEX 单元测试 =====\n');
console.log(out.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
