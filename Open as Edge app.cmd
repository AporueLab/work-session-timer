@echo off
setlocal

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if not exist "%EDGE%" (
  echo Microsoft Edge could not be found.
  pause
  exit /b 1
)

for %%I in ("%~dp0index.html") do set "APP_PATH=%%~fI"
start "" "%EDGE%" --app="file:///%APP_PATH:\=/%" --window-size=390,360
