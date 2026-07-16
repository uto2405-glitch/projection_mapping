// 역할 라우팅 — 채점 계약: /?role=draw (드로잉 UI) · /?role=output (출력 뷰)
import "./styles.css";

const role = new URLSearchParams(location.search).get("role");
const root = document.getElementById("app");

if (role === "draw") {
  import("./draw.js").then((m) => m.startDraw(root));
} else if (role === "output") {
  import("./output.js").then((m) => m.startOutput(root));
} else {
  // 랜딩 — 역할 선택 (QR 접속은 사이클 #3)
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
