@echo off
setlocal EnableDelayedExpansion
title Solo D&D Build Loop
cd /d "%~dp0"

REM ============ SETTINGS ============
REM Max assignments to run before stopping (safety cap)
set MAX_RUNS=40
REM Max agent turns per session
set MAX_TURNS=150
REM Seconds to wait before retrying after a crash or usage limit
set RETRY_WAIT=300
REM Consecutive crashes allowed before giving up
set MAX_CRASHES=3
REM ==================================

where claude >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Claude Code ^(claude^) was not found on PATH. Install it first.
  pause
  exit /b 1
)
if not exist "brain.md" (
  echo [ERROR] brain.md not found in %cd%
  pause
  exit /b 1
)
if not exist "logs" mkdir logs

set RUN=0
set CRASHES=0

:loop
if exist "STOP.txt" (
  echo STOP.txt found - stopping gracefully. Delete it to resume later.
  goto end
)
if !RUN! GEQ %MAX_RUNS% (
  echo Reached MAX_RUNS=%MAX_RUNS%. Run this script again to continue.
  goto end
)
set /a RUN+=1

REM Mark as RUNNING so a crash without a status write is detectable
>loop_status.txt echo RUNNING

for /f "tokens=1-3 delims=/:. " %%a in ("%time%") do set STAMP=%%a%%b%%c
set STAMP=!STAMP: =0!
set LOG=logs\run_!RUN!_!STAMP!.log

echo.
echo ================================================
echo  Session !RUN! / %MAX_RUNS%   ^(log: !LOG!^)
echo  Create STOP.txt in this folder to stop after this session.
echo ================================================

REM Each call is a brand-new session = fresh, cleared context.
claude -p "Follow CLAUDE.md exactly: read brain.md, complete exactly ONE assignment using the Session Protocol, update brain.md, commit, and write loop_status.txt. Do not use subagents." --permission-mode acceptEdits --max-turns %MAX_TURNS% > "!LOG!" 2>&1

set STATUS=
set /p STATUS=<loop_status.txt
for /f "tokens=* delims= " %%s in ("!STATUS!") do set STATUS=%%s
echo Status: !STATUS!

if /i "!STATUS!"=="CONTINUE" (
  set CRASHES=0
  goto loop
)
if /i "!STATUS!"=="DONE" (
  echo.
  echo *** BUILD COMPLETE. See brain.md and README.md. ***
  goto end
)
if /i "!STATUS!"=="BLOCKED" (
  echo.
  echo *** BLOCKED - Claude needs you. Open brain.md, section "Blockers / Owner Review". ***
  echo Fix the issue, then run this script again.
  goto end
)

REM Anything else = crash, usage limit, or max-turns hit without a status write
set /a CRASHES+=1
echo [WARN] Session ended without a valid status ^(crash !CRASHES!/%MAX_CRASHES%^). Last log: !LOG!
if !CRASHES! GEQ %MAX_CRASHES% (
  echo Too many consecutive failures. Check the latest logs, then run again.
  goto end
)
echo Waiting %RETRY_WAIT% seconds before retrying ^(may be a usage limit^)...
timeout /t %RETRY_WAIT% /nobreak >nul
set /a RUN-=1
goto loop

:end
echo.
pause
endlocal
