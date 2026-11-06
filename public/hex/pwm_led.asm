;--------------------------------------------------------
; File Created by SDCC : free open source ISO C Compiler
; Version 4.6.0 #16555 (MINGW64)
;--------------------------------------------------------
	.module pwm_led
	
	.optsdcc -mmcs51 --model-small
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _main
	.globl _T0_isr
	.globl _delay_ms
	.globl _P4_3
	.globl _P4_2
	.globl _P4_1
	.globl _P4_0
	.globl _CY
	.globl _AC
	.globl _F0
	.globl _RS1
	.globl _RS0
	.globl _OV
	.globl _F1
	.globl _P
	.globl _PS
	.globl _PT1
	.globl _PX1
	.globl _PT0
	.globl _PX0
	.globl _RD
	.globl _WR
	.globl _T1
	.globl _T0
	.globl _INT1
	.globl _INT0
	.globl _TXD
	.globl _RXD
	.globl _P3_7
	.globl _P3_6
	.globl _P3_5
	.globl _P3_4
	.globl _P3_3
	.globl _P3_2
	.globl _P3_1
	.globl _P3_0
	.globl _EA
	.globl _ES
	.globl _ET1
	.globl _EX1
	.globl _ET0
	.globl _EX0
	.globl _P2_7
	.globl _P2_6
	.globl _P2_5
	.globl _P2_4
	.globl _P2_3
	.globl _P2_2
	.globl _P2_1
	.globl _P2_0
	.globl _SM0
	.globl _SM1
	.globl _SM2
	.globl _REN
	.globl _TB8
	.globl _RB8
	.globl _TI
	.globl _RI
	.globl _P1_7
	.globl _P1_6
	.globl _P1_5
	.globl _P1_4
	.globl _P1_3
	.globl _P1_2
	.globl _P1_1
	.globl _P1_0
	.globl _TF1
	.globl _TR1
	.globl _TF0
	.globl _TR0
	.globl _IE1
	.globl _IT1
	.globl _IE0
	.globl _IT0
	.globl _P0_7
	.globl _P0_6
	.globl _P0_5
	.globl _P0_4
	.globl _P0_3
	.globl _P0_2
	.globl _P0_1
	.globl _P0_0
	.globl _P4
	.globl _IAP_CONTR
	.globl _IAP_TRIG
	.globl _IAP_CMD
	.globl _IAP_ADDRL
	.globl _IAP_ADDRH
	.globl _IAP_DATA
	.globl _WDT_CONTR
	.globl _TH2
	.globl _TL2
	.globl _RCAP2H
	.globl _RCAP2L
	.globl _T2MOD
	.globl _T2CON
	.globl _XICON
	.globl _SADEN
	.globl _IPH
	.globl _SADDR
	.globl _AUXR1
	.globl _AUXR
	.globl _B
	.globl _ACC
	.globl _PSW
	.globl _IP
	.globl _P3
	.globl _IE
	.globl _P2
	.globl _SBUF
	.globl _SCON
	.globl _P1
	.globl _TH1
	.globl _TH0
	.globl _TL1
	.globl _TL0
	.globl _TMOD
	.globl _TCON
	.globl _PCON
	.globl _DPH
	.globl _DPL
	.globl _SP
	.globl _P0
	.globl _dir
	.globl _duty
	.globl _pwmCnt
;--------------------------------------------------------
; special function registers
;--------------------------------------------------------
	.area RSEG    (ABS,DATA)
	.org 0x0000
