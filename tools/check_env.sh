#!/usr/bin/env bash
# check_env.sh — 平台运行环境自检
# 用法：bash tools/check_env.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDCC="$ROOT/toolchain/sdcc/bin"
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

echo "================================================"
echo " 微控制器教学平台 · 环境自检"
echo "================================================"
echo
echo "[1] Node.js"
if command -v node >/dev/null 2>&1; then
  V=$(node -v)
  MAJ=$(echo "$V" | sed 's/v//' | cut -d. -f1)
  if [ "$MAJ" -ge 22 ]; then pass "node $V（≥22，支持内置 node:sqlite）"
  else bad "node $V 版本过低，需要 ≥22.5（node:sqlite）"; fi
else bad "未找到 node，请先安装 Node.js 22 LTS"; fi

echo
echo "[2] SQLite 内置模块"
if node -e "require('node:sqlite')" >/dev/null 2>&1; then pass "node:sqlite 可用（无需编译原生模块）"
else bad "node:sqlite 不可用，请升级 Node 到 22.5+"; fi

echo
echo "[3] SDCC 工具链"
if [ -x "$SDCC/sdcc.exe" ] || [ -x "$SDCC/sdcc" ]; then
  pass "找到 SDCC：$SDCC"
  VER=$(PATH="$SDCC:$PATH" "${SDCC}/sdcc.exe" --version 2>/dev/null | head -1)
  [ -n "$VER" ] && pass "版本：$(echo "$VER" | sed 's/.*TD- //')" || warn "无法执行 sdcc --version"
  if [ -x "$SDCC/packihx.exe" ] || [ -x "$SDCC/packihx" ]; then pass "packihx 存在"
  else warn "缺少 packihx（.hex 规范化会失败）"; fi
else
  bad "未找到 $SDCC"
  echo "      → 下载 https://sourceforge.net/projects/sdcc/files/sdcc-win64/ 的安装包，"
  echo "        用 7-Zip 解压到 toolchain/sdcc/ 即可（无需安装）。"
  echo "      → 没有 SDCC 时平台仍可运行：可用 '__ASM__' 内置汇编通路，或直接加载 .hex。"
fi

echo
echo "[4] 平台头文件（Keil 兼容垫片）"
for h in intrins.h reg51.h reg52.h; do
  if [ -f "$ROOT/platform/include/$h" ]; then pass "platform/include/$h"
  else warn "缺少 platform/include/$h"; fi
done

echo
echo "[5] 预编译实验产物"
N=$(ls "$ROOT/public/hex/"*.hex 2>/dev/null | wc -l)
if [ "$N" -ge 15 ]; then pass "$N 个 .hex 已就绪（学生无 SDCC 也能直接仿真）"
elif [ "$N" -gt 0 ]; then warn "仅 $N 个 .hex，建议运行 node tools/precompile.mjs"
else warn "没有预编译产物，运行 node tools/precompile.mjs"; fi

echo
echo "[6] 端口占用"
PORT="${MCULAB_PORT:-8080}"
if command -v netstat >/dev/null 2>&1; then
  if netstat -ano 2>/dev/null | grep -q ":$PORT .*LISTENING"; then
    warn "端口 $PORT 已被占用（换端口：node server/index.js --port 8090）"
  else pass "端口 $PORT 空闲"; fi
fi

echo
echo "[7] 网络（可选：大模型 / 公网部署）"
if curl -sI --max-time 5 https://registry.npmmirror.com >/dev/null 2>&1; then
  pass "外网可达（可配置在线大模型）"
else
  warn "外网不可达 —— 平台将使用离线规则助教，功能不受影响"
fi

echo
echo "================================================"
echo " 启动：node server/index.js"
echo " 访问：http://localhost:$PORT"
echo "================================================"
