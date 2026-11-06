@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  MCU Lab - Microcontroller Teaching Lab
echo ============================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22+ not found. Please install from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting server... (close this window to stop)
echo.
node "server\index.js" %*
echo.
echo Server stopped.
pause
