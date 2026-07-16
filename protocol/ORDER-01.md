# 발주서 #1 — 뼈대와 잉크 (2026-07-16 확정)

읽기: CLAUDE.md 전체, protocol/SCORECARD.md 전체. 이후 착수.

## 범위

- Vite + Three.js 프로젝트 골격, `?role=draw` · `?role=output` 라우팅
- BroadcastChannel(`ldp-sync`) 같은 기기 동기화
- 기본 펜: 색·굵기·지우개 + 모두 지우기(`clear-all`) / Pointer Events +
  getCoalescedEvents / touch-action 차단
- CLAUDE.md 채점 계약 전 항목: `ldp:render:` 마크, 읽기 전용 레지스트리,
  data-test 셀렉터 전부, 효과 토글·잔상 슬라이더 UI와 상태(aria-pressed),
  `ldp:corners` localStorage 저장·복원
- 단, 글로우·잔상 셰이더와 워프 렌더·정렬 모드(`align-mode`)는 이번 범위 아님
  (효과는 UI·상태만 준비, 정렬 모드는 사이클 #3)

개정 기록: 2026-07-16 Q9 승인으로 모두 지우기 편입 (사람 승인 경유)

## 합격 목표

- A1 · A4 · A5 · A6 · A7 · A8 · A9 → PASS
- A3 → 참고 측정만 기록 (효과 없는 상태)
- A2 · D2 → 이번 사이클 판정 범위 아님

## 금지

- SCORECARD C1~C4 전부. 제외 목록(C3) 접근 금지.

## 완료 시

`npm run grade` 결과표 + protocol/STATUS.md 갱신 + 정지.
시사 없음 — 자동판정 사이클.
