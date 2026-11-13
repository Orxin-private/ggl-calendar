@echo off
setlocal
chcp 65001 >nul
rem End SourceDirectory with a dot, never a backslash immediately before the closing quote.
rem This prevents Windows PowerShell command-line quoting from corrupting the path.
set "UPDATER=%~dp0WindowsUpdater\Update-CalendarCustomizer.ps1"
set "SOURCE=%~dp0."
if not exist "%UPDATER%" (
  echo Updater script was not found. Extract the entire ZIP before running this file.
  pause
  exit /b 1
)
echo TIP: If Chrome still shows v1.0.0, run Repair-Installed.cmd to select the real loaded folder.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%UPDATER%" -Setup -SourceDirectory "%SOURCE%"
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo Update setup failed. Exit code: %CODE%
pause
exit /b %CODE%
