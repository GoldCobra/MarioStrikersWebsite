@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden. Bitte Node.js installieren und erneut starten.
  pause
  exit /b 1
)

if not exist "backend\node_modules" (
  echo Backend-Abhaengigkeiten werden installiert...
  pushd backend
  call npm install
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)

set "PORT=8080"
set "SERVE_STATIC=true"
set "FLARESOLVERR_URL=http://localhost:8191"

echo.
echo Mario Strikers Website lokal:
echo   http://localhost:%PORT%/
echo.
echo Clean URLs wie /games und /msbl-gear-builder funktionieren lokal.
echo Zum Beenden dieses Fenster schliessen oder STRG+C druecken.
echo.

start "" "http://localhost:%PORT%/"

pushd backend
node src\index.js
popd

pause
