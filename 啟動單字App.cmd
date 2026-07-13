@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)

call npm run build
if errorlevel 1 exit /b 1

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://127.0.0.1:4173'"
call npm start
