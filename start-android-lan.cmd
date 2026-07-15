@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-android-lan.ps1"
exit /b %errorlevel%
