#!/usr/bin/env bash
# make_oracle_fixtures.sh
# 用途：用 SDCC 编译测试用例，并用 SDCC 自带 ucsim_51 生成"黄金参照"状态文件。
# 产物：tests/fixtures/<name>.ihx   编译产物
#       tests/fixtures/<name>.oracle.txt  ucsim 执行 3000 条指令后的状态 dump
# 说明：本脚本用 bash 直接调用 SDCC（不依赖 Node 的 child_process）。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
FIX="$ROOT/tests/fixtures"
CASES="$ROOT/tests/cases"
STEPS="${STEPS:-3000}"

export PATH="$SDCC:$PATH"
mkdir -p "$FIX"

echo "SDCC  = $SDCC"
echo "FIX   = $FIX"
echo "STEPS = $STEPS"
echo

ok=0; bad=0
for c in "$CASES"/*.c; do
  [ -e "$c" ] || continue
  name="$(basename "$c" .c)"
  printf '%-16s ' "$name"
  # ---- 编译 ----
  if ! sdcc.exe -mmcs51 --model-small --stack-auto -o "$FIX/$name.ihx" "$c" > "$FIX/$name.build.log" 2>&1; then
    echo "编译失败（见 $name.build.log）"; bad=$((bad+1)); continue
  fi
  # ---- ucsim 参照 ----
  # 注意：ucsim_51 是 Windows 原生程序，无法识别 git-bash 的 /c/... 路径，
  #       因此切换到 fixtures 目录并用裸文件名调用，否则会静默跑 NOP。
  printf 'state\nstep %s\nstate\nq\n' "$STEPS" > "$FIX/$name.cmd"
  if ! ( cd "$FIX" && ucsim_51.exe -t 51 -c - "$name.ihx" < "$name.cmd" ) > "$FIX/$name.oracle.txt" 2>&1; then
    echo "ucsim 执行异常"; bad=$((bad+1)); continue
  fi
  if grep -q "no loadable file found" "$FIX/$name.oracle.txt"; then
    echo "ucsim 未载入程序（路径问题）"; bad=$((bad+1)); continue
  fi
  if ! grep -q "Inst=" "$FIX/$name.oracle.txt"; then
    echo "ucsim 未产出状态"; bad=$((bad+1)); continue
  fi
  # ---- 同时产出 hex，供学生端使用 ----
  packihx.exe "$FIX/$name.ihx" > "$FIX/$name.hex" 2>/dev/null
  size=$(wc -c < "$FIX/$name.ihx")
  echo "OK  (ihx ${size}B)"
  ok=$((ok+1))
done

echo
echo "完成：$ok 成功 / $bad 失败"
[ "$bad" -eq 0 ]
