@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-OpenRecall.ps1" -Mode Normal
exit /b %ERRORLEVEL%
