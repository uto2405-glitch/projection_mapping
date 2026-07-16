#!/bin/bash
# ── 라이브 드로잉 프로젝션 · 현장 기동 (맥) ──
# OS 자동시작 등록: 시스템 설정 → 일반 → 로그인 항목에 이 파일 추가.
cd "$(dirname "$0")/.."

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)
echo "[start-field] LAN IP: $IP"

(npm run relay >/dev/null 2>&1 &)
(npm run dev >/dev/null 2>&1 &)

for i in $(seq 1 60); do
  curl -s -o /dev/null http://localhost:5173 && break
  sleep 0.5
done

URL="http://$IP:5173/?role=output"
open -na "Google Chrome" --args --kiosk "$URL" 2>/dev/null || open -a Safari "$URL"
echo "[start-field] 출력 기동: $URL"
echo "[start-field] 아이패드: 출력 화면의 QR을 스캔하면 드로잉 UI가 열립니다."
