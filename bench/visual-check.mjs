// 개발용 시각 검증 — 글로우·별 반짝임·잔상·워프를 스크린샷으로 확인.
// 사용: node bench/visual-check.mjs  → bench/shots/*.png
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.LDP_URL || "http://localhost:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const draw = await ctx.newPage();
const out = await ctx.newPage();
await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
await out.goto(`${BASE}/?role=output`, { waitUntil: "domcontentloaded" });
await draw.waitForTimeout(300);

const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
const stroke = (cx, cy, r, spins = 1.6, n = 90) =>
  draw.evaluate(
    ({ box, cx, cy, r, spins, n }) => {
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
      const pt = (t) => [
        cx + Math.cos(t * spins * Math.PI * 2) * r * (0.4 + 0.6 * t),
        cy + Math.sin(t * spins * Math.PI * 2) * r * (0.4 + 0.6 * t) * 0.62,
      ];
      fire("pointerdown", ...pt(0));
      for (let i = 1; i < n; i++) fire("pointermove", ...pt(i / (n - 1)));
      fire("pointerup", ...pt(1));
    },
    { box, cx, cy, r, spins, n }
  );

const setColor = (hex) =>
  draw.evaluate((hex) => {
    const el = document.querySelector('[data-test="pen-color"]');
    el.value = hex;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, hex);
const setWidth = (w) =>
  draw.evaluate((w) => {
    const el = document.querySelector('[data-test="pen-width"]');
    el.value = String(w);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, w);

// ── 1) 효과 OFF 기본 잉크 ──
await setColor("#ffd1ea");
await setWidth(8);
await stroke(0.3, 0.45, 0.2);
await setColor("#c9e6ff");
await stroke(0.68, 0.5, 0.16, 1.2);
await out.waitForTimeout(400);
await out.screenshot({ path: path.join(OUT, "1-plain.png") });

// ── 2) 글로우 ON (별 반짝임 포함) ──
await draw.locator('[data-test="toggle-glow"]').click();
await setColor("#fff3c4");
await stroke(0.5, 0.72, 0.18, 1.1);
await out.waitForTimeout(250); // 반짝임 생존 중 캡처
await out.screenshot({ path: path.join(OUT, "2-glow.png") });

// ── 3) 잔상 ON — 감쇠 중간 상태 ──
await draw.locator('[data-test="toggle-trail"]').click();
await draw.evaluate(() => {
  const el = document.querySelector('[data-test="trail-seconds"]');
  el.value = "3";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await out.waitForTimeout(1800); // 3초 잔상의 60% 경과 — 반쯤 바랜 상태
await setColor("#ffd1ea");
await stroke(0.25, 0.3, 0.12, 1.0, 50);
await out.waitForTimeout(300);
await out.screenshot({ path: path.join(OUT, "3-trail.png") });

// ── 4) 워프 — 코너를 안쪽으로 (정렬 모드 경유, 실제 사용 경로) ──
await out.evaluate(() => {
  // 실제 경로는 draw 정렬 핸들이지만 시각 검증은 메시지로 직접
  const bc = new BroadcastChannel("ldp-sync");
  bc.postMessage({ t: "corners", v: [0.12, 0.08, 0.9, 0.15, 0.82, 0.9, 0.05, 0.82], _sid: "vis", _n: 1 });
});
await out.waitForTimeout(400);
await out.screenshot({ path: path.join(OUT, "4-warp.png") });

// ── 5) 드로잉 UI (정렬 모드 오버레이 포함) ──
await draw.locator('[data-test="align-mode"]').click();
await draw.waitForTimeout(300);
await draw.screenshot({ path: path.join(OUT, "5-draw-align.png") });

console.log("shots →", OUT);
await browser.close();
