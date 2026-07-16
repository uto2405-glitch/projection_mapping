# 라이브 드로잉 프로젝션 — 프로젝트 헌법

너(에이전트)의 임무는 protocol/SCORECARD.md를 통과하는 앱을 만드는 것이다.
합격의 정의는 대화가 아니라 그 문서다. 문서와 대화가 충돌하면 문서가 이긴다.

## 절대 규칙

1. protocol/SCORECARD.md, grader/**, .claude/settings.json은 수정 금지 (권한으로도 막혀 있다).
   권한이 못 막는 우회(셸 리다이렉트, sed -i, mv 등)로 이 파일들을 건드리는 것도 동일하게 금지다.
   채점 기준이 틀렸다고 판단되면 수정하지 말고 STATUS에 "개정 제안"으로 적고 멈춰라.
2. SCORECARD의 C(금지) 조항 위반은 다른 모든 것이 통과해도 불합격이다.
3. 제외 명시 목록(C3)의 기능은 요청받아도 구현하지 마라 — 사람의 채점표 개정이 먼저다.
4. 매 작업 사이클 종료 시 `node grader/grade.mjs`를 실행하고 결과를 보고한다.
5. protocol/STATUS.md를 갱신하고, 시사(B 항목)가 필요한 지점에서는
   `■ 시사 대기 — 사람 판정 필요` 정지문을 남기고 멈춘다.

## 채점 계약 (앱이 반드시 노출해야 하는 관측 인터페이스)

채점기는 바깥에서 관측한다. 앱은 아래 계약을 지켜야 채점받을 수 있다.
이 계약은 채점을 위한 최소 노출이며, 지표를 계산해 보고하는 것이 아니다(C4).

- 개발 서버: `npm run dev` → http://localhost:5173
- 역할 URL: `/?role=draw` (드로잉 UI) · `/?role=output` (출력 뷰)
- 같은 기기 동기화: BroadcastChannel 이름 `ldp-sync`
- 두 기기 동기화: `npm run relay` → ws://<host>:8787 (Node ws 릴레이)
- 렌더 마크: 출력 뷰가 획의 첫 포인트를 실제로 그린 프레임에
  `performance.mark('ldp:render:' + strokeId)` 1회 호출
- 읽기 전용 레지스트리: `window.__ldp = { strokes: [{id, pointsRendered}], effects: {trail, glow, trailSeconds} }`
  (출력 뷰에서. 값은 실제 렌더 상태를 반영해야 하며, 채점기가 픽셀 검사로 교차검증한다)
- 4코너 저장: localStorage 키 `ldp:corners` (JSON, 8개 숫자) — 저장 위치는 항상 출력 쪽(A6 불변)
- 4코너 조정: 아이패드(draw)에서 원격 — 정렬 모드 진입 `[data-test="align-mode"]`,
  코너 변경은 동기화 계층(획과 같은 채널)으로 출력에 전달된다 (Q7 확정, 2026-07-16)
- 접속 전제: 폐쇄 LAN(같은 Wi-Fi), 접속 코드 없음 (Q8 확정) —
  운영 절차의 기준 문서는 protocol/WORKFLOW.md
- DOM 훅: 출력 캔버스 `[data-test="output-canvas"]` ·
  드로잉 캔버스 `[data-test="draw-canvas"]` ·
  PNG 내보내기 버튼 `[data-test="export-png"]` ·
  효과 토글 `[data-test="toggle-trail"]`, `[data-test="toggle-glow"]` (aria-pressed 반영) ·
  잔상 시간 슬라이더 `[data-test="trail-seconds"]` (2~30, 별도 영구 모드) ·
  모두 지우기 `[data-test="clear-all"]` (Q9 확정 — 세션 교체용, 잔상 영구 모드 포함 전체 소거)
- 현장 기동: `scripts/start-field` (윈도 .bat · 맥 .command) — 서버+릴레이 기동 후
  키오스크 모드로 `?role=output` 자동 오픈. OS 자동시작 등록 방법을 README에 포함.
  (Q14 확정, #3 범위 — 자동판정 항목 없음, 판정은 B4 현장 시사에 흡수)

계약을 바꿔야 할 기술적 사유가 생기면 구현하지 말고 STATUS에 제안으로 적어라.

## 스택과 경계 (0단계 승인)

- Three.js + Vite + Node ws 릴레이. 외부 클라우드 호출 금지(C1) — LAN 완결.
- 아이패드 사파리가 1급 시민이다: Pointer Events(+getCoalescedEvents),
  터치 스크롤·제스처 간섭 차단(touch-action), 오디오/전체화면 제스처 제약 유의.
- 대상은 4코너 워프 1면. 셰이더는 호모그래피 행렬 하나로 충분하다.
- 워프 렌더 구조는 "콘텐츠 → 오프스크린 텍스처 → 워프 메시"로 짓는다 —
  훗날 면 추가가 메시 추가가 되도록 (근거: protocol/VISION.md 테제 2).

## 작업 루프 (3단계에서 발주서로 확정, 골자는 다음과 같다)

발주서 수신 → SCORECARD 해당 조항 확인 → 구현 → grader 실행 →
STATUS 갱신(PASS/FAIL 표 + 다음 액션) → 시사 필요 시 정지문 → 사람 승인 후 다음 사이클.

## 보고 형식

산출 요약 3줄 + grader 결과표 + STATUS 갱신본 + (있다면) 개정 제안. 그 외 장식 금지.
