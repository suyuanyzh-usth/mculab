#!/usr/bin/env bash
# find_divergence.sh <caseName> <N>
# 二分查找"本平台内核与 ucsim_51 出现首个体系结构状态不一致的指令序号"。
#
# 前置：先运行  node tests/dump_states.mjs <caseName> <N>
#       生成 tests/fixtures/<caseName>.mine.states.txt
#
# 判定：比较 PC PSW ACC B SP DPTR R0..R7 全部字段。
#       注意 R0..R7 中未被程序写入的寄存器在两个模拟器里初值不同
#       （ucsim 的 IRAM 初值非零），因此对 K=0 不比较，并且当"仅 R 不同"
#       时标记为 SOFT（可能只是初值差异），全字段不同标记为 HARD。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/tests/fixtures"
NAME="${1:?用法: find_divergence.sh <caseName> <N>}"
N="${2:-3000}"
MINE="$FIX/$NAME.mine.states.txt"
[ -f "$MINE" ] || { echo "缺少 $MINE，请先运行: node tests/dump_states.mjs $NAME $N"; exit 2; }

mine_at() {  # $1 = K  ->  第 K+1 行；FIELDS=core 时只取前 6 个确定性字段
  sed -n "$(( $1 + 1 ))p" "$MINE"
}

# ucsim 的 IRAM 初值非零（实测恒为 41 58 fc c9 8b bc 95 6b），
# 且 `fill` 命令对本 CPU 的 IRAM 无效，因此默认只比对确定性字段
# PC PSW ACC B SP DPTR；置 FIELDS=all 可连同 R0..R7 一起比较。
FIELDS="${FIELDS:-core}"
trim() {
  if [ "$FIELDS" = "all" ]; then cat; else awk '{ print $1, $2, $3, $4, $5, $6 }'; fi
}

judge() {    # $1 = K  ->  0=一致 1=不一致
  local k="$1" a b
  a="$(mine_at "$k" | trim)"
  b="$(oracle_probe.sh "$NAME" "$k" | trim)"
  [ "$a" = "$b" ]
}

# 先确认端点
if judge "$N"; then echo "K=$N 一致，无需查找"; exit 0; fi

lo=0; hi="$N"
if ! judge 1; then
  echo "K=1 即不一致 —— 很可能不是执行差异而是初值差异："
  echo "  oracle: $(oracle_probe.sh "$NAME" 1 | trim)"
  echo "  mine  : $(mine_at 1 | trim)"
  exit 0
fi
while [ $(( hi - lo )) -gt 1 ]; do
  mid=$(( (lo + hi) / 2 ))
  if judge "$mid"; then lo=$mid; else hi=$mid; fi
done

echo "======================================================"
echo "用例 $NAME : 首个状态不一致出现在 K = $hi 条指令之后"
echo "  K=$lo (一致)  : $(mine_at "$lo" | trim)"
echo "  K=$hi (不一致): oracle= $(oracle_probe.sh "$NAME" "$hi" | trim)"
echo "                  mine  = $(mine_at "$hi" | trim)"
echo "  K=$(( hi - 1 )) : 此前的状态 ——"
echo "                  oracle= $(oracle_probe.sh "$NAME" "$(( hi - 1 ))" | trim)"
echo "                  mine  = $(mine_at "$(( hi - 1 ))" | trim)"
echo "======================================================"
