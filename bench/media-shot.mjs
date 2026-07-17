// 미디어 레이어 + 지구본 시뮬 시각 검증 — bench/shots/10-media-globe.png
import { chromium } from "playwright";
import { PNG } from "pngjs";

const BASE = process.env.LDP_URL || "http://localhost:5173";
// 그라데이션 테스트 이미지 (밤하늘 성운 느낌)
function nebulaPng(w = 256, h = 256) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x / w;
      const v = y / h;
      png.data[i] = 120 + 100 * Math.sin(u * 6) * Math.sin(v * 4);
      png.data[i + 1] = 60 + 60 * v;
      png.data[i + 2] = 150 + 90 * Math.cos(u * 3 + v * 5);
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const draw = await ctx.newPage();
const out = await ctx.newPage();
await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
await out.goto(`${BASE}/?role=output&sim=globe`, { waitUntil: "domcontentloaded" });
await draw.waitForTimeout(400);

// 미디어 로드 → 지구본 위 배치 (중앙, 작게)
await draw.setInputFiles(".media-file", { name: "nebula.png", mimeType: "image/png", buffer: nebulaPng() });
await out.waitForTimeout(1500);
await draw.evaluate(() => {
  const set = (sel, v) => {
    const el = document.querySelector(`[data-test="${sel}"]`);
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  set("media-scale", 34);
  set("media-opacity", 75);
});

// 글로우 + 획
await draw.locator('[data-test="toggle-glow"]').click();
const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
await draw.evaluate(
  ({ box }) => {
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
    // 지구본 주위를 도는 궤도 획
    const pts = Array.from({ length: 90 }, (_, i) => {
      const a = (i / 89) * Math.PI * 1.6 - 0.4;
      return [0.5 + 0.3 * Math.cos(a), 0.52 + 0.34 * Math.sin(a)];
    });
    fire("pointerdown", ...pts[0]);
    for (let i = 1; i < pts.length; i++) fire("pointermove", ...pts[i]);
    fire("pointerup", ...pts[pts.length - 1]);
  },
  { box }
);
await out.waitForTimeout(500);
await out.screenshot({ path: "bench/shots/10-media-globe.png" });
console.log("shot 저장");
await browser.close();
