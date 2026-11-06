#!/usr/bin/env bash
# precompile_experiments.sh
# 用 SDCC 预编译所有内置实验，生成 public/hex/<id>.hex。
# 用途：学生即使在没有 SDCC 的部署环境下，也能直接加载成品 .hex 运行仿真。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
OUT="$ROOT/public/hex"
SRC="$ROOT/data/experiments"
export PATH="$SDCC:$PATH"
mkdir -p "$OUT"
ok=0; bad=0
for c in "$SRC"/*.c; do
  [ -e "$c" ] || continue
  id="$(basename "$c" .c)"
  printf '%-18s ' "$id"
  if ! sdcc.exe -mmcs51 --model-small --stack-auto --std-c11 --opt-code-speed -I "$ROOT/platform/include" \
        -o "$OUT/$id.ihx" "$c" > "$OUT/$id.build.log" 2>&1; then
    echo "编译失败"; tail -3 "$OUT/$id.build.log" | sed 's/^/    /'; bad=$((bad+1)); continue
  fi
  packihx.exe "$OUT/$id.ihx" > "$OUT/$id.hex" 2>/dev/null
  rm -f "$OUT/$id.ihx"
  if [ -s "$OUT/$id.hex" ]; then
    echo "OK  ($(grep -c '^:' "$OUT/$id.hex") 条记录, $(wc -c < "$OUT/$id.hex") 字节)"
    ok=$((ok+1))
  else
    echo "HEX 为空"; bad=$((bad+1))
  fi
done
echo
echo "完成：$ok 成功 / $bad 失败   →  $OUT"