_P0	=	0x0080
_SP	=	0x0081
_DPL	=	0x0082
_DPH	=	0x0083
_PCON	=	0x0087
_TCON	=	0x0088
_TMOD	=	0x0089
_TL0	=	0x008a
_TL1	=	0x008b
_TH0	=	0x008c
_TH1	=	0x008d
_P1	=	0x0090
_SCON	=	0x0098
_SBUF	=	0x0099
_P2	=	0x00a0
_IE	=	0x00a8
_P3	=	0x00b0
_IP	=	0x00b8
_PSW	=	0x00d0
_ACC	=	0x00e0
_B	=	0x00f0
_AUXR	=	0x008e
_AUXR1	=	0x00a2
_SADDR	=	0x00a9
_IPH	=	0x00b7
_SADEN	=	0x00b9
_XICON	=	0x00c0
_T2CON	=	0x00c8
_T2MOD	=	0x00c9
_RCAP2L	=	0x00ca
_RCAP2H	=	0x00cb
_TL2	=	0x00cc
_TH2	=	0x00cd
_WDT_CONTR	=	0x00e1
_IAP_DATA	=	0x00e2
_IAP_ADDRH	=	0x00e3
_IAP_ADDRL	=	0x00e4
_IAP_CMD	=	0x00e5
_IAP_TRIG	=	0x00e6
_IAP_CONTR	=	0x00e7
_P4	=	0x00e8
;--------------------------------------------------------
; special function bits
;--------------------------------------------------------
	.area RSEG    (ABS,DATA)
	.org 0x0000
_P0_0	=	0x0080
_P0_1	=	0x0081
_P0_2	=	0x0082
_P0_3	=	0x0083
_P0_4	=	0x0084
_P0_5	=	0x0085
_P0_6	=	0x0086
_P0_7	=	0x0087
_IT0	=	0x0088
_IE0	=	0x0089
_IT1	=	0x008a
_IE1	=	0x008b
_TR0	=	0x008c
_TF0	=	0x008d
_TR1	=	0x008e
_TF1	=	0x008f
_P1_0	=	0x0090
_P1_1	=	0x0091
_P1_2	=	0x0092
_P1_3	=	0x0093
_P1_4	=	0x0094
_P1_5	=	0x0095
_P1_6	=	0x0096
_P1_7	=	0x0097
_RI	=	0x0098
_TI	=	0x0099
_RB8	=	0x009a
_TB8	=	0x009b
_REN	=	0x009c
_SM2	=	0x009d
_SM1	=	0x009e
_SM0	=	0x009f
_P2_0	=	0x00a0
_P2_1	=	0x00a1
_P2_2	=	0x00a2
_P2_3	=	0x00a3
_P2_4	=	0x00a4
_P2_5	=	0x00a5
_P2_6	=	0x00a6
_P2_7	=	0x00a7
_EX0	=	0x00a8
_ET0	=	0x00a9
_EX1	=	0x00aa
_ET1	=	0x00ab
_ES	=	0x00ac
_EA	=	0x00af
_P3_0	=	0x00b0
_P3_1	=	0x00b1
_P3_2	=	0x00b2
_P3_3	=	0x00b3
_P3_4	=	0x00b4
_P3_5	=	0x00b5
_P3_6	=	0x00b6
_P3_7	=	0x00b7
_RXD	=	0x00b0
_TXD	=	0x00b1
_INT0	=	0x00b2
_INT1	=	0x00b3
_T0	=	0x00b4
_T1	=	0x00b5
_WR	=	0x00b6
_RD	=	0x00b7
_PX0	=	0x00b8
_PT0	=	0x00b9
_PX1	=	0x00ba
_PT1	=	0x00bb
_PS	=	0x00bc
_P	=	0x00d0
_F1	=	0x00d1
_OV	=	0x00d2
_RS0	=	0x00d3
_RS1	=	0x00d4
_F0	=	0x00d5
_AC	=	0x00d6
_CY	=	0x00d7
_P4_0	=	0x00c0
_P4_1	=	0x00c1
_P4_2	=	0x00c2
_P4_3	=	0x00c3
;--------------------------------------------------------
; overlayable register banks
;--------------------------------------------------------
	.area REG_BANK_0	(REL,OVR,DATA)
	.ds 8
;--------------------------------------------------------
; internal ram data
;--------------------------------------------------------
	.area DSEG    (DATA)
_pwmCnt::
	.ds 1
_duty::
	.ds 1
_dir::
	.ds 1
;--------------------------------------------------------
; overlayable items in internal ram
;--------------------------------------------------------
;--------------------------------------------------------
; Stack segment in internal ram
;--------------------------------------------------------
	.area SSEG
__start__stack:
	.ds	1

;--------------------------------------------------------
; indirectly addressable internal ram data
;--------------------------------------------------------
	.area ISEG    (DATA)
