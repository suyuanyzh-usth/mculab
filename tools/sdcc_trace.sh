#!/usr/bin/env bash
# sdcc_trace.sh <caseName> <K>
# 用 ucsim_51 逐步执行 K 条指令，输出每步之后的 PC（每行一个十进制数）。
# 用途：与本地内核的 PC 轨迹比对，定位"第一条行为不一致的指令"。
#
# 注意：ucsim_51 是 Windows 原生程序，不认 git-bash 的 /c/... 路径，
#       故切换到 fixtures 目录并用裸文件名调用。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
FIX="$ROOT/tests/fixtures"
NAME="${1:?用法: sdcc_trace.sh <caseName> <K>}"
K="${2:-200}"

export PATH="$SDCC:$PATH"

# 生成命令序列：先 reset，然后 K 次 (step 1 ; state)
{
  echo "reset"
  for ((i=0;i<K;i++)); do
    echo "step 1"
    echo "state"
  done
  echo "q"
} > "$FIX/$NAME.trace.cmd"

( cd "$FIX" && ucsim_51.exe -t 51 -c - "$NAME.ihx" < "$NAME.trace.cmd" ) \
  | grep -oE 'PC= 0x[0-9a-fA-F]+ frequency' \
  | grep -oE '0x[0-9a-fA-F]+' \
  | sed 's/^0x//' \
  | while read -r h; do printf '%d\n' "0x$h"; done
