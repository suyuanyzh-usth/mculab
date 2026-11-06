#!/usr/bin/env bash
# start.sh — 一键启动（Linux / macOS / Git Bash）
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请安装 22.5+ ： https://nodejs.org/" >&2
  exit 1
fi
echo "正在启动… 关闭终端即停止服务"
exec node server/index.js "$@"
