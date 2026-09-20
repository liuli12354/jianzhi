@echo off
setlocal
cd /d "%~dp0"
title JianZhi Launcher

set "PORT=4321"
set "URL=http://localhost:%PORT%"

echo.
echo   JianZhi  /  Personal Knowledge Base
echo   ----------------------------------------
echo.

rem ---- 1) server already running? then just open the browser ----
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo   Server already running on port %PORT%.
  goto open
)

rem ---- 2) dependencies installed? ----
if not exist "app\server\node_modules" (
  echo   Dependencies are not installed yet.
  echo   Run this once in this folder:
  echo.
  echo       npm install
  echo       npm run setup
  echo.
  pause
  exit /b 1
)

rem ---- 3) frontend build present? ----
if not exist "app\web\dist\index.html" (
  echo   Building frontend, first run only...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   Build failed. See the output above.
    pause
    exit /b 1
  )
  echo.
)

rem ---- 4) start the server ----
echo   Starting server on port %PORT% ...
start "JianZhi Server" /min cmd /c "npm start"

rem ---- 5) wait for the port to open, up to 30s ----
set /a tries=0
:wait
set /a tries+=1
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto open
if %tries% geq 30 (
  echo.
  echo   Server did not come up within 30 seconds.
  echo   Open the minimized "JianZhi Server" window to see the error.
  echo.
  pause
  exit /b 1
)
rem ping-based sleep: "timeout" aborts when stdin is redirected
ping -n 2 127.0.0.1 >nul
goto wait

:open
echo   Opening %URL%
start "" "%URL%"
echo.
echo   Ready. You can close this window.
ping -n 4 127.0.0.1 >nul
exit /b 0
