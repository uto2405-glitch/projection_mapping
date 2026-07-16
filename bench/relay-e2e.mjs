// 개발용 두 기기 종단 테스트 — 별도 브라우저 인스턴스 2개(BroadcastChannel 불통)를
// LAN IP로 접속시켜 ws 릴레이 경로만으로 획이 전달되는지 검증.
// 전제: npm run dev + npm run relay 실행 중. 사용: node bench/relay-e2e.mjs
import { chromium } from "playwright";
import os from "node:os";

function lanIp() {
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) {
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254")) return i.address;
    }
  }
  return null;
}

const ip = process.env.LDP_IP || lanIp();
if (!ip) {
  console.log("RELAY-E2E SKIP — LAN IPv4 없음");
  process.exit(0);
}
const BASE = `http://${ip}:5173`;
console.log("대상:", BASE);

const b1 = await chromium.launch(); // 아이패드 역
const b2 = await chromium.launch(); // 출력 PC 역 (별도 인스턴스 — BC 불통)
const draw = await (await b1.newContext()).newPage();
const out = await (await b2.newContext()).newPage();

const errors = [];
for (const [p, tag] of [
  [draw, "draw"],
  [out, "out"],
]) {
  p.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${tag} console: ${m.text()}`);
  });
}

await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
await out.goto(`${BASE}/?role=output`, { waitUntil: "domcontentloaded" });
await draw.waitForTimeout(1500); // ws 접속 대기

// 획 1개 주입 (draw 인스턴스에서)
const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
await draw.evaluate((box) => {
  const el = document.querySelector('[data-test="draw-canvas"]');
  const fire = (type, x, y) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "pen",
        isPrimary: true,
        bubbles: true,
        clientX: box.x + x * box.width,
        clientY: box.y + y * box.height,
        buttons: type === "pointerup" ? 0 : 1,
      })
    );
  fire("pointerdown", 0.3, 0.4);
  for (let i = 1; i <= 30; i++) fire("pointermove", 0.3 + i * 0.01, 0.4 + Math.sin(i / 4) * 0.05);
  fire("pointerup", 0.6, 0.4);
}, box);

await out.waitForTimeout(1200);
const reg = await out.evaluate(() => (window.__ldp ? window.__ldp.strokes.map((s) => ({ ...s })) : null));
const qrVisible = await out.locator(".qr-badge").isVisible().catch(() => false);

// 정렬 원격 전달도 확인 (draw → ws → output localStorage)
await draw.evaluate(() => {
  document.querySelector('[data-test="align-mode"]').click();
});
await draw.waitForTimeout(400);
await draw.evaluate(() => {
  const bcLess = window; // draw 페이지의 sync를 통해 보내려면 핸들 드래그가 정석이나, 여기선 리셋 버튼 사용
  document.querySelector('[data-test="align-reset"]').click();
});
await out.waitForTimeout(800);
const corners = await out.evaluate(() => localStorage.getItem("ldp:corners"));

const ok =
  reg && reg.length === 1 && reg[0].id === "s000" && reg[0].pointsRendered >= 28 && corners !== null;
console.log(
  JSON.stringify(
    { ok, registry: reg, cornersSaved: corners, qrVisibleBeforeDraw: qrVisible, errors },
    null,
    2
  )
);
await b1.close();
await b2.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
