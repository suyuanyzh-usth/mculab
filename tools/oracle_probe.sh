#!/usr/bin/env bash
# oracle_probe.sh <caseName> <K>
# 输出 ucsim_51 执行 K 条指令后的体系结构状态（一行，十六进制，无前缀）：
#     PC PSW ACC B SP DPTR R0 R1 R2 R3 R4 R5 R6 R7
#
# 可靠性说明：ucsim 的控制台会回显 stdin。当命令很多时，回显会与输出交错，
# 导致行解析错位（实测 830 条 step 时出现 "stCPU state= OK ..." 这类残行）。
# 因此这里只使用 4 条命令（state / step K / state / q），实测输出不会错位。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
FIX="$ROOT/tests/fixtures"
NAME="${1:?用法: oracle_probe.sh <caseName> <K>}"
K="${2:?缺少步数 K}"
export PATH="$SDCC:$PATH"

TMPD="$(mktemp -d)"
printf 'state\nstep %s\nstate\nq\n' "$K" > "$TMPD/one.cmd"
cp "$FIX/$NAME.ihx" "$TMPD/" 2>/dev/null || true
( cd "$TMPD" && ucsim_51.exe -t 51 -c - "$NAME.ihx" < one.cmd ) > "$TMPD/one.raw" 2>&1

awk '
function val(key,   p, s) {
  p = index($0, key); if (p == 0) return "";
  s = substr($0, p + length(key)); sub(/^[ =]+/, "", s);
  if (match(s, /^0x[0-9a-fA-F]+/)) { s = substr(s, RSTART+2, RLENGTH-2); return s }
  return "";
}
function norm(h,   i, o) {          # 去掉前导 0，小写
  h = tolower(h); sub(/^0+/, "", h); if (h == "") h = "0"; return h
}
/PC= *0x[0-9a-fA-F]+ +frequency/ { pc = norm(val("PC=")) }
/Total time since last reset/ { match($0, /\([0-9]+ clks\)/); if (RSTART) { c = substr($0, RSTART+1, RLENGTH-6); clks = c+0 } }
/ACC= *0x/ { acc = norm(val("ACC=")); b = norm(val("B=")) }
/PSW= *0x/ { psw = norm(val("PSW=")) }
/^SP +0x/  { sp  = norm(val("SP")) }
/^ *DPTR= *0x/ { dptr = norm(val("DPTR=")) }
/R0 R1 R2 R3 R4 R5 R6 R7/ { wantRegs = 1; next }
wantRegs { gsub(/^ +| +$/, ""); gsub(/ +/, " ", $0); regs = $0; wantRegs = 0 }
END {
  n = split(regs, a, " ");
  for (i = 1; i <= n; i++) a[i] = norm(a[i]);
  regs = "";
  for (i = 1; i <= n; i++) regs = regs (i > 1 ? " " : "") a[i];
  print pc, psw, acc, b, sp, dptr, clks, regs;
}
' "$TMPD/one.raw"
rm -rf "$TMPD" 2>/dev/null || true
