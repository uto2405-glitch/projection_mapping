// 시뮬레이터 + 격자 워프 시각 검증 — bench/shots/8-sim-gridwarp.png, 9-align-grid.png
import { chromium } from "playwright";
import { identityGrid } from "../src/gridwarp.js";

const BASE = process.env.LDP_URL || "http://localhost:5173";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const draw = await ctx.newPage();
const out = await ctx.newPage();
await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
await out.goto(`${BASE}/?role=output&sim=curtain`, { waitUntil: "domcontentloaded" });
await draw.waitForTimeout(400);

// 글로우 켜고 파스텔 획 몇 개
await draw.locator('[data-test="toggle-glow"]').click();
const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
const stroke = (pts) =>
  draw.evaluate(
    ({ box, pts }) => {
      const el = document.querySelector('[data-test="draw-canvas"]');
      const fire = (t, x, y) =>
        el.dispatchEvent(
          new PointerEvent(t, {
            pointerType: "pen",
            isPrimary: true,
            bubbles: true,
            clientX: box.x + x * box.width,
            clientY: box.y + y * box.height,
            buttons: t === "pointerup" ? 0 : 1,
          })
        );
      fire("pointerdown", ...pts[0]);
      for (let i = 1; i < pts.length; i++) fire("pointermove", ...pts[i]);
      fire("pointerup", ...pts[pts.length - 1]);
    },
    { box, pts }
  );
const wave = (y, n = 80) =>
  Array.from({ length: n }, (_, i) => [0.1 + (0.8 * i) / (n - 1), y + 0.06 * Math.sin(i / 5)]);
await draw.evaluate(() => {
  const el = document.querySelector('[data-test="pen-color"]');
  el.value = "#ffd1ea";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await stroke(wave(0.35));
await draw.evaluate(() => {
  const el = document.querySelector('[data-test="pen-color"]');
  el.value = "#c9e6ff";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await stroke(wave(0.6));

// 4×4 격자 — 커튼 주름을 따라 물결치는 워프
const pts = identityGrid(4, 4);
for (let r = 0; r < 4; r++)
  for (let c = 0; c < 4; c++) {
    const p = pts[r * 4 + c];
    p.x += 0.03 * Math.sin(r * 2.1 + c);
    p.y += 0.04 * Math.sin(c * 1.7 + r * 0.5);
  }
await out.evaluate((points) => {
  const bc = new BroadcastChannel("ldp-sync");
  bc.postMessage({ t: "warp", mode: "grid", nx: 4, ny: 4, points, _sid: "simshot", _n: 1 });
}, pts);
await out.waitForTimeout(600);
await out.screenshot({ path: "bench/shots/8-sim-gridwarp.png" });

// 드로잉 쪽 정렬 UI (격자 4×4 핸들·격자선)
await draw.locator('[data-test="align-mode"]').click();
await draw.waitForTimeout(500);
await draw.screenshot({ path: "bench/shots/9-align-grid.png" });
console.log("shots 저장");
await browser.close();
