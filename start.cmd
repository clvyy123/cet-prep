@echo off
rem ============================================================
rem  CET Prep - one-click launcher
rem
rem  Usage:  double-click this file, or from a terminal:
rem     start.cmd            dev mode  (Vite hot reload + Electron)
rem     start.cmd soft       dev mode with no-GPU / sandbox switches
rem     start.cmd prod       build, then run the production app
rem     start.cmd check      environment diagnosis only, no launch
rem
rem  Content is intentionally ASCII-only: this folder path may
rem  contain non-ASCII characters and .bat files are read using
rem  the console code page.
rem ============================================================

setlocal
cd /d "%~dp0"
title CET Prep - Launcher

set "MODE=%~1"
if /i "%MODE%"=="check"   goto :check
if /i "%MODE%"=="prod"    goto :prod
if /i "%MODE%"=="build"   goto :prod
if /i "%MODE%"=="soft"    goto :devsoft
if /i "%MODE%"=="gpu-off" goto :devsoft

rem Auto-detect a sandbox/embedded session: the host injects
rem ELECTRON_RUN_AS_NODE, which breaks electron's main process.
if defined ELECTRON_RUN_AS_NODE goto :devsoft
goto :dev


rem ------------------------------------------------------------ dev
:dev
call :banner
echo   mode: dev
echo.
call :neednode
if errorlevel 1 goto :fail
call :needdeps
if errorlevel 1 goto :fail
call :freecheck 5173
echo.
echo   starting Vite + Electron ...
echo   close this window to quit. keep it open while you use the app.
echo.
call npm run dev
goto :end


rem --------------------------------------------------- dev, soft GPU
:devsoft
call :banner
echo   mode: dev, soft rendering - no sandbox, software GPU
echo.
call :neednode
if errorlevel 1 goto :fail
call :needdeps
if errorlevel 1 goto :fail
call :freecheck 5173
echo.
echo   starting Vite + Electron ...
echo   close this window to quit. keep it open while you use the app.
echo.
call npm run dev:soft
goto :end


rem ----------------------------------------------------------- prod
:prod
call :banner
echo   mode: production build
echo.
call :neednode
if errorlevel 1 goto :fail
call :needdeps
if errorlevel 1 goto :fail
echo   [..] building, this takes a while
call npm run build
if errorlevel 1 (
  echo   [x] build failed
  goto :fail
)
echo   [ok] build finished
echo   [..] launching app
echo.
call node scripts\launch-electron.mjs .
goto :end


rem ---------------------------------------------------------- check
:check
call :banner
echo   mode: diagnosis only, nothing will be launched
echo.
call :neednode
call :needdeps
call :freecheck 5173
echo.
if defined ELECTRON_RUN_AS_NODE (
  echo   [!] ELECTRON_RUN_AS_NODE is set - embedded session, use: start.cmd soft
) else (
  echo   [ok] ELECTRON_RUN_AS_NODE not set
)
if defined VITE_DEV_SERVER_URL (
  echo   [!] VITE_DEV_SERVER_URL is set to %VITE_DEV_SERVER_URL%
) else (
  echo   [ok] VITE_DEV_SERVER_URL not set
)
echo.
pause
exit /b 0


rem ----------------------------------------------------- subroutines
:banner
echo.
echo   ==========================================================
echo     CET Prep - one-click launcher
echo   ==========================================================
echo.
exit /b 0

:neednode
where node >nul 2>&1
if errorlevel 1 (
  echo   [x] Node.js not found. Install Node 18 or newer:
  echo       https://nodejs.org
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [ok] node %%v
exit /b 0

:needdeps
if exist "node_modules\electron\package.json" (
  echo   [ok] dependencies present
  exit /b 0
)
echo   [..] dependencies missing, running npm install - can take minutes
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo   [x] npm install failed. check your network and proxy settings.
  exit /b 1
)
echo   [ok] dependencies installed
exit /b 0

:freecheck
set "BUSY="
for /f "delims=" %%a in ('netstat -ano ^| findstr /c:":%~1 " ^| findstr /c:"LISTENING"') do set "BUSY=1"
if defined BUSY (
  echo   [!] port %~1 is already in use - a previous run may still be alive.
  echo       Close the old Vite or Electron window, or press any key to continue.
  pause >nul
) else (
  echo   [ok] port %~1 is free
)
exit /b 0

:fail
echo.
echo   startup aborted.
pause
exit /b 1

:end
echo.
echo   app closed.
pause
exit /b 0
