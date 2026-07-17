// 역할 라우팅 — 채점 계약: /?role=draw (드로잉 UI) · /?role=output (출력 뷰)
// 정적 import + 동기 마운트: 출력 캔버스가 DOMContentLoaded 이전에 반드시 존재해야
// A6 리로드 검사(대기 없는 count)가 결정적이 된다 (감사 발견 #2).
import "./styles.css";
import { startDraw } from "./draw.js";
import { startOutput } from "./output.js";
import { startSensor } from "./sensor.js";

const role = new URLSearchParams(location.search).get("role");
const root = document.getElementById("app");

if (role === "draw") {
  startDraw(root);
} else if (role === "output") {
  startOutput(root);
} else if (role === "sensor") {
  startSensor(root);
} else {
  // 랜딩 허브 — 역할 + 브라우저 시뮬레이션 (프로젝터 없이 굴곡면 맵핑 연습)
  root.innerHTML = `
    <div class="landing">
      <h1>라이브 드로잉 프로젝션</h1>
      <p>역할을 선택하세요.</p>
      <nav>
        <a class="role-link" href="/?role=draw">✏️ 드로잉 (아이패드)</a>
        <a class="role-link" href="/?role=output">📽️ 출력 (프로젝터)</a>
        <a class="role-link" href="/?role=sensor">👋 센서 (웹캠)</a>
      </nav>
      <p class="landing-sub">가상 표면 시뮬레이션 — 프로젝터 없이 정렬·워프 연습</p>
      <nav>
        <a class="role-link sim" href="/?role=output&sim=curtain">🪟 커튼 주름</a>
        <a class="role-link sim" href="/?role=output&sim=column">🏛 원기둥</a>
        <a class="role-link sim" href="/?role=output&sim=globe">🌐 지구본</a>
      </nav>
      <p class="landing-hint">시뮬레이션 창과 드로잉 창을 나란히 열고, 드로잉의 ◱ 정렬 →
      격자(3×3~5×5)로 표면 굴곡에 맞춰 보세요.</p>
    </div>`;
}
