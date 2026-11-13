@echo off
setlocal
chcp 65001 >nul
set "HELPER=%LOCALAPPDATA%\GCalCustomizerUpdater\Update-CalendarCustomizer.ps1"
if not exist "%HELPER%" (
  echo The updater is not installed. Run Install-or-Update.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%HELPER%" -Manual
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%
