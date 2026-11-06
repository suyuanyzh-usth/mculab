                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ISO C Compiler
                                      3 ; Version 4.6.0 #16555 (MINGW64)
                                      4 ;--------------------------------------------------------
                                      5 	.module pwm_led
                                      6 	
                                      7 	.optsdcc -mmcs51 --model-small
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _main
                                     12 	.globl _T0_isr
                                     13 	.globl _delay_ms
                                     14 	.globl _P4_3
                                     15 	.globl _P4_2
                                     16 	.globl _P4_1
                                     17 	.globl _P4_0
                                     18 	.globl _CY
                                     19 	.globl _AC
                                     20 	.globl _F0
                                     21 	.globl _RS1
                                     22 	.globl _RS0
                                     23 	.globl _OV
                                     24 	.globl _F1
                                     25 	.globl _P
                                     26 	.globl _PS
                                     27 	.globl _PT1
                                     28 	.globl _PX1
                                     29 	.globl _PT0
                                     30 	.globl _PX0
                                     31 	.globl _RD
                                     32 	.globl _WR
                                     33 	.globl _T1
                                     34 	.globl _T0
                                     35 	.globl _INT1
                                     36 	.globl _INT0
                                     37 	.globl _TXD
                                     38 	.globl _RXD
                                     39 	.globl _P3_7
                                     40 	.globl _P3_6
                                     41 	.globl _P3_5
                                     42 	.globl _P3_4
                                     43 	.globl _P3_3
                                     44 	.globl _P3_2
                                     45 	.globl _P3_1
                                     46 	.globl _P3_0
                                     47 	.globl _EA
                                     48 	.globl _ES
                                     49 	.globl _ET1
                                     50 	.globl _EX1
                                     51 	.globl _ET0
                                     52 	.globl _EX0
                                     53 	.globl _P2_7
                                     54 	.globl _P2_6
                                     55 	.globl _P2_5
                                     56 	.globl _P2_4
                                     57 	.globl _P2_3
                                     58 	.globl _P2_2
                                     59 	.globl _P2_1
                                     60 	.globl _P2_0
                                     61 	.globl _SM0
                                     62 	.globl _SM1
                                     63 	.globl _SM2
                                     64 	.globl _REN
                                     65 	.globl _TB8
                                     66 	.globl _RB8
                                     67 	.globl _TI
                                     68 	.globl _RI
                                     69 	.globl _P1_7
                                     70 	.globl _P1_6
                                     71 	.globl _P1_5
                                     72 	.globl _P1_4
                                     73 	.globl _P1_3
                                     74 	.globl _P1_2
                                     75 	.globl _P1_1
                                     76 	.globl _P1_0
                                     77 	.globl _TF1
                                     78 	.globl _TR1
                                     79 	.globl _TF0
                                     80 	.globl _TR0
                                     81 	.globl _IE1
                                     82 	.globl _IT1
                                     83 	.globl _IE0
                                     84 	.globl _IT0
                                     85 	.globl _P0_7
                                     86 	.globl _P0_6
                                     87 	.globl _P0_5
                                     88 	.globl _P0_4
                                     89 	.globl _P0_3
                                     90 	.globl _P0_2
                                     91 	.globl _P0_1
                                     92 	.globl _P0_0
                                     93 	.globl _P4
                                     94 	.globl _IAP_CONTR
                                     95 	.globl _IAP_TRIG
                                     96 	.globl _IAP_CMD
                                     97 	.globl _IAP_ADDRL
                                     98 	.globl _IAP_ADDRH
                                     99 	.globl _IAP_DATA
                                    100 	.globl _WDT_CONTR
                                    101 	.globl _TH2
                                    102 	.globl _TL2
                                    103 	.globl _RCAP2H
                                    104 	.globl _RCAP2L
                                    105 	.globl _T2MOD
                                    106 	.globl _T2CON
                                    107 	.globl _XICON
                                    108 	.globl _SADEN
                                    109 	.globl _IPH
                                    110 	.globl _SADDR
                                    111 	.globl _AUXR1
                                    112 	.globl _AUXR
                                    113 	.globl _B
                                    114 	.globl _ACC
                                    115 	.globl _PSW
                                    116 	.globl _IP
                                    117 	.globl _P3
                                    118 	.globl _IE
                                    119 	.globl _P2
                                    120 	.globl _SBUF
                                    121 	.globl _SCON
                                    122 	.globl _P1
                                    123 	.globl _TH1
                                    124 	.globl _TH0
                                    125 	.globl _TL1
                                    126 	.globl _TL0
                                    127 	.globl _TMOD
                                    128 	.globl _TCON
                                    129 	.globl _PCON
                                    130 	.globl _DPH
                                    131 	.globl _DPL
                                    132 	.globl _SP
                                    133 	.globl _P0
                                    134 	.globl _dir
                                    135 	.globl _duty
                                    136 	.globl _pwmCnt
                                    137 ;--------------------------------------------------------
                                    138 ; special function registers
                                    139 ;--------------------------------------------------------
                                    140 	.area RSEG    (ABS,DATA)
      000000                        141 	.org 0x0000
                           000080   142 _P0	=	0x0080
                           000081   143 _SP	=	0x0081
                           000082   144 _DPL	=	0x0082
                           000083   145 _DPH	=	0x0083
                           000087   146 _PCON	=	0x0087
                           000088   147 _TCON	=	0x0088
                           000089   148 _TMOD	=	0x0089
                           00008A   149 _TL0	=	0x008a
                           00008B   150 _TL1	=	0x008b
                           00008C   151 _TH0	=	0x008c
                           00008D   152 _TH1	=	0x008d
                           000090   153 _P1	=	0x0090
                           000098   154 _SCON	=	0x0098
                           000099   155 _SBUF	=	0x0099
                           0000A0   156 _P2	=	0x00a0
                           0000A8   157 _IE	=	0x00a8
                           0000B0   158 _P3	=	0x00b0
                           0000B8   159 _IP	=	0x00b8
                           0000D0   160 _PSW	=	0x00d0
                           0000E0   161 _ACC	=	0x00e0
                           0000F0   162 _B	=	0x00f0
                           00008E   163 _AUXR	=	0x008e
                           0000A2   164 _AUXR1	=	0x00a2
                           0000A9   165 _SADDR	=	0x00a9
                           0000B7   166 _IPH	=	0x00b7
                           0000B9   167 _SADEN	=	0x00b9
                           0000C0   168 _XICON	=	0x00c0
                           0000C8   169 _T2CON	=	0x00c8
                           0000C9   170 _T2MOD	=	0x00c9
                           0000CA   171 _RCAP2L	=	0x00ca
                           0000CB   172 _RCAP2H	=	0x00cb
                           0000CC   173 _TL2	=	0x00cc
                           0000CD   174 _TH2	=	0x00cd
                           0000E1   175 _WDT_CONTR	=	0x00e1
                           0000E2   176 _IAP_DATA	=	0x00e2
                           0000E3   177 _IAP_ADDRH	=	0x00e3
                           0000E4   178 _IAP_ADDRL	=	0x00e4
                           0000E5   179 _IAP_CMD	=	0x00e5
                           0000E6   180 _IAP_TRIG	=	0x00e6
                           0000E7   181 _IAP_CONTR	=	0x00e7
                           0000E8   182 _P4	=	0x00e8
                                    183 ;--------------------------------------------------------
                                    184 ; special function bits
                                    185 ;--------------------------------------------------------
                                    186 	.area RSEG    (ABS,DATA)
      000000                        187 	.org 0x0000
                           000080   188 _P0_0	=	0x0080
                           000081   189 _P0_1	=	0x0081
                           000082   190 _P0_2	=	0x0082
                           000083   191 _P0_3	=	0x0083
                           000084   192 _P0_4	=	0x0084
                           000085   193 _P0_5	=	0x0085
                           000086   194 _P0_6	=	0x0086
                           000087   195 _P0_7	=	0x0087
                           000088   196 _IT0	=	0x0088
                           000089   197 _IE0	=	0x0089
                           00008A   198 _IT1	=	0x008a
                           00008B   199 _IE1	=	0x008b
                           00008C   200 _TR0	=	0x008c
                           00008D   201 _TF0	=	0x008d
                           00008E   202 _TR1	=	0x008e
                           00008F   203 _TF1	=	0x008f
                           000090   204 _P1_0	=	0x0090
                           000091   205 _P1_1	=	0x0091
                           000092   206 _P1_2	=	0x0092
                           000093   207 _P1_3	=	0x0093
                           000094   208 _P1_4	=	0x0094
                           000095   209 _P1_5	=	0x0095
                           000096   210 _P1_6	=	0x0096
                           000097   211 _P1_7	=	0x0097
                           000098   212 _RI	=	0x0098
                           000099   213 _TI	=	0x0099
                           00009A   214 _RB8	=	0x009a
                           00009B   215 _TB8	=	0x009b
                           00009C   216 _REN	=	0x009c
                           00009D   217 _SM2	=	0x009d
                           00009E   218 _SM1	=	0x009e
                           00009F   219 _SM0	=	0x009f
                           0000A0   220 _P2_0	=	0x00a0
                           0000A1   221 _P2_1	=	0x00a1
                           0000A2   222 _P2_2	=	0x00a2
                           0000A3   223 _P2_3	=	0x00a3
                           0000A4   224 _P2_4	=	0x00a4
                           0000A5   225 _P2_5	=	0x00a5
                           0000A6   226 _P2_6	=	0x00a6
                           0000A7   227 _P2_7	=	0x00a7
                           0000A8   228 _EX0	=	0x00a8
                           0000A9   229 _ET0	=	0x00a9
                           0000AA   230 _EX1	=	0x00aa
                           0000AB   231 _ET1	=	0x00ab
                           0000AC   232 _ES	=	0x00ac
                           0000AF   233 _EA	=	0x00af
                           0000B0   234 _P3_0	=	0x00b0
                           0000B1   235 _P3_1	=	0x00b1
                           0000B2   236 _P3_2	=	0x00b2
                           0000B3   237 _P3_3	=	0x00b3
                           0000B4   238 _P3_4	=	0x00b4
                           0000B5   239 _P3_5	=	0x00b5
                           0000B6   240 _P3_6	=	0x00b6
                           0000B7   241 _P3_7	=	0x00b7
                           0000B0   242 _RXD	=	0x00b0
                           0000B1   243 _TXD	=	0x00b1
                           0000B2   244 _INT0	=	0x00b2
                           0000B3   245 _INT1	=	0x00b3
                           0000B4   246 _T0	=	0x00b4
                           0000B5   247 _T1	=	0x00b5
                           0000B6   248 _WR	=	0x00b6
                           0000B7   249 _RD	=	0x00b7
                           0000B8   250 _PX0	=	0x00b8
                           0000B9   251 _PT0	=	0x00b9
                           0000BA   252 _PX1	=	0x00ba
                           0000BB   253 _PT1	=	0x00bb
                           0000BC   254 _PS	=	0x00bc
                           0000D0   255 _P	=	0x00d0
                           0000D1   256 _F1	=	0x00d1
                           0000D2   257 _OV	=	0x00d2
                           0000D3   258 _RS0	=	0x00d3
                           0000D4   259 _RS1	=	0x00d4
                           0000D5   260 _F0	=	0x00d5
                           0000D6   261 _AC	=	0x00d6
                           0000D7   262 _CY	=	0x00d7
                           0000C0   263 _P4_0	=	0x00c0
                           0000C1   264 _P4_1	=	0x00c1
                           0000C2   265 _P4_2	=	0x00c2
                           0000C3   266 _P4_3	=	0x00c3
                                    267 ;--------------------------------------------------------
                                    268 ; overlayable register banks
                                    269 ;--------------------------------------------------------
                                    270 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        271 	.ds 8
                                    272 ;--------------------------------------------------------
                                    273 ; internal ram data
                                    274 ;--------------------------------------------------------
                                    275 	.area DSEG    (DATA)
      000008                        276 _pwmCnt::
      000008                        277 	.ds 1
      000009                        278 _duty::
      000009                        279 	.ds 1
      00000A                        280 _dir::
      00000A                        281 	.ds 1
                                    282 ;--------------------------------------------------------
                                    283 ; overlayable items in internal ram
                                    284 ;--------------------------------------------------------
                                    285 ;--------------------------------------------------------
                                    286 ; Stack segment in internal ram
                                    287 ;--------------------------------------------------------
                                    288 	.area SSEG
      00000B                        289 __start__stack:
      00000B                        290 	.ds	1
                                    291 
                                    292 ;--------------------------------------------------------
                                    293 ; indirectly addressable internal ram data
                                    294 ;--------------------------------------------------------
                                    295 	.area ISEG    (DATA)
                                    296 ;--------------------------------------------------------
                                    297 ; absolute internal ram data
                                    298 ;--------------------------------------------------------
                                    299 	.area IABS    (ABS,DATA)
                                    300 	.area IABS    (ABS,DATA)
                                    301 ;--------------------------------------------------------
                                    302 ; bit data
                                    303 ;--------------------------------------------------------
                                    304 	.area BSEG    (BIT)
                                    305 ;--------------------------------------------------------
                                    306 ; paged external ram data
                                    307 ;--------------------------------------------------------
                                    308 	.area PSEG    (PAG,XDATA)
                                    309 ;--------------------------------------------------------
                                    310 ; uninitialized external ram data
                                    311 ;--------------------------------------------------------
                                    312 	.area XSEG    (XDATA)
                                    313 ;--------------------------------------------------------
                                    314 ; absolute external ram data
                                    315 ;--------------------------------------------------------
                                    316 	.area XABS    (ABS,XDATA)
                                    317 ;--------------------------------------------------------
                                    318 ; initialized external ram data
                                    319 ;--------------------------------------------------------
                                    320 	.area XISEG   (XDATA)
                                    321 	.area HOME    (CODE)
                                    322 	.area GSINIT0 (CODE)
                                    323 	.area GSINIT1 (CODE)
                                    324 	.area GSINIT2 (CODE)
                                    325 	.area GSINIT3 (CODE)
                                    326 	.area GSINIT4 (CODE)
                                    327 	.area GSINIT5 (CODE)
                                    328 	.area GSINIT  (CODE)
                                    329 	.area GSFINAL (CODE)
                                    330 	.area CSEG    (CODE)
                                    331 ;--------------------------------------------------------
                                    332 ; interrupt vector
                                    333 ;--------------------------------------------------------
                                    334 	.area HOME    (CODE)
      000000                        335 __interrupt_vect:
      000000 02 00 56         [24]  336 	ljmp	__sdcc_gsinit_startup
      000003 32               [24]  337 	reti
      000004                        338 	.ds	7
      00000B 02 00 D6         [24]  339 	ljmp	_T0_isr
                                    340 ; restartable atomic support routines
      00000E                        341 	.ds	2
      000010                        342 sdcc_atomic_exchange_rollback_start::
      000010 00               [12]  343 	nop
      000011 00               [12]  344 	nop
      000012                        345 sdcc_atomic_exchange_pdata_impl:
      000012 E2               [24]  346 	movx	a, @r0
      000013 FB               [12]  347 	mov	r3, a
      000014 EA               [12]  348 	mov	a, r2
      000015 F2               [24]  349 	movx	@r0, a
      000016 80 2C            [24]  350 	sjmp	sdcc_atomic_exchange_exit
      000018 00               [12]  351 	nop
      000019 00               [12]  352 	nop
      00001A                        353 sdcc_atomic_exchange_xdata_impl:
      00001A E0               [24]  354 	movx	a, @dptr
      00001B FB               [12]  355 	mov	r3, a
      00001C EA               [12]  356 	mov	a, r2
      00001D F0               [24]  357 	movx	@dptr, a
      00001E 80 24            [24]  358 	sjmp	sdcc_atomic_exchange_exit
      000020                        359 sdcc_atomic_compare_exchange_idata_impl:
      000020 E6               [12]  360 	mov	a, @r0
      000021 B5 02 02         [24]  361 	cjne	a, ar2, .+#5
      000024 EB               [12]  362 	mov	a, r3
      000025 F6               [12]  363 	mov	@r0, a
      000026 22               [24]  364 	ret
      000027 00               [12]  365 	nop
      000028                        366 sdcc_atomic_compare_exchange_pdata_impl:
      000028 E2               [24]  367 	movx	a, @r0
      000029 B5 02 02         [24]  368 	cjne	a, ar2, .+#5
      00002C EB               [12]  369 	mov	a, r3
      00002D F2               [24]  370 	movx	@r0, a
      00002E 22               [24]  371 	ret
      00002F 00               [12]  372 	nop
      000030                        373 sdcc_atomic_compare_exchange_xdata_impl:
      000030 E0               [24]  374 	movx	a, @dptr
      000031 B5 02 02         [24]  375 	cjne	a, ar2, .+#5
      000034 EB               [12]  376 	mov	a, r3
      000035 F0               [24]  377 	movx	@dptr, a
      000036 22               [24]  378 	ret
      000037                        379 sdcc_atomic_exchange_rollback_end::
                                    380 
      000037                        381 sdcc_atomic_exchange_gptr_impl::
      000037 30 F6 E0         [24]  382 	jnb	b.6, sdcc_atomic_exchange_xdata_impl
      00003A A8 82            [24]  383 	mov	r0, dpl
      00003C 20 F5 D3         [24]  384 	jb	b.5, sdcc_atomic_exchange_pdata_impl
      00003F                        385 sdcc_atomic_exchange_idata_impl:
      00003F EA               [12]  386 	mov	a, r2
      000040 C6               [12]  387 	xch	a, @r0
      000041 F5 82            [12]  388 	mov	dpl, a
      000043 22               [24]  389 	ret
      000044                        390 sdcc_atomic_exchange_exit:
      000044 8B 82            [24]  391 	mov	dpl, r3
      000046 22               [24]  392 	ret
      000047                        393 sdcc_atomic_compare_exchange_gptr_impl::
      000047 30 F6 E6         [24]  394 	jnb	b.6, sdcc_atomic_compare_exchange_xdata_impl
      00004A A8 82            [24]  395 	mov	r0, dpl
      00004C 20 F5 D9         [24]  396 	jb	b.5, sdcc_atomic_compare_exchange_pdata_impl
      00004F 80 CF            [24]  397 	sjmp	sdcc_atomic_compare_exchange_idata_impl
                                    398 ;--------------------------------------------------------
                                    399 ; global & static initialisations
                                    400 ;--------------------------------------------------------
                                    401 	.area HOME    (CODE)
                                    402 	.area GSINIT  (CODE)
                                    403 	.area GSFINAL (CODE)
                                    404 	.area GSINIT  (CODE)
                                    405 	.globl __sdcc_gsinit_startup
                                    406 	.globl __sdcc_program_startup
                                    407 	.globl __start__stack
                                    408 	.globl __mcs51_genXINIT
                                    409 	.globl __mcs51_genXRAMCLEAR
                                    410 	.globl __mcs51_genRAMCLEAR
                                    411 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:11: volatile unsigned char pwmCnt = 0;
      0000AF 75 08 00         [24]  412 	mov	_pwmCnt,#0x00
                                    413 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:12: volatile unsigned char duty    = 10;      /* 0~99，占空比百分比 */
      0000B2 75 09 0A         [24]  414 	mov	_duty,#0x0a
                                    415 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:13: volatile signed   char  dir    = 1;
      0000B5 75 0A 01         [24]  416 	mov	_dir,#0x01
                                    417 	.area GSFINAL (CODE)
      0000B8 02 00 51         [24]  418 	ljmp	__sdcc_program_startup
                                    419 ;--------------------------------------------------------
                                    420 ; Home
                                    421 ;--------------------------------------------------------
                                    422 	.area HOME    (CODE)
                                    423 	.area HOME    (CODE)
      000051                        424 __sdcc_program_startup:
      000051 12 01 13         [24]  425 	lcall	_main
      000054                        426 __sdcc_program_exit:
      000054 80 FE            [24]  427 	sjmp	.
                                    428 ;	return from main will return to caller
                                    429 ;--------------------------------------------------------
                                    430 ; code
                                    431 ;--------------------------------------------------------
                                    432 	.area CSEG    (CODE)
                                    433 ;------------------------------------------------------------
                                    434 ;Allocation info for local variables in function 'delay_ms'
                                    435 ;------------------------------------------------------------
                                    436 ;ms            Allocated to registers r6 r7 
                                    437 ;i             Allocated to registers r4 r5 
                                    438 ;j             Allocated to registers r3 
                                    439 ;------------------------------------------------------------
                                    440 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:5: void delay_ms(unsigned int ms){
                                    441 ;	-----------------------------------------
                                    442 ;	 function delay_ms
                                    443 ;	-----------------------------------------
      0000BB                        444 _delay_ms:
                           000007   445 	ar7 = 0x07
                           000006   446 	ar6 = 0x06
                           000005   447 	ar5 = 0x05
                           000004   448 	ar4 = 0x04
                           000003   449 	ar3 = 0x03
                           000002   450 	ar2 = 0x02
                           000001   451 	ar1 = 0x01
                           000000   452 	ar0 = 0x00
      0000BB AE 82            [24]  453 	mov	r6, dpl
      0000BD AF 83            [24]  454 	mov	r7, dph
                                    455 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:7: for(i = 0; i < ms; i++)
      0000BF 7C 00            [12]  456 	mov	r4,#0x00
      0000C1 7D 00            [12]  457 	mov	r5,#0x00
      0000C3                        458 00107$:
      0000C3 C3               [12]  459 	clr	c
      0000C4 EC               [12]  460 	mov	a,r4
      0000C5 9E               [12]  461 	subb	a,r6
      0000C6 ED               [12]  462 	mov	a,r5
      0000C7 9F               [12]  463 	subb	a,r7
      0000C8 50 0B            [24]  464 	jnc	00109$
                                    465 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:8: for(j = 0; j < 120; j++);
      0000CA 7B 78            [12]  466 	mov	r3,#0x78
      0000CC                        467 00105$:
      0000CC DB FE            [24]  468 	djnz	r3,00105$
                                    469 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:7: for(i = 0; i < ms; i++)
      0000CE 0C               [12]  470 	inc	r4
      0000CF BC 00 F1         [24]  471 	cjne	r4,#0x00,00107$
      0000D2 0D               [12]  472 	inc	r5
      0000D3 80 EE            [24]  473 	sjmp	00107$
      0000D5                        474 00109$:
                                    475 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:9: }
      0000D5 22               [24]  476 	ret
                                    477 ;------------------------------------------------------------
                                    478 ;Allocation info for local variables in function 'T0_isr'
                                    479 ;------------------------------------------------------------
                                    480 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:16: void T0_isr(void) __interrupt(1){
                                    481 ;	-----------------------------------------
                                    482 ;	 function T0_isr
                                    483 ;	-----------------------------------------
      0000D6                        484 _T0_isr:
      0000D6 C0 E0            [24]  485 	push	acc
      0000D8 C0 07            [24]  486 	push	ar7
      0000DA C0 D0            [24]  487 	push	psw
      0000DC 75 D0 00         [24]  488 	mov	psw,#0x00
                                    489 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:17: TH0 = 0xFF; TL0 = 0xA4;
      0000DF 75 8C FF         [24]  490 	mov	_TH0,#0xff
      0000E2 75 8A A4         [24]  491 	mov	_TL0,#0xa4
                                    492 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:18: pwmCnt++;
      0000E5 E5 08            [12]  493 	mov	a,_pwmCnt
      0000E7 04               [12]  494 	inc	a
      0000E8 F5 08            [12]  495 	mov	_pwmCnt,a
                                    496 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:19: if(pwmCnt >= 100){                       /* 10ms 一个 PWM 周期 → 100Hz */
      0000EA 74 9C            [12]  497 	mov	a,#0x100 - 0x64
      0000EC 25 08            [12]  498 	add	a,_pwmCnt
      0000EE 50 1C            [24]  499 	jnc	00107$
                                    500 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:20: pwmCnt = 0;
      0000F0 75 08 00         [24]  501 	mov	_pwmCnt,#0x00
                                    502 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:21: duty += dir;
      0000F3 AF 09            [24]  503 	mov	r7,_duty
      0000F5 E5 0A            [12]  504 	mov	a,_dir
      0000F7 2F               [12]  505 	add	a, r7
      0000F8 F5 09            [12]  506 	mov	_duty,a
                                    507 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:22: if(duty >= 95) dir = -1;
      0000FA 74 A1            [12]  508 	mov	a,#0x100 - 0x5f
      0000FC 25 09            [12]  509 	add	a,_duty
      0000FE 50 03            [24]  510 	jnc	00102$
      000100 75 0A FF         [24]  511 	mov	_dir,#0xff
      000103                        512 00102$:
                                    513 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:23: if(duty <= 5)  dir = 1;
      000103 E5 09            [12]  514 	mov	a,_duty
      000105 24 FA            [12]  515 	add	a,#0xff - 0x05
      000107 40 03            [24]  516 	jc	00107$
                                    517 ;	free result
      000109 75 0A 01         [24]  518 	mov	_dir,#0x01
      00010C                        519 00107$:
                                    520 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:25: }
      00010C D0 D0            [24]  521 	pop	psw
      00010E D0 07            [24]  522 	pop	ar7
      000110 D0 E0            [24]  523 	pop	acc
      000112 32               [24]  524 	reti
                                    525 ;	eliminated unneeded push/pop dpl
                                    526 ;	eliminated unneeded push/pop dph
                                    527 ;	eliminated unneeded push/pop b
                                    528 ;------------------------------------------------------------
                                    529 ;Allocation info for local variables in function 'main'
                                    530 ;------------------------------------------------------------
                                    531 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:27: void main(void){
                                    532 ;	-----------------------------------------
                                    533 ;	 function main
                                    534 ;	-----------------------------------------
      000113                        535 _main:
                                    536 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:28: TMOD = 0x01;
      000113 75 89 01         [24]  537 	mov	_TMOD,#0x01
                                    538 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:29: TH0 = 0xFF; TL0 = 0xA4;
      000116 75 8C FF         [24]  539 	mov	_TH0,#0xff
      000119 75 8A A4         [24]  540 	mov	_TL0,#0xa4
                                    541 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:30: EA = 1; ET0 = 1; TR0 = 1;
                                    542 ;	assignBit
      00011C D2 AF            [12]  543 	setb	_EA
                                    544 ;	assignBit
      00011E D2 A9            [12]  545 	setb	_ET0
                                    546 ;	assignBit
      000120 D2 8C            [12]  547 	setb	_TR0
                                    548 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:31: while(1){
      000122                        549 00102$:
                                    550 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:33: P1 = (pwmCnt < duty) ? 0x00 : 0xFF;
      000122 C3               [12]  551 	clr	c
      000123 E5 08            [12]  552 	mov	a,_pwmCnt
      000125 95 09            [12]  553 	subb	a,_duty
      000127 50 04            [24]  554 	jnc	00106$
      000129 7F 00            [12]  555 	mov	r7,#0x00
      00012B 80 02            [24]  556 	sjmp	00107$
      00012D                        557 00106$:
      00012D 7F FF            [12]  558 	mov	r7,#0xff
      00012F                        559 00107$:
      00012F 8F 90            [24]  560 	mov	_P1,r7
                                    561 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/pwm_led.c:35: }
      000131 80 EF            [24]  562 	sjmp	00102$
                                    563 	.area CSEG    (CODE)
                                    564 	.area CONST   (CODE)
                                    565 	.area XINIT   (CODE)
                                    566 	.area CABS    (ABS,CODE)