;--------------------------------------------------------
; absolute internal ram data
;--------------------------------------------------------
	.area IABS    (ABS,DATA)
	.area IABS    (ABS,DATA)
;--------------------------------------------------------
; bit data
;--------------------------------------------------------
	.area BSEG    (BIT)
;--------------------------------------------------------
; paged external ram data
;--------------------------------------------------------
	.area PSEG    (PAG,XDATA)
;--------------------------------------------------------
; uninitialized external ram data
;--------------------------------------------------------
	.area XSEG    (XDATA)
;--------------------------------------------------------
; absolute external ram data
;--------------------------------------------------------
	.area XABS    (ABS,XDATA)
;--------------------------------------------------------
; initialized external ram data
;--------------------------------------------------------
	.area XISEG   (XDATA)
	.area HOME    (CODE)
	.area GSINIT0 (CODE)
	.area GSINIT1 (CODE)
	.area GSINIT2 (CODE)
	.area GSINIT3 (CODE)
	.area GSINIT4 (CODE)
	.area GSINIT5 (CODE)
	.area GSINIT  (CODE)
	.area GSFINAL (CODE)
	.area CSEG    (CODE)
;--------------------------------------------------------
; interrupt vector
;--------------------------------------------------------
	.area HOME    (CODE)
__interrupt_vect:
	ljmp	__sdcc_gsinit_startup
	reti
	.ds	7
	ljmp	_T0_isr
; restartable atomic support routines
	.ds	2
sdcc_atomic_exchange_rollback_start::
	nop
	nop
sdcc_atomic_exchange_pdata_impl:
	movx	a, @r0
	mov	r3, a
	mov	a, r2
	movx	@r0, a
	sjmp	sdcc_atomic_exchange_exit
	nop
	nop
sdcc_atomic_exchange_xdata_impl:
	movx	a, @dptr
	mov	r3, a
	mov	a, r2
	movx	@dptr, a
	sjmp	sdcc_atomic_exchange_exit
sdcc_atomic_compare_exchange_idata_impl:
	mov	a, @r0
	cjne	a, ar2, .+#5
	mov	a, r3
	mov	@r0, a
	ret
	nop
sdcc_atomic_compare_exchange_pdata_impl:
	movx	a, @r0
	cjne	a, ar2, .+#5
	mov	a, r3
	movx	@r0, a
	ret
	nop
sdcc_atomic_compare_exchange_xdata_impl:
	movx	a, @dptr
	cjne	a, ar2, .+#5
	mov	a, r3
	movx	@dptr, a
	ret
sdcc_atomic_exchange_rollback_end::

sdcc_atomic_exchange_gptr_impl::
	jnb	b.6, sdcc_atomic_exchange_xdata_impl
	mov	r0, dpl
	jb	b.5, sdcc_atomic_exchange_pdata_impl
sdcc_atomic_exchange_idata_impl:
	mov	a, r2
	xch	a, @r0
	mov	dpl, a
	ret
sdcc_atomic_exchange_exit:
	mov	dpl, r3
	ret
sdcc_atomic_compare_exchange_gptr_impl::
	jnb	b.6, sdcc_atomic_compare_exchange_xdata_impl
	mov	r0, dpl
	jb	b.5, sdcc_atomic_compare_exchange_pdata_impl
	sjmp	sdcc_atomic_compare_exchange_idata_impl
;--------------------------------------------------------
; global & static initialisations
;--------------------------------------------------------
	.area HOME    (CODE)
	.area GSINIT  (CODE)
	.area GSFINAL (CODE)
	.area GSINIT  (CODE)
	.globl __sdcc_gsinit_startup
	.globl __sdcc_program_startup
	.globl __start__stack
	.globl __mcs51_genXINIT
	.globl __mcs51_genXRAMCLEAR
	.globl __mcs51_genRAMCLEAR
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:11: volatile unsigned char pwmCnt = 0;
	mov	_pwmCnt,#0x00
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:12: volatile unsigned char duty    = 10;      /* 0~99，占空比百分比 */
	mov	_duty,#0x0a
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:13: volatile signed   char  dir    = 1;
	mov	_dir,#0x01
	.area GSFINAL (CODE)
	ljmp	__sdcc_program_startup
