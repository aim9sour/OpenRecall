@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-openrecall.ps1"
exit /b %ERRORLEVEL%
