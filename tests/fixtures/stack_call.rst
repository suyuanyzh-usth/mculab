                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ISO C Compiler
                                      3 ; Version 4.6.0 #16555 (MINGW64)
                                      4 ;--------------------------------------------------------
                                      5 	.module stack_call
                                      6 	
                                      7 	.optsdcc -mmcs51 --model-small
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _main
                                     12 	.globl _mix
                                     13 	.globl _CY
                                     14 	.globl _AC
                                     15 	.globl _F0
                                     16 	.globl _RS1
                                     17 	.globl _RS0
                                     18 	.globl _OV
                                     19 	.globl _F1
                                     20 	.globl _P
                                     21 	.globl _PS
                                     22 	.globl _PT1
                                     23 	.globl _PX1
                                     24 	.globl _PT0
                                     25 	.globl _PX0
                                     26 	.globl _RD
                                     27 	.globl _WR
                                     28 	.globl _T1
                                     29 	.globl _T0
                                     30 	.globl _INT1
                                     31 	.globl _INT0
                                     32 	.globl _TXD
                                     33 	.globl _RXD
                                     34 	.globl _P3_7
                                     35 	.globl _P3_6
                                     36 	.globl _P3_5
                                     37 	.globl _P3_4
                                     38 	.globl _P3_3
                                     39 	.globl _P3_2
                                     40 	.globl _P3_1
                                     41 	.globl _P3_0
                                     42 	.globl _EA
                                     43 	.globl _ES
                                     44 	.globl _ET1
                                     45 	.globl _EX1
                                     46 	.globl _ET0
                                     47 	.globl _EX0
                                     48 	.globl _P2_7
                                     49 	.globl _P2_6
                                     50 	.globl _P2_5
                                     51 	.globl _P2_4
                                     52 	.globl _P2_3
                                     53 	.globl _P2_2
                                     54 	.globl _P2_1
                                     55 	.globl _P2_0
                                     56 	.globl _SM0
                                     57 	.globl _SM1
                                     58 	.globl _SM2
                                     59 	.globl _REN
                                     60 	.globl _TB8
                                     61 	.globl _RB8
                                     62 	.globl _TI
                                     63 	.globl _RI
                                     64 	.globl _P1_7
                                     65 	.globl _P1_6
                                     66 	.globl _P1_5
                                     67 	.globl _P1_4
                                     68 	.globl _P1_3
                                     69 	.globl _P1_2
                                     70 	.globl _P1_1
                                     71 	.globl _P1_0
                                     72 	.globl _TF1
                                     73 	.globl _TR1
                                     74 	.globl _TF0
                                     75 	.globl _TR0
                                     76 	.globl _IE1
                                     77 	.globl _IT1
                                     78 	.globl _IE0
                                     79 	.globl _IT0
                                     80 	.globl _P0_7
                                     81 	.globl _P0_6
                                     82 	.globl _P0_5
                                     83 	.globl _P0_4
                                     84 	.globl _P0_3
                                     85 	.globl _P0_2
                                     86 	.globl _P0_1
                                     87 	.globl _P0_0
                                     88 	.globl _B
                                     89 	.globl _ACC
                                     90 	.globl _PSW
                                     91 	.globl _IP
                                     92 	.globl _P3
                                     93 	.globl _IE
                                     94 	.globl _P2
                                     95 	.globl _SBUF
                                     96 	.globl _SCON
                                     97 	.globl _P1
                                     98 	.globl _TH1
                                     99 	.globl _TH0
                                    100 	.globl _TL1
                                    101 	.globl _TL0
                                    102 	.globl _TMOD
                                    103 	.globl _TCON
                                    104 	.globl _PCON
                                    105 	.globl _DPH
                                    106 	.globl _DPL
                                    107 	.globl _SP
                                    108 	.globl _P0
                                    109 	.globl _seed
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
      000008                        225 _seed::
      000008                        226 	.ds 2
                                    227 ;--------------------------------------------------------
                                    228 ; overlayable items in internal ram
                                    229 ;--------------------------------------------------------
                                    230 ;--------------------------------------------------------
                                    231 ; Stack segment in internal ram
                                    232 ;--------------------------------------------------------
                                    233 	.area SSEG
      00000B                        234 __start__stack:
      00000B                        235 	.ds	1
                                    236 
                                    237 ;--------------------------------------------------------
                                    238 ; indirectly addressable internal ram data
                                    239 ;--------------------------------------------------------
                                    240 	.area ISEG    (DATA)
                                    241 ;--------------------------------------------------------
                                    242 ; absolute internal ram data
                                    243 ;--------------------------------------------------------
                                    244 	.area IABS    (ABS,DATA)
                                    245 	.area IABS    (ABS,DATA)
                                    246 ;--------------------------------------------------------
                                    247 ; bit data
                                    248 ;--------------------------------------------------------
                                    249 	.area BSEG    (BIT)
                                    250 ;--------------------------------------------------------
                                    251 ; paged external ram data
                                    252 ;--------------------------------------------------------
                                    253 	.area PSEG    (PAG,XDATA)
                                    254 ;--------------------------------------------------------
                                    255 ; uninitialized external ram data
                                    256 ;--------------------------------------------------------
                                    257 	.area XSEG    (XDATA)
                                    258 ;--------------------------------------------------------
                                    259 ; absolute external ram data
                                    260 ;--------------------------------------------------------
                                    261 	.area XABS    (ABS,XDATA)
                                    262 ;--------------------------------------------------------
                                    263 ; initialized external ram data
                                    264 ;--------------------------------------------------------
                                    265 	.area XISEG   (XDATA)
                                    266 	.area HOME    (CODE)
                                    267 	.area GSINIT0 (CODE)
                                    268 	.area GSINIT1 (CODE)
                                    269 	.area GSINIT2 (CODE)
                                    270 	.area GSINIT3 (CODE)
                                    271 	.area GSINIT4 (CODE)
                                    272 	.area GSINIT5 (CODE)
                                    273 	.area GSINIT  (CODE)
                                    274 	.area GSFINAL (CODE)
                                    275 	.area CSEG    (CODE)
                                    276 ;--------------------------------------------------------
                                    277 ; interrupt vector
                                    278 ;--------------------------------------------------------
                                    279 	.area HOME    (CODE)
      000000                        280 __interrupt_vect:
      000000 02 00 4E         [24]  281 	ljmp	__sdcc_gsinit_startup
                                    282 ; restartable atomic support routines
      000003                        283 	.ds	5
      000008                        284 sdcc_atomic_exchange_rollback_start::
      000008 00               [12]  285 	nop
      000009 00               [12]  286 	nop
      00000A                        287 sdcc_atomic_exchange_pdata_impl:
      00000A E2               [24]  288 	movx	a, @r0
      00000B FB               [12]  289 	mov	r3, a
      00000C EA               [12]  290 	mov	a, r2
      00000D F2               [24]  291 	movx	@r0, a
      00000E 80 2C            [24]  292 	sjmp	sdcc_atomic_exchange_exit
      000010 00               [12]  293 	nop
      000011 00               [12]  294 	nop
      000012                        295 sdcc_atomic_exchange_xdata_impl:
      000012 E0               [24]  296 	movx	a, @dptr
      000013 FB               [12]  297 	mov	r3, a
      000014 EA               [12]  298 	mov	a, r2
      000015 F0               [24]  299 	movx	@dptr, a
      000016 80 24            [24]  300 	sjmp	sdcc_atomic_exchange_exit
      000018                        301 sdcc_atomic_compare_exchange_idata_impl:
      000018 E6               [12]  302 	mov	a, @r0
      000019 B5 02 02         [24]  303 	cjne	a, ar2, .+#5
      00001C EB               [12]  304 	mov	a, r3
      00001D F6               [12]  305 	mov	@r0, a
      00001E 22               [24]  306 	ret
      00001F 00               [12]  307 	nop
      000020                        308 sdcc_atomic_compare_exchange_pdata_impl:
      000020 E2               [24]  309 	movx	a, @r0
      000021 B5 02 02         [24]  310 	cjne	a, ar2, .+#5
      000024 EB               [12]  311 	mov	a, r3
      000025 F2               [24]  312 	movx	@r0, a
      000026 22               [24]  313 	ret
      000027 00               [12]  314 	nop
      000028                        315 sdcc_atomic_compare_exchange_xdata_impl:
      000028 E0               [24]  316 	movx	a, @dptr
      000029 B5 02 02         [24]  317 	cjne	a, ar2, .+#5
      00002C EB               [12]  318 	mov	a, r3
      00002D F0               [24]  319 	movx	@dptr, a
      00002E 22               [24]  320 	ret
      00002F                        321 sdcc_atomic_exchange_rollback_end::
                                    322 
      00002F                        323 sdcc_atomic_exchange_gptr_impl::
      00002F 30 F6 E0         [24]  324 	jnb	b.6, sdcc_atomic_exchange_xdata_impl
      000032 A8 82            [24]  325 	mov	r0, dpl
      000034 20 F5 D3         [24]  326 	jb	b.5, sdcc_atomic_exchange_pdata_impl
      000037                        327 sdcc_atomic_exchange_idata_impl:
      000037 EA               [12]  328 	mov	a, r2
      000038 C6               [12]  329 	xch	a, @r0
      000039 F5 82            [12]  330 	mov	dpl, a
      00003B 22               [24]  331 	ret
      00003C                        332 sdcc_atomic_exchange_exit:
      00003C 8B 82            [24]  333 	mov	dpl, r3
      00003E 22               [24]  334 	ret
      00003F                        335 sdcc_atomic_compare_exchange_gptr_impl::
      00003F 30 F6 E6         [24]  336 	jnb	b.6, sdcc_atomic_compare_exchange_xdata_impl
      000042 A8 82            [24]  337 	mov	r0, dpl
      000044 20 F5 D9         [24]  338 	jb	b.5, sdcc_atomic_compare_exchange_pdata_impl
      000047 80 CF            [24]  339 	sjmp	sdcc_atomic_compare_exchange_idata_impl
                                    340 ;--------------------------------------------------------
                                    341 ; global & static initialisations
                                    342 ;--------------------------------------------------------
                                    343 	.area HOME    (CODE)
                                    344 	.area GSINIT  (CODE)
                                    345 	.area GSFINAL (CODE)
                                    346 	.area GSINIT  (CODE)
                                    347 	.globl __sdcc_gsinit_startup
                                    348 	.globl __sdcc_program_startup
                                    349 	.globl __start__stack
                                    350 	.globl __mcs51_genXINIT
                                    351 	.globl __mcs51_genXRAMCLEAR
                                    352 	.globl __mcs51_genRAMCLEAR
                                    353 	.area GSFINAL (CODE)
      0000A7 02 00 49         [24]  354 	ljmp	__sdcc_program_startup
                                    355 ;--------------------------------------------------------
                                    356 ; Home
                                    357 ;--------------------------------------------------------
                                    358 	.area HOME    (CODE)
                                    359 	.area HOME    (CODE)
      000049                        360 __sdcc_program_startup:
      000049 12 01 06         [24]  361 	lcall	_main
      00004C                        362 __sdcc_program_exit:
      00004C 80 FE            [24]  363 	sjmp	.
                                    364 ;	return from main will return to caller
                                    365 ;--------------------------------------------------------
                                    366 ; code
                                    367 ;--------------------------------------------------------
                                    368 	.area CSEG    (CODE)
                                    369 ;------------------------------------------------------------
                                    370 ;Allocation info for local variables in function 'mix'
                                    371 ;------------------------------------------------------------
                                    372 ;k             Allocated to stack - _bp -3 +1 
                                    373 ;x             Allocated to registers r3 r4 
                                    374 ;i             Allocated to stack - _bp +1 +1 
                                    375 ;------------------------------------------------------------
                                    376 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:4: unsigned int mix(unsigned int x, unsigned char k){
                                    377 ;	-----------------------------------------
                                    378 ;	 function mix
                                    379 ;	-----------------------------------------
      0000AA                        380 _mix:
                           000007   381 	ar7 = 0x07
                           000006   382 	ar6 = 0x06
                           000005   383 	ar5 = 0x05
                           000004   384 	ar4 = 0x04
                           000003   385 	ar3 = 0x03
                           000002   386 	ar2 = 0x02
                           000001   387 	ar1 = 0x01
                           000000   388 	ar0 = 0x00
      0000AA C0 0A            [24]  389 	push	_bp
      0000AC 85 81 0A         [24]  390 	mov	_bp,sp
      0000AF 05 81            [12]  391 	inc	sp
      0000B1 AE 82            [24]  392 	mov	r6, dpl
      0000B3 AF 83            [24]  393 	mov	r7, dph
                                    394 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:6: for(i=0;i<k;i++){ x = x * 3 + 7; x ^= (x >> 3); }
      0000B5 A8 0A            [24]  395 	mov	r0,_bp
      0000B7 08               [12]  396 	inc	r0
      0000B8 76 00            [12]  397 	mov	@r0,#0x00
      0000BA                        398 00103$:
      0000BA A8 0A            [24]  399 	mov	r0,_bp
      0000BC 08               [12]  400 	inc	r0
      0000BD E5 0A            [12]  401 	mov	a,_bp
      0000BF 24 FD            [12]  402 	add	a,#0xfd
      0000C1 F9               [12]  403 	mov	r1,a
      0000C2 C3               [12]  404 	clr	c
      0000C3 E6               [12]  405 	mov	a,@r0
      0000C4 97               [12]  406 	subb	a,@r1
                                    407 ;	freeAsmop r1 1
      0000C5 50 36            [24]  408 	jnc	00101$
      0000C7 C0 06            [24]  409 	push	ar6
      0000C9 C0 07            [24]  410 	push	ar7
      0000CB 90 00 03         [24]  411 	mov	dptr,#0x0003
      0000CE 12 01 38         [24]  412 	lcall	__mulint
      0000D1 AB 82            [24]  413 	mov	r3, dpl
      0000D3 AC 83            [24]  414 	mov	r4, dph
      0000D5 15 81            [12]  415 	dec	sp
      0000D7 15 81            [12]  416 	dec	sp
      0000D9 74 07            [12]  417 	mov	a,#0x07
      0000DB 2B               [12]  418 	add	a, r3
      0000DC FB               [12]  419 	mov	r3,a
      0000DD E4               [12]  420 	clr	a
      0000DE 3C               [12]  421 	addc	a, r4
      0000DF FC               [12]  422 	mov	r4,a
      0000E0 8B 02            [24]  423 	mov	ar2,r3
      0000E2 C4               [12]  424 	swap	a
      0000E3 23               [12]  425 	rl	a
      0000E4 CA               [12]  426 	xch	a,r2
      0000E5 C4               [12]  427 	swap	a
      0000E6 23               [12]  428 	rl	a
      0000E7 54 1F            [12]  429 	anl	a,#0x1f
      0000E9 6A               [12]  430 	xrl	a,r2
      0000EA CA               [12]  431 	xch	a,r2
      0000EB 54 1F            [12]  432 	anl	a,#0x1f
      0000ED CA               [12]  433 	xch	a,r2
      0000EE 6A               [12]  434 	xrl	a,r2
      0000EF CA               [12]  435 	xch	a,r2
      0000F0 FD               [12]  436 	mov	r5,a
      0000F1 EA               [12]  437 	mov	a,r2
      0000F2 6B               [12]  438 	xrl	a,r3
      0000F3 FE               [12]  439 	mov	r6,a
      0000F4 ED               [12]  440 	mov	a,r5
      0000F5 6C               [12]  441 	xrl	a,r4
      0000F6 FF               [12]  442 	mov	r7,a
      0000F7 A8 0A            [24]  443 	mov	r0,_bp
      0000F9 08               [12]  444 	inc	r0
      0000FA 06               [12]  445 	inc	@r0
      0000FB 80 BD            [24]  446 	sjmp	00103$
      0000FD                        447 00101$:
                                    448 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:7: return x;
      0000FD 8E 82            [24]  449 	mov	dpl, r6
      0000FF 8F 83            [24]  450 	mov	dph, r7
                                    451 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:8: }
      000101 15 81            [12]  452 	dec	sp
      000103 D0 0A            [24]  453 	pop	_bp
      000105 22               [24]  454 	ret
                                    455 ;------------------------------------------------------------
                                    456 ;Allocation info for local variables in function 'main'
                                    457 ;------------------------------------------------------------
                                    458 ;a             Allocated to registers r6 r7 
                                    459 ;b             Allocated to registers r4 r5 
                                    460 ;------------------------------------------------------------
                                    461 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:9: void main(void){
                                    462 ;	-----------------------------------------
                                    463 ;	 function main
                                    464 ;	-----------------------------------------
      000106                        465 _main:
                                    466 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:11: a = mix(a, 5);
      000106 74 05            [12]  467 	mov	a,#0x05
      000108 C0 E0            [24]  468 	push	acc
      00010A 90 12 34         [24]  469 	mov	dptr,#0x1234
      00010D 12 00 AA         [24]  470 	lcall	_mix
      000110 AE 82            [24]  471 	mov	r6, dpl
      000112 AF 83            [24]  472 	mov	r7, dph
      000114 15 81            [12]  473 	dec	sp
                                    474 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:12: b = mix(b, 9);
      000116 C0 07            [24]  475 	push	ar7
      000118 C0 06            [24]  476 	push	ar6
      00011A 74 09            [12]  477 	mov	a,#0x09
      00011C C0 E0            [24]  478 	push	acc
      00011E 90 56 78         [24]  479 	mov	dptr,#0x5678
      000121 12 00 AA         [24]  480 	lcall	_mix
      000124 AC 82            [24]  481 	mov	r4, dpl
      000126 AD 83            [24]  482 	mov	r5, dph
      000128 15 81            [12]  483 	dec	sp
      00012A D0 06            [24]  484 	pop	ar6
      00012C D0 07            [24]  485 	pop	ar7
                                    486 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:13: seed = a ^ b;
      00012E EC               [12]  487 	mov	a,r4
      00012F 6E               [12]  488 	xrl	a,r6
      000130 F5 08            [12]  489 	mov	_seed,a
      000132 ED               [12]  490 	mov	a,r5
      000133 6F               [12]  491 	xrl	a,r7
      000134 F5 09            [12]  492 	mov	(_seed + 1),a
                                    493 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:14: while(1);
      000136                        494 00102$:
                                    495 ;	C:/Users/user/WorkBuddy/2026-09-26-10-47-58/mculab/tests/cases/stack_call.c:15: }
      000136 80 FE            [24]  496 	sjmp	00102$
                                    497 	.area CSEG    (CODE)
                                    498 	.area CONST   (CODE)
                                    499 	.area XINIT   (CODE)
                                    500 	.area CABS    (ABS,CODE)
