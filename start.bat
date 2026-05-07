@echo off
setlocal

set "PORT=8787"
set "SITE_URL=http://localhost:%PORT%"
set "SITE_READY_CHECK=%SITE_URL%/"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker not found. Skipping FlareSolverr startup.
) else (
  docker start flaresolverr >nul 2>nul || docker run -d --name=flaresolverr -p 8191:8191 -e LOG_LEVEL=info --restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest >nul 2>nul
  if errorlevel 1 echo FlareSolverr startup skipped.
)

powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop; Write-Host ('Stopped process on port %PORT% (PID ' + $conn.OwningProcess + ').') } catch { Write-Host ('Failed to stop process on port %PORT%: ' + $_.Exception.Message); exit 1 } }"
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

set SERVE_STATIC=true

if not defined NO_BROWSER (
  start "" powershell -NoProfile -WindowStyle Hidden -Command "$deadline = (Get-Date).AddSeconds(20); while ((Get-Date) -lt $deadline) { try { $response = Invoke-WebRequest -Uri '%SITE_READY_CHECK%' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { Start-Process '%SITE_URL%'; break } } catch {} Start-Sleep -Milliseconds 500 }"
)

cd /d "%~dp0backend"
npm start
