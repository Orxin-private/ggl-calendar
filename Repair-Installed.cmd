@echo off
setlocal
chcp 65001 >nul
set "REPAIR=%~dp0WindowsUpdater\Repair-Installed.ps1"
set "SOURCE=%~dp0."
if not exist "%REPAIR%" (
  echo ERROR: Repair script not found. Please fully extract the ZIP first.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPAIR%" -SourceDirectory "%SOURCE%"
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo Repair failed. Exit code: %CODE%
pause
exit /b %CODE%
