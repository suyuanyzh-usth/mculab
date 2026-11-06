#!/usr/bin/env bash
# sdcc_states.sh <caseName> <K>
# 用 ucsim_51 逐步执行 K 条指令，每步输出一行：
#     PC PSW ACC B SP DPTR R0 R1 R2 R3 R4 R5 R6 R7
# 用于与本地内核做"逐指令体系结构状态"比对，可精确定位首个不一致的指令。
#
# ucsim 输出结构（每次 step 后）：
#     Stop at 0x....: ... stepped N ticks
#          R0 R1 R2 R3 R4 R5 R6 R7
#          <8 个十六进制字节>
#     @R0 .. v  ACC= 0x.. .. B= 0x..
#     @R1 .. .. PSW= 0x.. CY=.. ...
#     SP 0x.. -> .. ..
#        DPTR= 0x........ @DPTR= ..
#     0x....  .. ..   <反汇编>
#     F 0x....
#     ...
#     CPU state= OK PC= 0x........ frequency= ...      <-- PC 在块尾
# 即寄存器 dump 在 PC 行之前，二者属于同一步。
#
# 注意：ucsim_51 是 Windows 原生程序，不认 git-bash 的 /c/... 路径，
#       故切换到 fixtures 目录并用裸文件名调用。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
FIX="$ROOT/tests/fixtures"
NAME="${1:?用法: sdcc_states.sh <caseName> <K>}"
K="${2:-200}"
export PATH="$SDCC:$PATH"

{
  echo "reset"
  for ((i=0;i<K;i++)); do
    echo "step 1"
    echo "state"
  done
  echo "q"
} > "$FIX/$NAME.states.cmd"

( cd "$FIX" && ucsim_51.exe -t 51 -c - "$NAME.ihx" < "$NAME.states.cmd" ) > "$FIX/$NAME.states.raw" 2>&1

awk '
function val(key,   p, s) {          # 提取 "<key> ... 0xHH.." 中的 0xHH..
  p = index($0, key);
  if (p == 0) return "";
  s = substr($0, p + length(key));
  sub(/^[ =]+/, "", s);
  if (match(s, /^0x[0-9a-fA-F]+/)) return substr(s, RSTART, RLENGTH);
  return "";
}
/PC= *0x[0-9a-fA-F]+ +frequency/ {
  # 一个状态块结束：PC 行在块尾，其前面是本步的寄存器 dump
  if (n++ > 0) print pc, psw, acc, b, sp, dptr, regs;
  pc = val("PC="); psw = "0x?"; acc = "0x?"; b = "0x?"; sp = "0x?"; dptr = "0x?";
  regs = "- - - - - - - -"; wantRegs = 0;
  next;
}
wantRegs { gsub(/^ +| +$/, ""); gsub(/ +/, " ", $0); regs = $0; wantRegs = 0; next }
/R0 R1 R2 R3 R4 R5 R6 R7/ { wantRegs = 1; next }
/ACC= *0x/ { acc = val("ACC="); b = val("B=") }
/PSW= *0x/ { psw = val("PSW=") }
/^SP +0x/  { sp  = val("SP") }
/^ *DPTR= *0x/ { dptr = val("DPTR=") }
END { if (n > 0) print pc, psw, acc, b, sp, dptr, regs }
' "$FIX/$NAME.states.raw" > "$FIX/$NAME.states.txt"

wc -l < "$FIX/$NAME.states.txt"