;--------------------------------------------------------
; Home
;--------------------------------------------------------
	.area HOME    (CODE)
	.area HOME    (CODE)
__sdcc_program_startup:
	lcall	_main
__sdcc_program_exit:
	sjmp	.
;	return from main will return to caller
;--------------------------------------------------------
; code
;--------------------------------------------------------
	.area CSEG    (CODE)
;------------------------------------------------------------
;Allocation info for local variables in function 'delay_ms'
;------------------------------------------------------------
;ms            Allocated to registers r6 r7 
;i             Allocated to registers r4 r5 
;j             Allocated to registers r3 
;------------------------------------------------------------
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:5: void delay_ms(unsigned int ms){
;	-----------------------------------------
;	 function delay_ms
;	-----------------------------------------
_delay_ms:
	ar7 = 0x07
	ar6 = 0x06
	ar5 = 0x05
	ar4 = 0x04
	ar3 = 0x03
	ar2 = 0x02
	ar1 = 0x01
	ar0 = 0x00
	mov	r6, dpl
	mov	r7, dph
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:7: for(i = 0; i < ms; i++)
	mov	r4,#0x00
	mov	r5,#0x00
00107$:
	clr	c
	mov	a,r4
	subb	a,r6
	mov	a,r5
	subb	a,r7
	jnc	00109$
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:8: for(j = 0; j < 120; j++);
	mov	r3,#0x78
00105$:
	djnz	r3,00105$
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:7: for(i = 0; i < ms; i++)
	inc	r4
	cjne	r4,#0x00,00107$
	inc	r5
	sjmp	00107$
00109$:
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:9: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'T0_isr'
;------------------------------------------------------------
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:16: void T0_isr(void) __interrupt(1){
;	-----------------------------------------
;	 function T0_isr
;	-----------------------------------------
_T0_isr:
	push	acc
	push	ar7
	push	psw
	mov	psw,#0x00
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:17: TH0 = 0xFF; TL0 = 0xA4;
	mov	_TH0,#0xff
	mov	_TL0,#0xa4
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:18: pwmCnt++;
	mov	a,_pwmCnt
	inc	a
	mov	_pwmCnt,a
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:19: if(pwmCnt >= 100){                       /* 10ms 一个 PWM 周期 → 100Hz */
	mov	a,#0x100 - 0x64
	add	a,_pwmCnt
	jnc	00107$
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:20: pwmCnt = 0;
	mov	_pwmCnt,#0x00
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:21: duty += dir;
	mov	r7,_duty
	mov	a,_dir
	add	a, r7
	mov	_duty,a
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:22: if(duty >= 95) dir = -1;
	mov	a,#0x100 - 0x5f
	add	a,_duty
	jnc	00102$
	mov	_dir,#0xff
00102$:
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:23: if(duty <= 5)  dir = 1;
	mov	a,_duty
	add	a,#0xff - 0x05
	jc	00107$
;	free result
	mov	_dir,#0x01
00107$:
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:25: }
	pop	psw
	pop	ar7
	pop	acc
	reti
;	eliminated unneeded push/pop dpl
;	eliminated unneeded push/pop dph
;	eliminated unneeded push/pop b
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:27: void main(void){
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:28: TMOD = 0x01;
	mov	_TMOD,#0x01
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:29: TH0 = 0xFF; TL0 = 0xA4;
	mov	_TH0,#0xff
	mov	_TL0,#0xa4
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:30: EA = 1; ET0 = 1; TR0 = 1;
;	assignBit
	setb	_EA
;	assignBit
	setb	_ET0
;	assignBit
	setb	_TR0
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:31: while(1){
00102$:
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:33: P1 = (pwmCnt < duty) ? 0x00 : 0xFF;
	clr	c
	mov	a,_pwmCnt
	subb	a,_duty
	jnc	00106$
	mov	r7,#0x00
	sjmp	00107$
00106$:
	mov	r7,#0xff
00107$:
	mov	_P1,r7
;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:35: }
	sjmp	00102$
	.area CSEG    (CODE)
	.area CONST   (CODE)
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
