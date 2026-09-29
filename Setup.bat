@echo off
setlocal
cd /d "%~dp0"
title Solo D^&D - Setup
echo.
echo  ==============================
echo     Solo D^&D - first-time setup
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

node scripts\check-deps.mjs --setup %*
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the messages above, fix the problem, and run Setup.bat again.
  pause
  exit /b 1
)
pause
exit /b 0

:nonode
echo Node.js is not installed. It is needed to run the game.
where winget >nul 2>nul
if errorlevel 1 goto :manualnode
choice /M "Install Node.js LTS now with winget"
if errorlevel 2 goto :manualnode
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo Node.js was installed. Close this window and run Setup.bat again.
pause
exit /b 0

:manualnode
echo Please install Node.js LTS from https://nodejs.org and then run Setup.bat again.
pause
exit /b 1
