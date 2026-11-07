@echo off
rem ============================================================
rem ScreenSync - start everything on the department PC
rem
rem Dashboard, TV pages and API all run on port 3000:
rem   Dashboard  http://<this-pc-ip>:3000/
rem   TV pages   http://<this-pc-name>:3000/tv/?mode=lan  and  ?mode=wifi
rem
rem If the server stops for any reason it is started again after
rem 5 seconds. Close this window to stop ScreenSync.
rem ============================================================
setlocal
cd /d "%~dp0"
title ScreenSync

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem MongoDB normally runs as a Windows service; try to start it in case it is stopped
net start MongoDB >nul 2>nul

if not exist "backend\node_modules" (
  echo Installing backend packages...
  pushd backend
  call npm install
  popd
)
if not exist "frontend\node_modules" (
  echo Installing dashboard packages...
  pushd frontend
  call npm install
  popd
)
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  rem Replace the placeholder sign-in secret with a random one
  node -e "const fs=require('fs');const f='backend/.env';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('replace_with_secure_secret',require('crypto').randomBytes(32).toString('hex')))"
  echo Created backend\.env with a random JWT_SECRET.
)

echo Building the dashboard...
pushd frontend
call npm run build
if errorlevel 1 (
  popd
  echo The dashboard build failed - see the messages above.
  pause
  exit /b 1
)
popd

:run
echo.
echo Starting ScreenSync...
pushd backend
node src\server.js
popd
echo.
echo ScreenSync stopped. Starting it again in 5 seconds - close this window to stop it for good.
timeout /t 5 /nobreak >nul
goto run
