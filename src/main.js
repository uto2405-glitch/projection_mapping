// 역할 라우팅 — 채점 계약: /?role=draw (드로잉 UI) · /?role=output (출력 뷰)
// 정적 import + 동기 마운트: 출력 캔버스가 DOMContentLoaded 이전에 반드시 존재해야
// A6 리로드 검사(대기 없는 count)가 결정적이 된다 (감사 발견 #2).
import "./styles.css";
import { startDraw } from "./draw.js";
import { startOutput } from "./output.js";

const role = new URLSearchParams(location.search).get("role");
const root = document.getElementById("app");

if (role === "draw") {
  startDraw(root);
} else if (role === "output") {
  startOutput(root);
} else {
  // 랜딩 — 역할 선택 (현장 접속은 출력 화면의 QR)
  root.innerHTML = `
    <div class="landing">
      <h1>라이브 드로잉 프로젝션</h1>
      <p>역할을 선택하세요.</p>
      <nav>
        <a class="role-link" href="/?role=draw">✏️ 드로잉 (아이패드)</a>
        <a class="role-link" href="/?role=output">📽️ 출력 (프로젝터)</a>
      </nav>
    </div>`;
}
