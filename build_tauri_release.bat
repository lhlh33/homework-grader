@echo off
setlocal
cd /d %~dp0

set "TAURI_NONINTERACTIVE=1"
npx.cmd tauri build --bundles nsis
if errorlevel 1 exit /b %errorlevel%

if not exist dist_tauri mkdir dist_tauri
if exist release_portable rmdir /s /q release_portable
mkdir release_portable

copy /Y src-tauri\target\release\homework_grader_desktop.exe release_portable\homework_grader_desktop.exe >nul
copy /Y dist_exe\HomeworkGraderBackend.exe release_portable\HomeworkGraderBackend.exe >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'release_portable\*' -DestinationPath 'dist_tauri\HomeworkGraderDesktop_portable_latest.zip' -Force"
set "ZIP_EXIT=%errorlevel%"
rmdir /s /q release_portable
exit /b %ZIP_EXIT%
