# 라이브 드로잉 프로젝션 — 프로토콜 번들

아이패드에 펜으로 그리면 프로젝터가 비추는 표면에 즉시 나타나는 도구.
이 번들은 앱이 아니라 앱을 낳는 프로토콜 인프라다: 채점표, 채점기, 에이전트 헌법, 권한.

## 구조

```
CLAUDE.md                  에이전트 헌법 — 채점 계약, 절대 규칙
.claude/settings.json      권한 — 굿하트 물리 봉쇄 (deny가 항상 이김)
protocol/SCORECARD.md      합격의 유일한 정의 (v0.1, 사람만 개정 가능)
protocol/STATUS.md         진행 상태 — 세션 재개 시 여기부터
grader/                    채점기 (Playwright 외부 관측) — 에이전트 수정 불가
```

## 설치와 첫 실행 (2단계 게이트)

```bash
# 1) 이 폴더를 프로젝트 루트로 사용
cd live-drawing-projection

# 2) 채점기 준비
cd grader
npm install
npx playwright install chromium

# 3) 첫 실행 — 앱이 아직 없으므로 전항목 FAIL(RED)이 정상이다
npm run grade:quick
```

기대 출력: `A1 FAIL 앱에 접속 불가(http://localhost:5173) ...` 로 시작하는 RED 리포트.
이 RED가 곧 "채점기가 살아있다"는 증거이며, 3단계부터 에이전트는 이 표를 초록으로 만드는 일만 한다.

`npm run grade`(5분 세션)가 공식 판정, `grade:quick`은 개발 중 참고용이다.

## 3단계에서 Claude Code 구동

```bash
cd live-drawing-projection
claude
```

첫 프롬프트로 발주서(3단계에서 확정)를 붙여넣으면, CLAUDE.md의 규칙에 따라
구현 → 채점 → STATUS 갱신 → 시사 정지 루프가 돈다.

## 알려진 잔여 리스크

권한 deny는 Edit/Write 도구를 막지만, 셸 우회(리다이렉트, sed 등)까지 OS 수준으로
막지는 못한다. CLAUDE.md 절대 규칙 1이 이를 금지하며, 최종 안전망은 시사와
`git diff protocol/ grader/` 확인이다. 더 강한 봉쇄가 필요하면 Claude Code의
sandbox 기능 또는 PreToolUse hook을 추가할 수 있다(승격 후 검토).
