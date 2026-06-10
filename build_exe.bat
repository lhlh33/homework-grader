@echo off
setlocal
cd /d %~dp0

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
echo Building React frontend...
npm.cmd run build
if errorlevel 1 (
    echo Frontend build failed.
    pause
    exit /b 1
)

echo Installing Python dependencies...
%PY% -m pip install -r backend\requirements.txt pyinstaller
if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
)

echo Building Windows executable...
%PY% -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onedir ^
  --name HomeworkGraderPro ^
  --distpath dist_exe ^
  --workpath build_exe ^
  --hidden-import backend.app ^
  --add-data "dist;dist" ^
  desktop_launcher.py

if errorlevel 1 (
    echo EXE build failed.
    pause
    exit /b 1
)

echo.
echo Build complete:
echo %cd%\dist_exe\HomeworkGraderPro\HomeworkGraderPro.exe
echo.
pause
