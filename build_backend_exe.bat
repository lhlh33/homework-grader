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
echo Installing Python backend dependencies...
%PY% -m pip install -r backend\requirements.txt pyinstaller
if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
)

echo Building backend executable...
%PY% -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onedir ^
  --noconsole ^
  --name HomeworkGraderBackend ^
  --hidden-import win32com ^
  --hidden-import win32com.client ^
  --hidden-import pythoncom ^
  --hidden-import pywintypes ^
  --distpath dist_exe ^
  --workpath build_backend ^
  backend\app.py

if errorlevel 1 (
    echo Backend EXE build failed.
    pause
    exit /b 1
)

set "TARGET_TRIPLE="
for /f "delims=" %%T in ('rustc --print host-tuple 2^>nul') do set "TARGET_TRIPLE=%%T"
if not defined TARGET_TRIPLE set "TARGET_TRIPLE=x86_64-pc-windows-msvc"

if not exist src-tauri\binaries mkdir src-tauri\binaries
copy /Y dist_exe\HomeworkGraderBackend\HomeworkGraderBackend.exe src-tauri\binaries\HomeworkGraderBackend-%TARGET_TRIPLE%.exe >nul
if errorlevel 1 (
    echo Failed to copy sidecar executable into src-tauri\binaries.
    pause
    exit /b 1
)

echo.
echo Build complete:
echo %cd%\dist_exe\HomeworkGraderBackend\HomeworkGraderBackend.exe
echo %cd%\src-tauri\binaries\HomeworkGraderBackend-%TARGET_TRIPLE%.exe
echo.
if not defined TAURI_NONINTERACTIVE pause
