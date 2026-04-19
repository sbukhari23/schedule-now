@echo off
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not exist "dist\index.html" (
  call npm run build
)

start "Schedule Now Server" cmd /c "cd /d "%APP_DIR%" & npx vite preview --host 127.0.0.1 --port 4173"
timeout /t 3 /nobreak > nul
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=http://127.0.0.1:4173
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=http://127.0.0.1:4173
) else (
  start "" chrome --app=http://127.0.0.1:5173
)
