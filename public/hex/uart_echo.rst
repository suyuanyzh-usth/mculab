                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ISO C Compiler
                                      3 ; Version 4.6.0 #16555 (MINGW64)
                                      4 ;--------------------------------------------------------
                                      5 	.module uart_echo
                                      6 	
                                      7 	.optsdcc -mmcs51 --model-small
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _main
                                     12 	.globl _uartSend
                                     13 	.globl _uartInit
                                     14 	.globl _delay_ms
                                     15 	.globl _P4_3
                                     16 	.globl _P4_2
                                     17 	.globl _P4_1
                                     18 	.globl _P4_0
                                     19 	.globl _CY
                                     20 	.globl _AC
                                     21 	.globl _F0
                                     22 	.globl _RS1
                                     23 	.globl _RS0
                                     24 	.globl _OV
                                     25 	.globl _F1
                                     26 	.globl _P
                                     27 	.globl _PS
                                     28 	.globl _PT1
                                     29 	.globl _PX1
                                     30 	.globl _PT0
                                     31 	.globl _PX0
                                     32 	.globl _RD
                                     33 	.globl _WR
                                     34 	.globl _T1
                                     35 	.globl _T0
                                     36 	.globl _INT1
                                     37 	.globl _INT0
                                     38 	.globl _TXD
                                     39 	.globl _RXD
                                     40 	.globl _P3_7
                                     41 	.globl _P3_6
                                     42 	.globl _P3_5
                                     43 	.globl _P3_4
                                     44 	.globl _P3_3
                                     45 	.globl _P3_2
                                     46 	.globl _P3_1
                                     47 	.globl _P3_0
                                     48 	.globl _EA
                                     49 	.globl _ES
                                     50 	.globl _ET1
                                     51 	.globl _EX1
                                     52 	.globl _ET0
                                     53 	.globl _EX0
                                     54 	.globl _P2_7
                                     55 	.globl _P2_6
                                     56 	.globl _P2_5
                                     57 	.globl _P2_4
                                     58 	.globl _P2_3
                                     59 	.globl _P2_2
                                     60 	.globl _P2_1
                                     61 	.globl _P2_0
                                     62 	.globl _SM0
                                     63 	.globl _SM1
                                     64 	.globl _SM2
                                     65 	.globl _REN
                                     66 	.globl _TB8
                                     67 	.globl _RB8
                                     68 	.globl _TI
                                     69 	.globl _RI
                                     70 	.globl _P1_7
                                     71 	.globl _P1_6
                                     72 	.globl _P1_5
                                     73 	.globl _P1_4
                                     74 	.globl _P1_3
                                     75 	.globl _P1_2
                                     76 	.globl _P1_1
                                     77 	.globl _P1_0
                                     78 	.globl _TF1
                                     79 	.globl _TR1
                                     80 	.globl _TF0
                                     81 	.globl _TR0
                                     82 	.globl _IE1
                                     83 	.globl _IT1
                                     84 	.globl _IE0
                                     85 	.globl _IT0
                                     86 	.globl _P0_7
                                     87 	.globl _P0_6
                                     88 	.globl _P0_5
                                     89 	.globl _P0_4
                                     90 	.globl _P0_3
                                     91 	.globl _P0_2
                                     92 	.globl _P0_1
                                     93 	.globl _P0_0
                                     94 	.globl _P4
                                     95 	.globl _IAP_CONTR
                                     96 	.globl _IAP_TRIG
                                     97 	.globl _IAP_CMD
                                     98 	.globl _IAP_ADDRL
                                     99 	.globl _IAP_ADDRH
                                    100 	.globl _IAP_DATA
                                    101 	.globl _WDT_CONTR
                                    102 	.globl _TH2
                                    103 	.globl _TL2
                                    104 	.globl _RCAP2H
                                    105 	.globl _RCAP2L
                                    106 	.globl _T2MOD
                                    107 	.globl _T2CON
                                    108 	.globl _XICON
                                    109 	.globl _SADEN
                                    110 	.globl _IPH
                                    111 	.globl _SADDR
                                    112 	.globl _AUXR1
                                    113 	.globl _AUXR
                                    114 	.globl _B
                                    115 	.globl _ACC
                                    116 	.globl _PSW
                                    117 	.globl _IP
                                    118 	.globl _P3
                                    119 	.globl _IE
                                    120 	.globl _P2
                                    121 	.globl _SBUF
                                    122 	.globl _SCON
                                    123 	.globl _P1
                                    124 	.globl _TH1
                                    125 	.globl _TH0
                                    126 	.globl _TL1
                                    127 	.globl _TL0
                                    128 	.globl _TMOD
                                    129 	.globl _TCON
                                    130 	.globl _PCON
                                    131 	.globl _DPH
                                    132 	.globl _DPL
                                    133 	.globl _SP
                                    134 	.globl _P0
                                    135 ;--------------------------------------------------------
                                    136 ; special function registers
                                    137 ;--------------------------------------------------------
                                    138 	.area RSEG    (ABS,DATA)
      000000                        139 	.org 0x0000
                           000080   140 _P0	=	0x0080
                           000081   141 _SP	=	0x0081
                           000082   142 _DPL	=	0x0082
                           000083   143 _DPH	=	0x0083
                           000087   144 _PCON	=	0x0087
                           000088   145 _TCON	=	0x0088
                           000089   146 _TMOD	=	0x0089
                           00008A   147 _TL0	=	0x008a
                           00008B   148 _TL1	=	0x008b
                           00008C   149 _TH0	=	0x008c
                           00008D   150 _TH1	=	0x008d
                           000090   151 _P1	=	0x0090
                           000098   152 _SCON	=	0x0098
                           000099   153 _SBUF	=	0x0099
                           0000A0   154 _P2	=	0x00a0
                           0000A8   155 _IE	=	0x00a8
                           0000B0   156 _P3	=	0x00b0
                           0000B8   157 _IP	=	0x00b8
                           0000D0   158 _PSW	=	0x00d0
                           0000E0   159 _ACC	=	0x00e0
                           0000F0   160 _B	=	0x00f0
                           00008E   161 _AUXR	=	0x008e
                           0000A2   162 _AUXR1	=	0x00a2
                           0000A9   163 _SADDR	=	0x00a9
                           0000B7   164 _IPH	=	0x00b7
                           0000B9   165 _SADEN	=	0x00b9
                           0000C0   166 _XICON	=	0x00c0
                           0000C8   167 _T2CON	=	0x00c8
                           0000C9   168 _T2MOD	=	0x00c9
                           0000CA   169 _RCAP2L	=	0x00ca
                           0000CB   170 _RCAP2H	=	0x00cb
                           0000CC   171 _TL2	=	0x00cc
                           0000CD   172 _TH2	=	0x00cd
                           0000E1   173 _WDT_CONTR	=	0x00e1
                           0000E2   174 _IAP_DATA	=	0x00e2
                           0000E3   175 _IAP_ADDRH	=	0x00e3
                           0000E4   176 _IAP_ADDRL	=	0x00e4
                           0000E5   177 _IAP_CMD	=	0x00e5
                           0000E6   178 _IAP_TRIG	=	0x00e6
                           0000E7   179 _IAP_CONTR	=	0x00e7
                           0000E8   180 _P4	=	0x00e8
                                    181 ;--------------------------------------------------------
                                    182 ; special function bits
                                    183 ;--------------------------------------------------------
                                    184 	.area RSEG    (ABS,DATA)
      000000                        185 	.org 0x0000
                           000080   186 _P0_0	=	0x0080
                           000081   187 _P0_1	=	0x0081
                           000082   188 _P0_2	=	0x0082
                           000083   189 _P0_3	=	0x0083
                           000084   190 _P0_4	=	0x0084
                           000085   191 _P0_5	=	0x0085
                           000086   192 _P0_6	=	0x0086
                           000087   193 _P0_7	=	0x0087
                           000088   194 _IT0	=	0x0088
                           000089   195 _IE0	=	0x0089
                           00008A   196 _IT1	=	0x008a
                           00008B   197 _IE1	=	0x008b
                           00008C   198 _TR0	=	0x008c
                           00008D   199 _TF0	=	0x008d
                           00008E   200 _TR1	=	0x008e
                           00008F   201 _TF1	=	0x008f
                           000090   202 _P1_0	=	0x0090
                           000091   203 _P1_1	=	0x0091
                           000092   204 _P1_2	=	0x0092
                           000093   205 _P1_3	=	0x0093
                           000094   206 _P1_4	=	0x0094
                           000095   207 _P1_5	=	0x0095
                           000096   208 _P1_6	=	0x0096
                           000097   209 _P1_7	=	0x0097
                           000098   210 _RI	=	0x0098
                           000099   211 _TI	=	0x0099
                           00009A   212 _RB8	=	0x009a
                           00009B   213 _TB8	=	0x009b
                           00009C   214 _REN	=	0x009c
                           00009D   215 _SM2	=	0x009d
                           00009E   216 _SM1	=	0x009e
                           00009F   217 _SM0	=	0x009f
                           0000A0   218 _P2_0	=	0x00a0
                           0000A1   219 _P2_1	=	0x00a1
                           0000A2   220 _P2_2	=	0x00a2
                           0000A3   221 _P2_3	=	0x00a3
                           0000A4   222 _P2_4	=	0x00a4
                           0000A5   223 _P2_5	=	0x00a5
                           0000A6   224 _P2_6	=	0x00a6
                           0000A7   225 _P2_7	=	0x00a7
                           0000A8   226 _EX0	=	0x00a8
                           0000A9   227 _ET0	=	0x00a9
                           0000AA   228 _EX1	=	0x00aa
                           0000AB   229 _ET1	=	0x00ab
                           0000AC   230 _ES	=	0x00ac
                           0000AF   231 _EA	=	0x00af
                           0000B0   232 _P3_0	=	0x00b0
                           0000B1   233 _P3_1	=	0x00b1
                           0000B2   234 _P3_2	=	0x00b2
                           0000B3   235 _P3_3	=	0x00b3
                           0000B4   236 _P3_4	=	0x00b4
                           0000B5   237 _P3_5	=	0x00b5
                           0000B6   238 _P3_6	=	0x00b6
                           0000B7   239 _P3_7	=	0x00b7
                           0000B0   240 _RXD	=	0x00b0
                           0000B1   241 _TXD	=	0x00b1
                           0000B2   242 _INT0	=	0x00b2
                           0000B3   243 _INT1	=	0x00b3
                           0000B4   244 _T0	=	0x00b4
                           0000B5   245 _T1	=	0x00b5
                           0000B6   246 _WR	=	0x00b6
                           0000B7   247 _RD	=	0x00b7
                           0000B8   248 _PX0	=	0x00b8
                           0000B9   249 _PT0	=	0x00b9
                           0000BA   250 _PX1	=	0x00ba
                           0000BB   251 _PT1	=	0x00bb
                           0000BC   252 _PS	=	0x00bc
                           0000D0   253 _P	=	0x00d0
                           0000D1   254 _F1	=	0x00d1
                           0000D2   255 _OV	=	0x00d2
                           0000D3   256 _RS0	=	0x00d3
                           0000D4   257 _RS1	=	0x00d4
                           0000D5   258 _F0	=	0x00d5
                           0000D6   259 _AC	=	0x00d6
                           0000D7   260 _CY	=	0x00d7
                           0000C0   261 _P4_0	=	0x00c0
                           0000C1   262 _P4_1	=	0x00c1
                           0000C2   263 _P4_2	=	0x00c2
                           0000C3   264 _P4_3	=	0x00c3
                                    265 ;--------------------------------------------------------
                                    266 ; overlayable register banks
                                    267 ;--------------------------------------------------------
                                    268 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        269 	.ds 8
                                    270 ;--------------------------------------------------------
                                    271 ; internal ram data
                                    272 ;--------------------------------------------------------
                                    273 	.area DSEG    (DATA)
                                    274 ;--------------------------------------------------------
                                    275 ; overlayable items in internal ram
                                    276 ;--------------------------------------------------------
                                    277 ;--------------------------------------------------------
                                    278 ; Stack segment in internal ram
                                    279 ;--------------------------------------------------------
                                    280 	.area SSEG
      000008                        281 __start__stack:
      000008                        282 	.ds	1
                                    283 
                                    284 ;--------------------------------------------------------
                                    285 ; indirectly addressable internal ram data
                                    286 ;--------------------------------------------------------
                                    287 	.area ISEG    (DATA)
                                    288 ;--------------------------------------------------------
                                    289 ; absolute internal ram data
                                    290 ;--------------------------------------------------------
                                    291 	.area IABS    (ABS,DATA)
                                    292 	.area IABS    (ABS,DATA)
                                    293 ;--------------------------------------------------------
                                    294 ; bit data
                                    295 ;--------------------------------------------------------
                                    296 	.area BSEG    (BIT)
                                    297 ;--------------------------------------------------------
                                    298 ; paged external ram data
                                    299 ;--------------------------------------------------------
                                    300 	.area PSEG    (PAG,XDATA)
                                    301 ;--------------------------------------------------------
                                    302 ; uninitialized external ram data
                                    303 ;--------------------------------------------------------
                                    304 	.area XSEG    (XDATA)
                                    305 ;--------------------------------------------------------
                                    306 ; absolute external ram data
                                    307 ;--------------------------------------------------------
                                    308 	.area XABS    (ABS,XDATA)
                                    309 ;--------------------------------------------------------
                                    310 ; initialized external ram data
                                    311 ;--------------------------------------------------------
                                    312 	.area XISEG   (XDATA)
                                    313 	.area HOME    (CODE)
                                    314 	.area GSINIT0 (CODE)
                                    315 	.area GSINIT1 (CODE)
                                    316 	.area GSINIT2 (CODE)
                                    317 	.area GSINIT3 (CODE)
                                    318 	.area GSINIT4 (CODE)
                                    319 	.area GSINIT5 (CODE)
                                    320 	.area GSINIT  (CODE)
                                    321 	.area GSFINAL (CODE)
                                    322 	.area CSEG    (CODE)
                                    323 ;--------------------------------------------------------
                                    324 ; interrupt vector
                                    325 ;--------------------------------------------------------
                                    326 	.area HOME    (CODE)
      000000                        327 __interrupt_vect:
      000000 02 00 4E         [24]  328 	ljmp	__sdcc_gsinit_startup
                                    329 ; restartable atomic support routines
      000003                        330 	.ds	5
      000008                        331 sdcc_atomic_exchange_rollback_start::
      000008 00               [12]  332 	nop
      000009 00               [12]  333 	nop
      00000A                        334 sdcc_atomic_exchange_pdata_impl:
      00000A E2               [24]  335 	movx	a, @r0
      00000B FB               [12]  336 	mov	r3, a
      00000C EA               [12]  337 	mov	a, r2
      00000D F2               [24]  338 	movx	@r0, a
      00000E 80 2C            [24]  339 	sjmp	sdcc_atomic_exchange_exit
      000010 00               [12]  340 	nop
      000011 00               [12]  341 	nop
      000012                        342 sdcc_atomic_exchange_xdata_impl:
      000012 E0               [24]  343 	movx	a, @dptr
      000013 FB               [12]  344 	mov	r3, a
      000014 EA               [12]  345 	mov	a, r2
      000015 F0               [24]  346 	movx	@dptr, a
      000016 80 24            [24]  347 	sjmp	sdcc_atomic_exchange_exit
      000018                        348 sdcc_atomic_compare_exchange_idata_impl:
      000018 E6               [12]  349 	mov	a, @r0
      000019 B5 02 02         [24]  350 	cjne	a, ar2, .+#5
      00001C EB               [12]  351 	mov	a, r3
      00001D F6               [12]  352 	mov	@r0, a
      00001E 22               [24]  353 	ret
      00001F 00               [12]  354 	nop
      000020                        355 sdcc_atomic_compare_exchange_pdata_impl:
      000020 E2               [24]  356 	movx	a, @r0
      000021 B5 02 02         [24]  357 	cjne	a, ar2, .+#5
      000024 EB               [12]  358 	mov	a, r3
      000025 F2               [24]  359 	movx	@r0, a
      000026 22               [24]  360 	ret
      000027 00               [12]  361 	nop
      000028                        362 sdcc_atomic_compare_exchange_xdata_impl:
      000028 E0               [24]  363 	movx	a, @dptr
      000029 B5 02 02         [24]  364 	cjne	a, ar2, .+#5
      00002C EB               [12]  365 	mov	a, r3
      00002D F0               [24]  366 	movx	@dptr, a
      00002E 22               [24]  367 	ret
      00002F                        368 sdcc_atomic_exchange_rollback_end::
                                    369 
      00002F                        370 sdcc_atomic_exchange_gptr_impl::
      00002F 30 F6 E0         [24]  371 	jnb	b.6, sdcc_atomic_exchange_xdata_impl
      000032 A8 82            [24]  372 	mov	r0, dpl
      000034 20 F5 D3         [24]  373 	jb	b.5, sdcc_atomic_exchange_pdata_impl
      000037                        374 sdcc_atomic_exchange_idata_impl:
      000037 EA               [12]  375 	mov	a, r2
      000038 C6               [12]  376 	xch	a, @r0
      000039 F5 82            [12]  377 	mov	dpl, a
      00003B 22               [24]  378 	ret
      00003C                        379 sdcc_atomic_exchange_exit:
      00003C 8B 82            [24]  380 	mov	dpl, r3
      00003E 22               [24]  381 	ret
      00003F                        382 sdcc_atomic_compare_exchange_gptr_impl::
      00003F 30 F6 E6         [24]  383 	jnb	b.6, sdcc_atomic_compare_exchange_xdata_impl
      000042 A8 82            [24]  384 	mov	r0, dpl
      000044 20 F5 D9         [24]  385 	jb	b.5, sdcc_atomic_compare_exchange_pdata_impl
      000047 80 CF            [24]  386 	sjmp	sdcc_atomic_compare_exchange_idata_impl
                                    387 ;--------------------------------------------------------
                                    388 ; global & static initialisations
                                    389 ;--------------------------------------------------------
                                    390 	.area HOME    (CODE)
                                    391 	.area GSINIT  (CODE)
                                    392 	.area GSFINAL (CODE)
                                    393 	.area GSINIT  (CODE)
                                    394 	.globl __sdcc_gsinit_startup
                                    395 	.globl __sdcc_program_startup
                                    396 	.globl __start__stack
                                    397 	.globl __mcs51_genXINIT
                                    398 	.globl __mcs51_genXRAMCLEAR
                                    399 	.globl __mcs51_genRAMCLEAR
                                    400 	.area GSFINAL (CODE)
      0000A7 02 00 49         [24]  401 	ljmp	__sdcc_program_startup
                                    402 ;--------------------------------------------------------
                                    403 ; Home
                                    404 ;--------------------------------------------------------
                                    405 	.area HOME    (CODE)
                                    406 	.area HOME    (CODE)
      000049                        407 __sdcc_program_startup:
      000049 12 00 E2         [24]  408 	lcall	_main
      00004C                        409 __sdcc_program_exit:
      00004C 80 FE            [24]  410 	sjmp	.
                                    411 ;	return from main will return to caller
                                    412 ;--------------------------------------------------------
                                    413 ; code
                                    414 ;--------------------------------------------------------
                                    415 	.area CSEG    (CODE)
                                    416 ;------------------------------------------------------------
                                    417 ;Allocation info for local variables in function 'delay_ms'
                                    418 ;------------------------------------------------------------
                                    419 ;ms            Allocated to registers r6 r7 
                                    420 ;i             Allocated to registers r4 r5 
                                    421 ;j             Allocated to registers r3 
                                    422 ;------------------------------------------------------------
                                    423 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:5: void delay_ms(unsigned int ms){
                                    424 ;	-----------------------------------------
                                    425 ;	 function delay_ms
                                    426 ;	-----------------------------------------
      0000AA                        427 _delay_ms:
                           000007   428 	ar7 = 0x07
                           000006   429 	ar6 = 0x06
                           000005   430 	ar5 = 0x05
                           000004   431 	ar4 = 0x04
                           000003   432 	ar3 = 0x03
                           000002   433 	ar2 = 0x02
                           000001   434 	ar1 = 0x01
                           000000   435 	ar0 = 0x00
      0000AA AE 82            [24]  436 	mov	r6, dpl
      0000AC AF 83            [24]  437 	mov	r7, dph
                                    438 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:7: for(i = 0; i < ms; i++)
      0000AE 7C 00            [12]  439 	mov	r4,#0x00
      0000B0 7D 00            [12]  440 	mov	r5,#0x00
      0000B2                        441 00107$:
      0000B2 C3               [12]  442 	clr	c
      0000B3 EC               [12]  443 	mov	a,r4
      0000B4 9E               [12]  444 	subb	a,r6
      0000B5 ED               [12]  445 	mov	a,r5
      0000B6 9F               [12]  446 	subb	a,r7
      0000B7 50 0B            [24]  447 	jnc	00109$
                                    448 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:8: for(j = 0; j < 120; j++);
      0000B9 7B 78            [12]  449 	mov	r3,#0x78
      0000BB                        450 00105$:
      0000BB DB FE            [24]  451 	djnz	r3,00105$
                                    452 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:7: for(i = 0; i < ms; i++)
      0000BD 0C               [12]  453 	inc	r4
      0000BE BC 00 F1         [24]  454 	cjne	r4,#0x00,00107$
      0000C1 0D               [12]  455 	inc	r5
      0000C2 80 EE            [24]  456 	sjmp	00107$
      0000C4                        457 00109$:
                                    458 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:9: }
      0000C4 22               [24]  459 	ret
                                    460 ;------------------------------------------------------------
                                    461 ;Allocation info for local variables in function 'uartInit'
                                    462 ;------------------------------------------------------------
                                    463 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:12: void uartInit(void){
                                    464 ;	-----------------------------------------
                                    465 ;	 function uartInit
                                    466 ;	-----------------------------------------
      0000C5                        467 _uartInit:
                                    468 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:13: TMOD = (TMOD & 0x0F) | 0x20;    /* T1 方式2（8 位自动重装），保留 T0 设置 */
      0000C5 E5 89            [12]  469 	mov	a,_TMOD
      0000C7 54 0F            [12]  470 	anl	a,#0x0f
      0000C9 44 20            [12]  471 	orl	a,#0x20
      0000CB F5 89            [12]  472 	mov	_TMOD,a
                                    473 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:14: TH1 = 0xFD;
      0000CD 75 8D FD         [24]  474 	mov	_TH1,#0xfd
                                    475 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:15: TL1 = 0xFD;
      0000D0 75 8B FD         [24]  476 	mov	_TL1,#0xfd
                                    477 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:16: TR1 = 1;                        /* 启动 T1 */
                                    478 ;	assignBit
      0000D3 D2 8E            [12]  479 	setb	_TR1
                                    480 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:17: SCON = 0x50;                    /* 方式1，REN=1 允许接收 */
      0000D5 75 98 50         [24]  481 	mov	_SCON,#0x50
                                    482 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:19: }
      0000D8 22               [24]  483 	ret
                                    484 ;------------------------------------------------------------
                                    485 ;Allocation info for local variables in function 'uartSend'
                                    486 ;------------------------------------------------------------
                                    487 ;c             Allocated to registers 
                                    488 ;------------------------------------------------------------
                                    489 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:21: void uartSend(unsigned char c){
                                    490 ;	-----------------------------------------
                                    491 ;	 function uartSend
                                    492 ;	-----------------------------------------
      0000D9                        493 _uartSend:
      0000D9 85 82 99         [24]  494 	mov	_SBUF,dpl
                                    495 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:23: while(!TI);                     /* 等发送完成 */
      0000DC                        496 00101$:
                                    497 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:24: TI = 0;                         /* 软清标志 */
                                    498 ;	assignBit
      0000DC 10 99 02         [24]  499 	jbc	_TI,00120$
      0000DF 80 FB            [24]  500 	sjmp	00101$
      0000E1                        501 00120$:
                                    502 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:25: }
      0000E1 22               [24]  503 	ret
                                    504 ;------------------------------------------------------------
                                    505 ;Allocation info for local variables in function 'main'
                                    506 ;------------------------------------------------------------
                                    507 ;c             Allocated to registers r7 
                                    508 ;------------------------------------------------------------
                                    509 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:27: void main(void){
                                    510 ;	-----------------------------------------
                                    511 ;	 function main
                                    512 ;	-----------------------------------------
      0000E2                        513 _main:
                                    514 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:29: uartInit();
      0000E2 12 00 C5         [24]  515 	lcall	_uartInit
                                    516 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:30: while(1){
      0000E5                        517 00104$:
                                    518 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:31: if(RI){                     /* 收到一个字节 */
      0000E5 30 98 FD         [24]  519 	jnb	_RI,00104$
                                    520 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:32: c = SBUF;
      0000E8 AF 99            [24]  521 	mov	r7,_SBUF
                                    522 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:33: RI = 0;                 /* 先清标志再处理，避免丢字节 */
                                    523 ;	assignBit
      0000EA C2 98            [12]  524 	clr	_RI
                                    525 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:34: uartSend(c);            /* 回显 */
      0000EC 8F 82            [24]  526 	mov	dpl, r7
      0000EE 12 00 D9         [24]  527 	lcall	_uartSend
                                    528 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/data/experiments/uart_echo.c:37: }
      0000F1 80 F2            [24]  529 	sjmp	00104$
                                    530 	.area CSEG    (CODE)
                                    531 	.area CONST   (CODE)
                                    532 	.area XINIT   (CODE)
                                    533 	.area CABS    (ABS,CODE)
