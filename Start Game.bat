@echo off
setlocal
cd /d "%~dp0"
title Solo D^&D
echo.
echo  ==============================
echo     Solo D^&D - starting up
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Node.js is not installed. Please run Setup.bat first.
  echo        ^(or install Node.js LTS from https://nodejs.org^)
  pause
  exit /b 1
)

node scripts\check-deps.mjs --start
set CHECK=%errorlevel%
if "%CHECK%"=="3" (
  start "" http://127.0.0.1:3210
  exit /b 0
)
if not "%CHECK%"=="0" (
  echo.
  pause
  exit /b 1
)

echo.
echo The game is opening in your browser.
echo Keep this window open while you play. Close it to stop the game.
echo.
echo Playing with a friend on the same network? Turn on Settings ^> Table ^> Allow a friend to join,
echo restart the game, and allow Node.js on private networks if Windows Firewall asks.
echo.
set OPEN_BROWSER=1
call npm start --silent
echo.
echo The game server has stopped.
pause
endlocal
