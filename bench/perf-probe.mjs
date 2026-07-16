// 개발용 성능 프로브 — 채점기와 같은 헤드리스 조건에서 출력 프레임 비용을 분해 계측.
// 채점 코드가 아니다 (grader/**와 무관). 사용: node bench/perf-probe.mjs
import { chromium } from "playwright";

const BASE = process.env.LDP_URL || "http://localhost:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const draw = await ctx.newPage();
const out = await ctx.newPage();
await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
await out.goto(`${BASE}/?role=output`, { waitUntil: "domcontentloaded" });

// 효과 토글 (기본: 채점기 D2 사전조건과 동일하게 둘 다 ON)
const want = {
  "toggle-trail": process.env.LDP_TRAIL !== "0",
  "toggle-glow": process.env.LDP_GLOW !== "0",
};
for (const [t, on] of Object.entries(want)) {
  const el = draw.locator(`[data-test="${t}"]`);
  if (((await el.getAttribute("aria-pressed")) === "true") !== on) await el.click();
}
await out.evaluate(() => {
  window.__ldpPerf = [];
  window.__frames = 0;
  const loop = () => {
    window.__frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

// 표준 부하 근사: 초당 3획 × 12초, 획당 60포인트 곡선
const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
const t0 = Date.now();
for (let i = 0; i < 36; i++) {
  await draw.evaluate(
    ({ box, i }) => {
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
      const cx = 0.2 + (i % 5) * 0.15;
      const cy = 0.3 + ((i / 5) | 0) * 0.08;
      fire("pointerdown", cx, cy);
      for (let p = 1; p < 60; p++)
        fire("pointermove", cx + 0.1 * Math.cos(p / 6), cy + 0.1 * Math.sin(p / 6));
      fire("pointerup", cx, cy);
    },
    { box, i }
  );
  const target = (i + 1) * 333;
  const wait = target - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const stats = await out.evaluate(() => {
  const P = window.__ldpPerf;
  const n = P.length;
  const avg = (k) => P.reduce((s, x) => s + x[k], 0) / Math.max(1, n);
  const max = (k) => Math.max(...P.map((x) => x[k]));
  const sorted = (k) => P.map((x) => x[k]).sort((a, b) => a - b);
  const p90 = (k) => sorted(k)[Math.floor(n * 0.9)];
  return {
    busyFrames: n,
    rafFrames: window.__frames,
    drawAvg: avg("draw"),
    drawP90: p90("draw"),
    drawMax: max("draw"),
    presentAvg: avg("present"),
    presentP90: p90("present"),
    presentMax: max("present"),
  };
});
const elapsed = (Date.now() - t0) / 1000;
console.log(JSON.stringify({ ...stats, elapsedSec: elapsed, fps: stats.rafFrames / elapsed }, null, 2));
await browser.close();
