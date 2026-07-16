#!/bin/bash
# ── 라이브 드로잉 프로젝션 · 현장 기동 (맥) ──
# OS 자동시작 등록: 시스템 설정 → 일반 → 로그인 항목에 이 파일 추가.
cd "$(dirname "$0")/.."

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)
echo "[start-field] LAN IP: $IP"

(npm run relay > /tmp/ldp-relay.log 2>&1 &)
(npm run field > /tmp/ldp-serve.log 2>&1 &)

# 서버 대기 (최대 60초 — 첫 빌드 포함). 실패 시 키오스크를 열지 않는다.
READY=0
for i in $(seq 1 120); do
  curl -s -o /dev/null http://localhost:5173 && READY=1 && break
  sleep 0.5
done
if [ "$READY" != "1" ]; then
  echo "[start-field] 서버가 뜨지 않았습니다 — npm install 여부와 /tmp/ldp-serve.log를 확인하세요."
  osascript -e 'display alert "라이브 드로잉: 서버 기동 실패" message "npm install 여부와 /tmp/ldp-serve.log를 확인하세요."' 2>/dev/null
  exit 1
fi

URL="http://$IP:5173/?role=output"
open -na "Google Chrome" --args --kiosk "$URL" 2>/dev/null || open -a Safari "$URL"
echo "[start-field] 출력 기동: $URL"
echo "[start-field] 아이패드: 출력 화면의 QR을 스캔하면 드로잉 UI가 열립니다."
