@echo off
setlocal
cd /d %~dp0

set "EXIT_CODE=0"

where py >nul 2>nul
if %errorlevel%==0 (
    set "PY=py"
    goto :found_python
)

where python >nul 2>nul
if %errorlevel%==0 (
    set "PY=python"
    goto :found_python
)

echo Python was not found. Please install Python 3 and add it to PATH.
pause
exit /b 1

:found_python
%PY% -m pip install -r backend\requirements.txt
if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    set "EXIT_CODE=1"
    goto :done
)

%PY% -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
if errorlevel 1 (
    echo.
    echo Backend exited with an error.
    set "EXIT_CODE=1"
)

:done
echo.
pause
exit /b %EXIT_CODE%
