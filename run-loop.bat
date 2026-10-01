@echo off
setlocal EnableDelayedExpansion
title Solo DnD Build Loop
cd /d "%~dp0"
REM UTF-8 console so the live feed's symbols render
chcp 65001 >nul

REM ============ SETTINGS ============
REM Max assignments to run before stopping (safety cap)
set MAX_RUNS=40
REM Max agent turns per session
set MAX_TURNS=150
REM Seconds to wait before retrying after a crash or usage limit
set RETRY_WAIT=300
REM Consecutive crashes allowed before giving up
set MAX_CRASHES=3
REM --- Usage-limit mode (starts after the normal retries fail on a usage limit) ---
REM Seconds between usage-limit retries (600 = 10 min)
set LIMIT_WAIT=600
REM Number of usage-limit retries (12 x 10 min = 2 hours)
set LIMIT_MAX_TRIES=30
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
set LIMIT_TRIES=0

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

REM Locale-independent timestamp (the %time% format differs per region)
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set STAMP=%%t
set LOG=logs\run_!RUN!_!STAMP!

echo.
echo ================================================
echo  Session !RUN! / %MAX_RUNS%   ^(log: !LOG!.log^)
echo  Create STOP.txt in this folder to stop after this session.
echo ================================================
node scripts\loop-watch.mjs --next
echo.

REM Each call = new session, clean context, model Opus 5.5.
REM loop-watch.mjs prints the stream-json live + logs it.                    
claude -p "Follow CLAUDE.md exactly: read brain.md, complete exactly ONE assignment using the Session Protocol, update brain.md, commit, and write loop_status.txt. At most one helper subagent at a time (CLAUDE.md section 2)." --model claude-opus-5-5 --permission-mode acceptEdits --max-turns %MAX_TURNS% --output-format stream-json --verbose 2>&1 | node scripts\loop-watch.mjs "!LOG!"

set STATUS=
set /p STATUS=<loop_status.txt
for /f "tokens=* delims= " %%s in ("!STATUS!") do set STATUS=%%s
echo Status: !STATUS!

if /i "!STATUS!"=="CONTINUE" (
  set CRASHES=0
  set LIMIT_TRIES=0
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

REM Anything else = crash, usage limit, or max-turns hit without a status write.
REM Check this session's log(s) for a usage-limit message.
set USAGE_LIMIT=0
findstr /i /m /c:"hit your" /c:"session limit" /c:"weekly limit" /c:"usage limit" /c:"limit reached" /c:"rate_limit_error" "!LOG!*" >nul 2>nul && set USAGE_LIMIT=1
if "!USAGE_LIMIT!"=="1" (
  echo [INFO] Log shows a usage limit.
)

REM Already in usage-limit mode? Handle it there.
if !LIMIT_TRIES! GTR 0 goto limit_mode

set /a CRASHES+=1
echo [WARN] Session ended without a valid status ^(crash !CRASHES!/%MAX_CRASHES%^). Last log: !LOG!.log
if !CRASHES! GEQ %MAX_CRASHES% (
  if "!USAGE_LIMIT!"=="1" goto limit_mode
  echo Too many consecutive failures. Check the latest logs, then run again.
  goto end
)
echo Waiting %RETRY_WAIT% seconds before retrying ^(may be a usage limit^)...
timeout /t %RETRY_WAIT% /nobreak >nul
set /a RUN-=1
goto loop

:limit_mode
if not "!USAGE_LIMIT!"=="1" (
  echo [ERROR] Session failed for a reason other than the usage limit. Stopping.
  echo Check the latest log: !LOG!.log
  goto end
)
if !LIMIT_TRIES! GEQ %LIMIT_MAX_TRIES% (
  echo [ERROR] Still hitting the usage limit after %LIMIT_MAX_TRIES% slow retries. Stopping.
  echo Run this script again once your usage has reset.
  goto end
)
set /a LIMIT_TRIES+=1
echo Usage-limit mode: retry !LIMIT_TRIES!/%LIMIT_MAX_TRIES% in %LIMIT_WAIT% seconds...
echo Create STOP.txt to stop instead.
timeout /t %LIMIT_WAIT% /nobreak >nul
set /a RUN-=1
goto loop

:end
echo.
pause
endlocal