@echo off
setlocal
cd /d %~dp0

start "Homework Grader API" cmd /k run_backend.bat
echo Waiting for FastAPI backend...
for /l %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 goto :backend_ready
    timeout /t 1 >nul
)

echo Backend did not start. Please check the Homework Grader API window.
pause
exit /b 1

:backend_ready
echo Backend is ready: http://127.0.0.1:8765
npm.cmd run dev -- --configLoader runner --host 127.0.0.1 --port 4173
