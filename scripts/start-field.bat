@echo off
rem ── 라이브 드로잉 프로젝션 · 현장 기동 (Q14: 전원 ON = 전시 시작) ──
rem 서버+릴레이 기동 → LAN IP로 키오스크 출력 자동 오픈.
rem OS 자동시작 등록: Win+R → shell:startup → 이 파일의 바로가기를 넣는다.
setlocal enabledelayedexpansion
cd /d "%~dp0.."

rem LAN IPv4 감지 (없으면 localhost — 책상 모드)
set "LDP_IP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' -and $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LDP_IP=%%i"
if "%LDP_IP%"=="" set "LDP_IP=localhost"
echo [start-field] LAN IP: %LDP_IP%

rem 릴레이 + 개발 서버 (이미 떠 있으면 각자 포트 충돌로 조용히 물러난다)
start "ldp-relay" /min cmd /c "npm run relay"
start "ldp-dev" /min cmd /c "npm run dev"

rem 서버 대기 (최대 30초)
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try { $r = Invoke-WebRequest -UseBasicParsing http://localhost:5173 -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if errorlevel 1 (
  echo [start-field] 서버가 뜨지 않았습니다 — npm install 여부를 확인하세요.
  pause
  exit /b 1
)

rem 키오스크 출력 (엣지 — 윈도 기본 탑재. 크롬이 있으면 크롬 우선)
set "URL=http://%LDP_IP%:5173/?role=output"
where chrome >nul 2>nul
if %errorlevel%==0 (
  start "" chrome --kiosk "%URL%" --no-first-run
) else (
  start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run
)
echo [start-field] 출력 기동: %URL%
echo [start-field] 아이패드: 출력 화면의 QR을 스캔하면 드로잉 UI가 열립니다.
endlocal
