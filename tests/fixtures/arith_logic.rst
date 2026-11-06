                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ISO C Compiler
                                      3 ; Version 4.6.0 #16555 (MINGW64)
                                      4 ;--------------------------------------------------------
                                      5 	.module arith_logic
                                      6 	
                                      7 	.optsdcc -mmcs51 --model-small
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _main
                                     12 	.globl _CY
                                     13 	.globl _AC
                                     14 	.globl _F0
                                     15 	.globl _RS1
                                     16 	.globl _RS0
                                     17 	.globl _OV
                                     18 	.globl _F1
                                     19 	.globl _P
                                     20 	.globl _PS
                                     21 	.globl _PT1
                                     22 	.globl _PX1
                                     23 	.globl _PT0
                                     24 	.globl _PX0
                                     25 	.globl _RD
                                     26 	.globl _WR
                                     27 	.globl _T1
                                     28 	.globl _T0
                                     29 	.globl _INT1
                                     30 	.globl _INT0
                                     31 	.globl _TXD
                                     32 	.globl _RXD
                                     33 	.globl _P3_7
                                     34 	.globl _P3_6
                                     35 	.globl _P3_5
                                     36 	.globl _P3_4
                                     37 	.globl _P3_3
                                     38 	.globl _P3_2
                                     39 	.globl _P3_1
                                     40 	.globl _P3_0
                                     41 	.globl _EA
                                     42 	.globl _ES
                                     43 	.globl _ET1
                                     44 	.globl _EX1
                                     45 	.globl _ET0
                                     46 	.globl _EX0
                                     47 	.globl _P2_7
                                     48 	.globl _P2_6
                                     49 	.globl _P2_5
                                     50 	.globl _P2_4
                                     51 	.globl _P2_3
                                     52 	.globl _P2_2
                                     53 	.globl _P2_1
                                     54 	.globl _P2_0
                                     55 	.globl _SM0
                                     56 	.globl _SM1
                                     57 	.globl _SM2
                                     58 	.globl _REN
                                     59 	.globl _TB8
                                     60 	.globl _RB8
                                     61 	.globl _TI
                                     62 	.globl _RI
                                     63 	.globl _P1_7
                                     64 	.globl _P1_6
                                     65 	.globl _P1_5
                                     66 	.globl _P1_4
                                     67 	.globl _P1_3
                                     68 	.globl _P1_2
                                     69 	.globl _P1_1
                                     70 	.globl _P1_0
                                     71 	.globl _TF1
                                     72 	.globl _TR1
                                     73 	.globl _TF0
                                     74 	.globl _TR0
                                     75 	.globl _IE1
                                     76 	.globl _IT1
                                     77 	.globl _IE0
                                     78 	.globl _IT0
                                     79 	.globl _P0_7
                                     80 	.globl _P0_6
                                     81 	.globl _P0_5
                                     82 	.globl _P0_4
                                     83 	.globl _P0_3
                                     84 	.globl _P0_2
                                     85 	.globl _P0_1
                                     86 	.globl _P0_0
                                     87 	.globl _B
                                     88 	.globl _ACC
                                     89 	.globl _PSW
                                     90 	.globl _IP
                                     91 	.globl _P3
                                     92 	.globl _IE
                                     93 	.globl _P2
                                     94 	.globl _SBUF
                                     95 	.globl _SCON
                                     96 	.globl _P1
                                     97 	.globl _TH1
                                     98 	.globl _TH0
                                     99 	.globl _TL1
                                    100 	.globl _TL0
                                    101 	.globl _TMOD
                                    102 	.globl _TCON
                                    103 	.globl _PCON
                                    104 	.globl _DPH
                                    105 	.globl _DPL
                                    106 	.globl _SP
                                    107 	.globl _P0
                                    108 	.globl _r1v
                                    109 	.globl _r0v
                                    110 ;--------------------------------------------------------
                                    111 ; special function registers
                                    112 ;--------------------------------------------------------
                                    113 	.area RSEG    (ABS,DATA)
      000000                        114 	.org 0x0000
                           000080   115 _P0	=	0x0080
                           000081   116 _SP	=	0x0081
                           000082   117 _DPL	=	0x0082
                           000083   118 _DPH	=	0x0083
                           000087   119 _PCON	=	0x0087
                           000088   120 _TCON	=	0x0088
                           000089   121 _TMOD	=	0x0089
                           00008A   122 _TL0	=	0x008a
                           00008B   123 _TL1	=	0x008b
                           00008C   124 _TH0	=	0x008c
                           00008D   125 _TH1	=	0x008d
                           000090   126 _P1	=	0x0090
                           000098   127 _SCON	=	0x0098
                           000099   128 _SBUF	=	0x0099
                           0000A0   129 _P2	=	0x00a0
                           0000A8   130 _IE	=	0x00a8
                           0000B0   131 _P3	=	0x00b0
                           0000B8   132 _IP	=	0x00b8
                           0000D0   133 _PSW	=	0x00d0
                           0000E0   134 _ACC	=	0x00e0
                           0000F0   135 _B	=	0x00f0
                                    136 ;--------------------------------------------------------
                                    137 ; special function bits
                                    138 ;--------------------------------------------------------
                                    139 	.area RSEG    (ABS,DATA)
      000000                        140 	.org 0x0000
                           000080   141 _P0_0	=	0x0080
                           000081   142 _P0_1	=	0x0081
                           000082   143 _P0_2	=	0x0082
                           000083   144 _P0_3	=	0x0083
                           000084   145 _P0_4	=	0x0084
                           000085   146 _P0_5	=	0x0085
                           000086   147 _P0_6	=	0x0086
                           000087   148 _P0_7	=	0x0087
                           000088   149 _IT0	=	0x0088
                           000089   150 _IE0	=	0x0089
                           00008A   151 _IT1	=	0x008a
                           00008B   152 _IE1	=	0x008b
                           00008C   153 _TR0	=	0x008c
                           00008D   154 _TF0	=	0x008d
                           00008E   155 _TR1	=	0x008e
                           00008F   156 _TF1	=	0x008f
                           000090   157 _P1_0	=	0x0090
                           000091   158 _P1_1	=	0x0091
                           000092   159 _P1_2	=	0x0092
                           000093   160 _P1_3	=	0x0093
                           000094   161 _P1_4	=	0x0094
                           000095   162 _P1_5	=	0x0095
                           000096   163 _P1_6	=	0x0096
                           000097   164 _P1_7	=	0x0097
                           000098   165 _RI	=	0x0098
                           000099   166 _TI	=	0x0099
                           00009A   167 _RB8	=	0x009a
                           00009B   168 _TB8	=	0x009b
                           00009C   169 _REN	=	0x009c
                           00009D   170 _SM2	=	0x009d
                           00009E   171 _SM1	=	0x009e
                           00009F   172 _SM0	=	0x009f
                           0000A0   173 _P2_0	=	0x00a0
                           0000A1   174 _P2_1	=	0x00a1
                           0000A2   175 _P2_2	=	0x00a2
                           0000A3   176 _P2_3	=	0x00a3
                           0000A4   177 _P2_4	=	0x00a4
                           0000A5   178 _P2_5	=	0x00a5
                           0000A6   179 _P2_6	=	0x00a6
                           0000A7   180 _P2_7	=	0x00a7
                           0000A8   181 _EX0	=	0x00a8
                           0000A9   182 _ET0	=	0x00a9
                           0000AA   183 _EX1	=	0x00aa
                           0000AB   184 _ET1	=	0x00ab
                           0000AC   185 _ES	=	0x00ac
                           0000AF   186 _EA	=	0x00af
                           0000B0   187 _P3_0	=	0x00b0
                           0000B1   188 _P3_1	=	0x00b1
                           0000B2   189 _P3_2	=	0x00b2
                           0000B3   190 _P3_3	=	0x00b3
                           0000B4   191 _P3_4	=	0x00b4
                           0000B5   192 _P3_5	=	0x00b5
                           0000B6   193 _P3_6	=	0x00b6
                           0000B7   194 _P3_7	=	0x00b7
                           0000B0   195 _RXD	=	0x00b0
                           0000B1   196 _TXD	=	0x00b1
                           0000B2   197 _INT0	=	0x00b2
                           0000B3   198 _INT1	=	0x00b3
                           0000B4   199 _T0	=	0x00b4
                           0000B5   200 _T1	=	0x00b5
                           0000B6   201 _WR	=	0x00b6
                           0000B7   202 _RD	=	0x00b7
                           0000B8   203 _PX0	=	0x00b8
                           0000B9   204 _PT0	=	0x00b9
                           0000BA   205 _PX1	=	0x00ba
                           0000BB   206 _PT1	=	0x00bb
                           0000BC   207 _PS	=	0x00bc
                           0000D0   208 _P	=	0x00d0
                           0000D1   209 _F1	=	0x00d1
                           0000D2   210 _OV	=	0x00d2
                           0000D3   211 _RS0	=	0x00d3
                           0000D4   212 _RS1	=	0x00d4
                           0000D5   213 _F0	=	0x00d5
                           0000D6   214 _AC	=	0x00d6
                           0000D7   215 _CY	=	0x00d7
                                    216 ;--------------------------------------------------------
                                    217 ; overlayable register banks
                                    218 ;--------------------------------------------------------
                                    219 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        220 	.ds 8
                                    221 ;--------------------------------------------------------
                                    222 ; internal ram data
                                    223 ;--------------------------------------------------------
                                    224 	.area DSEG    (DATA)
      000008                        225 _r0v::
      000008                        226 	.ds 1
      000009                        227 _r1v::
      000009                        228 	.ds 1
                                    229 ;--------------------------------------------------------
                                    230 ; overlayable items in internal ram
                                    231 ;--------------------------------------------------------
                                    232 ;--------------------------------------------------------
                                    233 ; Stack segment in internal ram
                                    234 ;--------------------------------------------------------
                                    235 	.area SSEG
      00000A                        236 __start__stack:
      00000A                        237 	.ds	1
                                    238 
                                    239 ;--------------------------------------------------------
                                    240 ; indirectly addressable internal ram data
                                    241 ;--------------------------------------------------------
                                    242 	.area ISEG    (DATA)
                                    243 ;--------------------------------------------------------
                                    244 ; absolute internal ram data
                                    245 ;--------------------------------------------------------
                                    246 	.area IABS    (ABS,DATA)
                                    247 	.area IABS    (ABS,DATA)
                                    248 ;--------------------------------------------------------
                                    249 ; bit data
                                    250 ;--------------------------------------------------------
                                    251 	.area BSEG    (BIT)
                                    252 ;--------------------------------------------------------
                                    253 ; paged external ram data
                                    254 ;--------------------------------------------------------
                                    255 	.area PSEG    (PAG,XDATA)
                                    256 ;--------------------------------------------------------
                                    257 ; uninitialized external ram data
                                    258 ;--------------------------------------------------------
                                    259 	.area XSEG    (XDATA)
                                    260 ;--------------------------------------------------------
                                    261 ; absolute external ram data
                                    262 ;--------------------------------------------------------
                                    263 	.area XABS    (ABS,XDATA)
                                    264 ;--------------------------------------------------------
                                    265 ; initialized external ram data
                                    266 ;--------------------------------------------------------
                                    267 	.area XISEG   (XDATA)
                                    268 	.area HOME    (CODE)
                                    269 	.area GSINIT0 (CODE)
                                    270 	.area GSINIT1 (CODE)
                                    271 	.area GSINIT2 (CODE)
                                    272 	.area GSINIT3 (CODE)
                                    273 	.area GSINIT4 (CODE)
                                    274 	.area GSINIT5 (CODE)
                                    275 	.area GSINIT  (CODE)
                                    276 	.area GSFINAL (CODE)
                                    277 	.area CSEG    (CODE)
                                    278 ;--------------------------------------------------------
                                    279 ; interrupt vector
                                    280 ;--------------------------------------------------------
                                    281 	.area HOME    (CODE)
      000000                        282 __interrupt_vect:
      000000 02 00 4E         [24]  283 	ljmp	__sdcc_gsinit_startup
                                    284 ; restartable atomic support routines
      000003                        285 	.ds	5
      000008                        286 sdcc_atomic_exchange_rollback_start::
      000008 00               [12]  287 	nop
      000009 00               [12]  288 	nop
      00000A                        289 sdcc_atomic_exchange_pdata_impl:
      00000A E2               [24]  290 	movx	a, @r0
      00000B FB               [12]  291 	mov	r3, a
      00000C EA               [12]  292 	mov	a, r2
      00000D F2               [24]  293 	movx	@r0, a
      00000E 80 2C            [24]  294 	sjmp	sdcc_atomic_exchange_exit
      000010 00               [12]  295 	nop
      000011 00               [12]  296 	nop
      000012                        297 sdcc_atomic_exchange_xdata_impl:
      000012 E0               [24]  298 	movx	a, @dptr
      000013 FB               [12]  299 	mov	r3, a
      000014 EA               [12]  300 	mov	a, r2
      000015 F0               [24]  301 	movx	@dptr, a
      000016 80 24            [24]  302 	sjmp	sdcc_atomic_exchange_exit
      000018                        303 sdcc_atomic_compare_exchange_idata_impl:
      000018 E6               [12]  304 	mov	a, @r0
      000019 B5 02 02         [24]  305 	cjne	a, ar2, .+#5
      00001C EB               [12]  306 	mov	a, r3
      00001D F6               [12]  307 	mov	@r0, a
      00001E 22               [24]  308 	ret
      00001F 00               [12]  309 	nop
      000020                        310 sdcc_atomic_compare_exchange_pdata_impl:
      000020 E2               [24]  311 	movx	a, @r0
      000021 B5 02 02         [24]  312 	cjne	a, ar2, .+#5
      000024 EB               [12]  313 	mov	a, r3
      000025 F2               [24]  314 	movx	@r0, a
      000026 22               [24]  315 	ret
      000027 00               [12]  316 	nop
      000028                        317 sdcc_atomic_compare_exchange_xdata_impl:
      000028 E0               [24]  318 	movx	a, @dptr
      000029 B5 02 02         [24]  319 	cjne	a, ar2, .+#5
      00002C EB               [12]  320 	mov	a, r3
      00002D F0               [24]  321 	movx	@dptr, a
      00002E 22               [24]  322 	ret
      00002F                        323 sdcc_atomic_exchange_rollback_end::
                                    324 
      00002F                        325 sdcc_atomic_exchange_gptr_impl::
      00002F 30 F6 E0         [24]  326 	jnb	b.6, sdcc_atomic_exchange_xdata_impl
      000032 A8 82            [24]  327 	mov	r0, dpl
      000034 20 F5 D3         [24]  328 	jb	b.5, sdcc_atomic_exchange_pdata_impl
      000037                        329 sdcc_atomic_exchange_idata_impl:
      000037 EA               [12]  330 	mov	a, r2
      000038 C6               [12]  331 	xch	a, @r0
      000039 F5 82            [12]  332 	mov	dpl, a
      00003B 22               [24]  333 	ret
      00003C                        334 sdcc_atomic_exchange_exit:
      00003C 8B 82            [24]  335 	mov	dpl, r3
      00003E 22               [24]  336 	ret
      00003F                        337 sdcc_atomic_compare_exchange_gptr_impl::
      00003F 30 F6 E6         [24]  338 	jnb	b.6, sdcc_atomic_compare_exchange_xdata_impl
      000042 A8 82            [24]  339 	mov	r0, dpl
      000044 20 F5 D9         [24]  340 	jb	b.5, sdcc_atomic_compare_exchange_pdata_impl
      000047 80 CF            [24]  341 	sjmp	sdcc_atomic_compare_exchange_idata_impl
                                    342 ;--------------------------------------------------------
                                    343 ; global & static initialisations
                                    344 ;--------------------------------------------------------
                                    345 	.area HOME    (CODE)
                                    346 	.area GSINIT  (CODE)
                                    347 	.area GSFINAL (CODE)
                                    348 	.area GSINIT  (CODE)
                                    349 	.globl __sdcc_gsinit_startup
                                    350 	.globl __sdcc_program_startup
                                    351 	.globl __start__stack
                                    352 	.globl __mcs51_genXINIT
                                    353 	.globl __mcs51_genXRAMCLEAR
                                    354 	.globl __mcs51_genRAMCLEAR
                                    355 	.area GSFINAL (CODE)
      0000A7 02 00 49         [24]  356 	ljmp	__sdcc_program_startup
                                    357 ;--------------------------------------------------------
                                    358 ; Home
                                    359 ;--------------------------------------------------------
                                    360 	.area HOME    (CODE)
                                    361 	.area HOME    (CODE)
      000049                        362 __sdcc_program_startup:
      000049 12 00 AA         [24]  363 	lcall	_main
      00004C                        364 __sdcc_program_exit:
      00004C 80 FE            [24]  365 	sjmp	.
                                    366 ;	return from main will return to caller
                                    367 ;--------------------------------------------------------
                                    368 ; code
                                    369 ;--------------------------------------------------------
                                    370 	.area CSEG    (CODE)
                                    371 ;------------------------------------------------------------
                                    372 ;Allocation info for local variables in function 'main'
                                    373 ;------------------------------------------------------------
                                    374 ;a             Allocated to registers r4 
                                    375 ;b             Allocated to registers r3 
                                    376 ;i             Allocated to registers r5 
                                    377 ;s             Allocated to registers 
                                    378 ;------------------------------------------------------------
                                    379 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:4: void main(void){
                                    380 ;	-----------------------------------------
                                    381 ;	 function main
                                    382 ;	-----------------------------------------
      0000AA                        383 _main:
                           000007   384 	ar7 = 0x07
                           000006   385 	ar6 = 0x06
                           000005   386 	ar5 = 0x05
                           000004   387 	ar4 = 0x04
                           000003   388 	ar3 = 0x03
                           000002   389 	ar2 = 0x02
                           000001   390 	ar1 = 0x01
                           000000   391 	ar0 = 0x00
                                    392 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:5: unsigned char a=0x35, b=0x7A, i;
      0000AA 7F 35            [12]  393 	mov	r7,#0x35
      0000AC 7E 7A            [12]  394 	mov	r6,#0x7a
                                    395 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:7: for(i=0;i<40;i++){
      0000AE 7D 00            [12]  396 	mov	r5,#0x00
      0000B0                        397 00108$:
                                    398 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:8: a = a + b;
      0000B0 EE               [12]  399 	mov	a,r6
      0000B1 2F               [12]  400 	add	a, r7
      0000B2 FC               [12]  401 	mov	r4,a
                                    402 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:9: b = b ^ 0x5A;
      0000B3 74 5A            [12]  403 	mov	a,#0x5a
      0000B5 6E               [12]  404 	xrl	a,r6
      0000B6 FB               [12]  405 	mov	r3,a
                                    406 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:10: a = (a << 1) | (a >> 7);
      0000B7 EC               [12]  407 	mov	a,r4
      0000B8 23               [12]  408 	rl	a
                                    409 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:12: if(a > 0x80) b -= 3;
      0000B9 FC               [12]  410 	mov  r4,a
      0000BA 24 7F            [12]  411 	add	a,#0xff - 0x80
      0000BC 50 08            [24]  412 	jnc	00102$
                                    413 ;	free result
      0000BE 8B 02            [24]  414 	mov	ar2,r3
      0000C0 EA               [12]  415 	mov	a,r2
      0000C1 24 FD            [12]  416 	add	a,#0xfd
      0000C3 FE               [12]  417 	mov	r6,a
      0000C4 80 04            [24]  418 	sjmp	00103$
      0000C6                        419 00102$:
                                    420 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:13: else b += 5;
      0000C6 74 05            [12]  421 	mov	a,#0x05
      0000C8 2B               [12]  422 	add	a, r3
      0000C9 FE               [12]  423 	mov	r6,a
      0000CA                        424 00103$:
                                    425 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:14: a = a & 0x7F;
      0000CA 74 7F            [12]  426 	mov	a,#0x7f
      0000CC 5C               [12]  427 	anl	a,r4
      0000CD FF               [12]  428 	mov	r7,a
                                    429 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:7: for(i=0;i<40;i++){
      0000CE 0D               [12]  430 	inc	r5
      0000CF BD 28 00         [24]  431 	cjne	r5,#0x28,00146$
      0000D2                        432 00146$:
      0000D2 40 DC            [24]  433 	jc	00108$
                                    434 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:18: r0v = a; r1v = b;
      0000D4 75 08 13         [24]  435 	mov	_r0v,#0x13
      0000D7 75 09 01         [24]  436 	mov	_r1v,#0x01
                                    437 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:19: while(1){ a++; b--; }
      0000DA                        438 00106$:
                                    439 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/arith_logic.c:20: }
      0000DA 80 FE            [24]  440 	sjmp	00106$
                                    441 	.area CSEG    (CODE)
                                    442 	.area CONST   (CODE)
                                    443 	.area XINIT   (CODE)
                                    444 	.area CABS    (ABS,CODE)
