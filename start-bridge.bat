@echo off
REM TARS-Switcher bridge launcher (Windows).
REM Runs the bridge and auto-restarts it if it ever exits.
REM
REM One-time setup, set the Ably key as a persistent env var (survives reboots):
REM     setx ABLY_API_KEY "appId.keyId:secret"
REM
REM Run at logon: put a copy (or shortcut) of this file in the Startup folder:
REM     copy start-bridge.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\"
REM
REM OBS auth: leave OBS WebSocket auth off, or also: setx OBS_PASSWORD "..."

cd /d "%~dp0"

:loop
node bridge\server.js
echo.
echo Bridge exited; restarting in 5s...  (close this window to stop)
timeout /t 5 /nobreak >nul
goto loop
