@echo off
setlocal

set "ROOT=%~dp0"
pushd "%ROOT%" >nul
set "ROOT=%CD%"
popd >nul

echo [Mario Strikers] Starting local environment...
echo Root: "%ROOT%"

where node >nul 2>nul || (
  echo [ERROR] Node.js not found in PATH.
  exit /b 1
)

where npx >nul 2>nul || (
  echo [ERROR] npx not found in PATH.
  exit /b 1
)

if not exist "%ROOT%\backend\package.json" (
  echo [ERROR] backend\package.json not found.
  exit /b 1
)

if not exist "%ROOT%\backend\.env" (
  if exist "%ROOT%\backend\.env.example" (
    copy /Y "%ROOT%\backend\.env.example" "%ROOT%\backend\.env" >nul
    echo [INFO] backend\.env created from .env.example
  ) else (
    echo [ERROR] backend\.env is missing.
    exit /b 1
  )
)

if not exist "%ROOT%\backend\node_modules" (
  echo [INFO] Installing backend dependencies...
  pushd "%ROOT%\backend"
  call npm install || (
    popd
    echo [ERROR] npm install failed.
    exit /b 1
  )
  popd
)

echo [START] Backend API -> http://127.0.0.1:8787
start "Mario Strikers Backend" cmd /k "cd /d "%ROOT%\backend" && npm run start:api"

echo [START] Frontend -> http://127.0.0.1:8080
start "Mario Strikers Frontend" cmd /k "cd /d "%ROOT%" && npx --yes http-server . -p 8080 -c-1 --proxy http://127.0.0.1:8787"

timeout /t 2 >nul
start "" "http://127.0.0.1:8080"

echo [DONE] Backend + Frontend started and browser opened.
exit /b 0
