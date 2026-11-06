/*
 * intrins.h — Keil C51 兼容的 intrins.h 替身
 * ==================================================================
 * 背景：SDCC 并不提供 <intrins.h>（这是 Keil C51 的头文件），
 *       但大量教材与实验代码（含本平台的起始代码）使用 _crol_/_cror_/_nop_。
 *       为保证学生从 Keil 迁移过来的代码可以直接编译，平台自带本头文件，
 *       并在编译时通过 -I 注入到包含路径中。
 *
 * 说明：
 *   · 旋转函数用纯 C 表达式实现，SDCC 会优化成 RR A / RL A 等单字节指令。
 *   · _nop_() 实现为空语句。真实 Keil 的 _nop_ 会插入 1 个机器周期的空操作，
 *     对本平台的实验（延时/流水灯/数码管扫描）无实质影响；
 *     若需精确时序，请直接使用 __asm 插入 nop。
 */

#ifndef MCULAB_INTRINS_H
#define MCULAB_INTRINS_H

/* ---------------- 8 位循环移位 ---------------- */
#define _crol_(a, n)  ((unsigned char)(((unsigned char)(a) << (n)) | ((unsigned char)(a) >> (8 - (n)))))
#define _cror_(a, n)  ((unsigned char)(((unsigned char)(a) >> (n)) | ((unsigned char)(a) << (8 - (n)))))

/* ---------------- 16 位循环移位 ---------------- */
#define _irol_(a, n)  ((unsigned int)(((unsigned int)(a) << (n)) | ((unsigned int)(a) >> (16 - (n)))))
#define _iror_(a, n)  ((unsigned int)(((unsigned int)(a) >> (n)) | ((unsigned int)(a) << (16 - (n)))))

/* ---------------- 32 位循环移位 ---------------- */
#define _lrol_(a, n)  ((unsigned long)(((unsigned long)(a) << (n)) | ((unsigned long)(a) >> (32 - (n)))))
#define _lror_(a, n)  ((unsigned long)(((unsigned long)(a) >> (n)) | ((unsigned long)(a) << (32 - (n)))))

/* ---------------- 空操作 / 位测试 ---------------- */
#define _nop_()       ((void)0)
#define _testbit_(b)  ((b) != 0)

#endif /* MCULAB_INTRINS_H */
