@echo off
chcp 65001 >nul
title MCU Lab - Public Access
cd /d "%~dp0.."

REM ============================================================
REM  Start MCU Lab and expose it to the internet via Pinggy (SSH over 443).
REM
REM  WHY THIS LOOKS ODD:
REM    2026-11-04 实测，本校网络的 DNS 会过滤掉隧道服务域名：
REM      a.pinggy.io / serveo.net / localhost.run 全部解析失败，
REM    但公共 DNS 能解析出 a.pinggy.io = 139.162.21.36。
REM    因此这里**直接用 IP 连接**，绕过 DNS。IP 变化时改下面这一行即可。
REM
REM    另一条路 Cloudflare 隧道在当前网络也不通（7844 端口被阻断）。
REM
REM  LIMITS（免费隧道通病，务必知道）：
REM    · 60 分钟后过期，需要重新双击本脚本
REM    · 每次重启地址都会变
REM    · 偶发超时（重试即可）
REM  长期使用请按 docs/08-Render部署指南.md 部署到云平台。
REM ============================================================
set PINGGY_HOST=139.162.21.36

echo.
echo [1/2] Starting MCU Lab server on port 8080 ...
start "MCU Lab Server" cmd /c "node server\index.js --port 8080"
timeout /t 3 >nul

echo [2/2] Opening public tunnel via Pinggy ...
echo.
echo   Wait a few seconds, then look for a line like:
echo       https://xxxx-xxx-xxx-xx.free.pinggy.net
echo   Use the *.free.pinggy.net one and share it with students.
echo.
echo   Keep this window open. Closing it takes the site offline.
echo.

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ^
    -o ServerAliveInterval=30 -o TCPKeepAlive=yes -o ConnectTimeout=15 ^
    -p 443 -R0:localhost:8080 %PINGGY_HOST%

echo.
echo Tunnel stopped. Public access is now offline.
pause
