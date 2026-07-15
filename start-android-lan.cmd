@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)

set "HOST=0.0.0.0"
set "PORT=4176"
if not defined API_EDIT_PASSWORD set "API_EDIT_PASSWORD=morpheme-local"

echo Starting Morpheme Desk for Android LAN access at port %PORT%...
call npm start
