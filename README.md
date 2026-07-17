# 라이브 드로잉 프로젝션

아이패드에 펜으로 그리면 프로젝터가 비추는 표면에 즉시 나타나는 도구.
글로우·별 반짝임·잔상 연출, 4코너·격자(굴곡면) 워프 정렬, 미디어 레이어(이미지·영상),
갤러리 영속화, 웹캠 모션 리액티브, QR 접속, 원클릭 기동, 그리고 프로젝터 없이
연습할 수 있는 가상 표면 시뮬레이터(커튼·기둥·지구본)를 포함한다.

이 저장소는 앱과 그 앱을 낳은 프로토콜 인프라(채점표·채점기·에이전트 헌법)를
함께 담는다. 합격의 정의는 protocol/SCORECARD.md가 유일하다.

## 구조

```
CLAUDE.md                  에이전트 헌법 — 채점 계약, 절대 규칙
protocol/SCORECARD.md      합격의 유일한 정의 (사람만 개정 가능)
protocol/STATUS.md         진행 상태 — 세션 재개 시 여기부터
protocol/WORKFLOW.md       사용 절차 기준 문서
protocol/VISION.md         확장 비전 (#4 미디어 ~ #7 관객 참여)
protocol/ORDER-0*.md       사이클 발주서
grader/                    채점기 (Playwright 외부 관측)
src/                       앱 — draw(드로잉 UI) · output(출력 뷰) · 잉크 · 연출 · 워프
relay/                     ws 릴레이 (두 기기 동기화)
scripts/                   현장 기동 스크립트 (윈도 .bat · 맥 .command)
bench/                     개발용 성능 프로브·시각 검증 (채점기 아님)
```

## 설치 (1회)

```bash
npm install                          # 앱 (vite, three, ws, qrcode)
cd grader && npm install && npx playwright install chromium   # 채점기
```

## 책상 실험 모드 (한 기기)

```bash
npm run dev        # http://localhost:5173
```

브라우저 창 두 개: `/?role=draw` · `/?role=output` — BroadcastChannel 자동 연결.
채점: `cd grader && npm run grade` (공식 5분) / `npm run grade:quick` (참고용).

## 현장 모드 (아이패드 + 프로젝터 PC)

전제: 폐쇄 LAN — 두 기기가 같은 Wi-Fi. 외부 인터넷 불필요.

### 최초 설치 — 개관 전 1회

1. 출력 PC ↔ 프로젝터 HDMI 연결, 프로젝터 물리 위치·줌 고정
2. `scripts\start-field.bat`(윈도) 또는 `scripts/start-field.command`(맥) 1회 실행
   — 서버·릴레이가 뜨고 키오스크 브라우저가 `?role=output` 전체화면으로 자동 오픈
3. **OS 자동시작 등록 (전원 ON = 전시 시작)**
   - 윈도: `Win+R` → `shell:startup` 입력 → 열린 폴더에 `start-field.bat`의
     바로가기(우클릭 → 바로가기 만들기)를 넣는다
   - 맥: 시스템 설정 → 일반 → 로그인 항목 → `start-field.command` 추가
     (최초 1회 `chmod +x scripts/start-field.command`)
4. 출력 화면 구석의 QR을 아이패드 카메라로 스캔 → 사파리에 드로잉 UI 열림
5. 아이패드 툴바의 **◱ 정렬** → 귀퉁이 핸들 4개를 드래그해 실물 표면에 핀
   (정렬값은 출력 쪽에 자동 저장 — 다음 가동 시 복원)

### 일상 가동 — 매일 (두 동작)

1. PC 전원 ON — 서버·릴레이·키오스크 출력까지 자동, 정렬 자동 복원
2. 아이패드 QR 스캔 → 바로 드로잉

### 라이브 운용

- 펜: 색 스와치(파스텔) · 커스텀 색 · 굵기 · 지우개 — 설정 자동 저장·복원
- ↩ 실행취소: 마지막 획 취소 (지우개 획 취소 시 지워진 부분 복원)
- 연출: ✨ 글로우(별 반짝임 포함) · 💫 잔상(2~30초) · ∞ 영구 모드
- 정렬: ◱ 핸들 상대 드래그 + 🎯 미세 모드(×0.25) · ↺ 리셋
- 세션 교체: 🗑 모두 지우기 · 기념: 📷 PNG 저장
- 운영 절차 상세: protocol/WORKFLOW.md

현장 기동은 빌드+프리뷰(`npm run field`)로 서빙 — 파일 감시·HMR 없는 장기 운영.
개발·채점은 계약 그대로 `npm run dev`(5173).

### 장애 대응

- 아이패드 연결 끊김: 사파리 새로고침 → QR 재스캔 (그림은 자동 복구 — 획 리플레이)
- 출력 창 이탈: 기동 스크립트 재실행 → 정렬 자동 복원, 그림은 드로잉 기기에서 리플레이
- 정렬 틀어짐: 정렬 모드 → ↺ 리셋 후 재핀

## 채점·개발 노트

- `npm run grade`(5분 세션)가 공식 판정, `grade:quick`은 개발 참고용
- 성능 프로브: `node bench/perf-probe.mjs` — 채점기와 같은 헤드리스 조건에서
  프레임 비용 분해 (소프트웨어 GL 기준 설계 예산: 풀스크린 패스 1회/프레임)
- 시각 검증: `node bench/visual-check.mjs` → `bench/shots/*.png`

## 신뢰 모델

SCORECARD·grader는 에이전트 수정 금지(C2·D4). 초기의 권한 deny 물리 봉쇄는
사람 지시(2026-07-17, 취미 프로젝트)로 해제되었고, git 이력(GitHub 원격)이
감사 추적을 대신한다 — 검증: `git log --stat -- protocol/ grader/`.
