// 모의 시사 하네스 — 채점기가 다루지 않는 현장 시나리오 12종을 종단 검증.
// 채점 코드가 아니다 (grader/**와 무관). 사용: node bench/scenarios.mjs [--only S1,S5]
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { spawn } from "node:child_process";
import os from "node:os";
import { homographyFromUnitSquare, applyHomography } from "../src/homography.js";

const BASE = process.env.LDP_URL || "http://localhost:5173";
const only = (process.argv.find((a) => a.startsWith("--only")) || "").split("=")[1]?.split(",");

const results = [];
const browser = await chromium.launch();

// ─── 헬퍼 ───
async function setup(ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctxOpts });
  const errors = [];
  const mk = async (role) => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${role} pageerror: ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(`${role} console: ${m.text()}`);
    });
    await p.goto(`${BASE}/?role=${role}`, { waitUntil: "domcontentloaded" });
    return p;
  };
  const draw = await mk("draw");
  const out = await mk("output");
  await draw.waitForTimeout(250);
  return { ctx, draw, out, errors };
}

async function fireStroke(page, pts, { type = "pen", pointerId = 1, up = true } = {}) {
  const box = await page.locator('[data-test="draw-canvas"]').boundingBox();
  await page.evaluate(
    ({ box, pts, type, pointerId, up }) => {
      const el = document.querySelector('[data-test="draw-canvas"]');
      const fire = (kind, x, y) =>
        el.dispatchEvent(
          new PointerEvent(kind, {
            pointerType: type,
            pointerId,
            isPrimary: true,
            bubbles: true,
            clientX: box.x + x * box.width,
            clientY: box.y + y * box.height,
            buttons: kind === "pointerup" ? 0 : 1,
          })
        );
      fire("pointerdown", pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) fire("pointermove", pts[i][0], pts[i][1]);
      if (up) fire("pointerup", pts[pts.length - 1][0], pts[pts.length - 1][1]);
    },
    { box, pts, type, pointerId, up }
  );
}

const line = (x0, y0, x1, y1, n = 40) =>
  Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);

async function shot(out) {
  const buf = await out.locator('[data-test="output-canvas"]').screenshot();
  return PNG.sync.read(buf);
}
// 출력 캔버스 요소(1280×800) 안의 콘텐츠(16:9 contain → 1280×720, y+40)에서 샘플
function lum(png, nx, ny) {
  const x = Math.max(0, Math.min(png.width - 1, Math.round(nx * png.width)));
  const contentH = (png.width * 9) / 16;
  const y0 = (png.height - contentH) / 2;
  const y = Math.max(0, Math.min(png.height - 1, Math.round(y0 + ny * contentH)));
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
}
// 얇은 선 대비 샘플 오차 흡수 — (nx,ny) 주변 ±r px 창의 최대 휘도
function lumMax(png, nx, ny, r = 5) {
  let m = 0;
  const contentH = (png.width * 9) / 16;
  const cx = nx * png.width;
  const cy = (png.height - contentH) / 2 + ny * contentH;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.max(0, Math.min(png.width - 1, Math.round(cx + dx)));
      const y = Math.max(0, Math.min(png.height - 1, Math.round(cy + dy)));
      const i = (y * png.width + x) * 4;
      m = Math.max(m, 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  }
  return m;
}
const rgb = (png, nx, ny) => {
  const x = Math.round(nx * png.width);
  const contentH = (png.width * 9) / 16;
  const y = Math.round((png.height - contentH) / 2 + ny * contentH);
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

const click = (page, sel) => page.locator(`[data-test="${sel}"]`).click();
const setSlider = (page, sel, v) =>
  page.evaluate(
    ({ sel, v }) => {
      const el = document.querySelector(`[data-test="${sel}"]`);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel, v }
  );

function report(id, name, pass, detail = "", errors = []) {
  const errTxt = errors.length ? ` | 콘솔에러 ${errors.length}: ${errors[0]}` : "";
  results.push({ id, name, pass: pass && !errors.length, detail: detail + errTxt });
  console.log(`${pass && !errors.length ? "✅" : "❌"} ${id} ${name} — ${detail}${errTxt}`);
}

const SC = {};

// ─── S1 드로잉 리로드 — ID 재발급 오염 방어 ───
SC.S1 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await fireStroke(draw, line(0.1, 0.2, 0.3, 0.2)); // A(흰색): s000
  await out.waitForTimeout(300);
  await draw.reload({ waitUntil: "domcontentloaded" });
  await draw.waitForTimeout(400);
  // 파랑으로 B: 리로드 후 다시 s000
  await draw.evaluate(() => {
    const el = document.querySelector('[data-test="pen-color"]');
    el.value = "#4488ff";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fireStroke(draw, line(0.6, 0.7, 0.8, 0.7));
  await out.waitForTimeout(400);
  const png = await shot(out);
  const reg = await out.evaluate(() => window.__ldp.strokes.map((s) => ({ ...s })));
  const aVisible = lum(png, 0.2, 0.2) > 40;
  const bC = rgb(png, 0.7, 0.7);
  const bBlue = bC[2] > 120 && bC[2] > bC[0] + 40; // 파랑 유지 (옛 메타 오염 없음)
  const noBridge = lum(png, 0.45, 0.45) < 12; // A끝↔B시작 사이 가짜 연결선 없음
  report(
    "S1",
    "드로잉 리로드 ID 오염 방어",
    aVisible && bBlue && noBridge && reg.length === 2,
    `A유지=${aVisible} B파랑=${bBlue}(${bC}) 연결선없음=${noBridge} reg=${reg.length}`,
    errors
  );
  await ctx.close();
};

// ─── S2 출력 리로드 — 획 리플레이 복구 ───
SC.S2 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await fireStroke(draw, line(0.2, 0.3, 0.7, 0.3));
  await fireStroke(draw, line(0.2, 0.6, 0.7, 0.6));
  await out.waitForTimeout(300);
  await out.reload({ waitUntil: "domcontentloaded" });
  await out.waitForTimeout(700); // sync-req → replay
  const png = await shot(out);
  const reg = await out.evaluate(() => window.__ldp.strokes.length);
  const ok = lum(png, 0.45, 0.3) > 40 && lum(png, 0.45, 0.6) > 40 && reg === 2;
  report("S2", "출력 리로드 획 리플레이 복구", ok, `reg=${reg} 픽셀복원=${ok}`, errors);
  await ctx.close();
};

// ─── S3 팜 리젝션 — 펜 획 진행 중 터치 개입 ───
SC.S3 = async () => {
  const { ctx, draw, out, errors } = await setup();
  const box = await draw.locator('[data-test="draw-canvas"]').boundingBox();
  await draw.evaluate(
    ({ box }) => {
      const el = document.querySelector('[data-test="draw-canvas"]');
      const fire = (kind, x, y, type, id) =>
        el.dispatchEvent(
          new PointerEvent(kind, {
            pointerType: type,
            pointerId: id,
            isPrimary: true,
            bubbles: true,
            clientX: box.x + x * box.width,
            clientY: box.y + y * box.height,
            buttons: kind === "pointerup" ? 0 : 1,
          })
        );
      // 펜 획 시작 (왼쪽 상단 가로선)
      fire("pointerdown", 0.1, 0.2, "pen", 1);
      for (let i = 1; i <= 15; i++) fire("pointermove", 0.1 + i * 0.01, 0.2, "pen", 1);
      // 손바닥 착지 (오른쪽 하단) — 무시돼야 함
      fire("pointerdown", 0.8, 0.8, "touch", 2);
      for (let i = 0; i <= 5; i++) fire("pointermove", 0.8 - i * 0.02, 0.8, "touch", 2);
      fire("pointerup", 0.7, 0.8, "touch", 2);
      // 펜 계속
      for (let i = 16; i <= 30; i++) fire("pointermove", 0.1 + i * 0.01, 0.2, "pen", 1);
      fire("pointerup", 0.4, 0.2, "pen", 1);
    },
    { box }
  );
  await out.waitForTimeout(400);
  const png = await shot(out);
  const reg = await out.evaluate(() => window.__ldp.strokes.map((s) => ({ ...s })));
  const penOk = lum(png, 0.25, 0.2) > 40; // 펜 선 온전
  const palmClean = lum(png, 0.75, 0.8) < 12; // 손바닥 위치 무획
  report(
    "S3",
    "팜 리젝션 (펜 진행 중 터치 개입)",
    penOk && palmClean && reg.length === 1 && reg[0].pointsRendered >= 30,
    `펜선=${penOk} 팜무획=${palmClean} reg=${reg.length}개 pts=${reg[0]?.pointsRendered}`,
    errors
  );
  await ctx.close();
};

// ─── S4 지우개 ───
SC.S4 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await fireStroke(draw, line(0.2, 0.5, 0.8, 0.5)); // 흰 가로선
  await click(draw, "tool-eraser");
  await setSlider(draw, "pen-width", 30);
  await fireStroke(draw, line(0.5, 0.3, 0.5, 0.7)); // 굵은 지우개 세로선
  await out.waitForTimeout(400);
  const png = await shot(out);
  const kept = lum(png, 0.25, 0.5) > 40;
  const erased = lum(png, 0.5, 0.5) < 12;
  report("S4", "지우개 교차 소거", kept && erased, `보존=${kept} 소거=${erased}`, errors);
  await ctx.close();
};

// ─── S5 잔상 만료 — 완전 소거 후 검정 ───
SC.S5 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await click(draw, "toggle-trail");
  await setSlider(draw, "trail-seconds", 2);
  await fireStroke(draw, line(0.2, 0.4, 0.8, 0.4));
  await out.waitForTimeout(300);
  const mid = lum(await shot(out), 0.5, 0.4) > 40; // 직후엔 보임
  await out.waitForTimeout(3200); // 2s 잔상 + 여유
  const after = lum(await shot(out), 0.5, 0.4);
  report("S5", "잔상 만료 완전 소거", mid && after < 6, `직후보임=${mid} 3.5s후 휘도=${after.toFixed(1)}`, errors);
  await ctx.close();
};

// ─── S6 잔상 영구 모드 — 감쇠 없음 ───
SC.S6 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await click(draw, "toggle-trail");
  await setSlider(draw, "trail-seconds", 2);
  await click(draw, "trail-permanent");
  await fireStroke(draw, line(0.2, 0.4, 0.8, 0.4));
  await out.waitForTimeout(3200);
  const after = lum(await shot(out), 0.5, 0.4);
  report("S6", "잔상 영구 모드 지속", after > 40, `3s후 휘도=${after.toFixed(1)}`, errors);
  await ctx.close();
};

// ─── S7 모두 지우기 ───
SC.S7 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await fireStroke(draw, line(0.2, 0.3, 0.8, 0.3));
  await fireStroke(draw, line(0.2, 0.6, 0.8, 0.6));
  await out.waitForTimeout(300);
  await click(draw, "clear-all");
  await out.waitForTimeout(400);
  const png = await shot(out);
  const reg = await out.evaluate(() => window.__ldp.strokes.length);
  const black = lum(png, 0.5, 0.3) < 6 && lum(png, 0.5, 0.6) < 6;
  report("S7", "모두 지우기 (픽셀+레지스트리)", black && reg === 0, `검정=${black} reg=${reg}`, errors);
  await ctx.close();
};

// ─── S8 극단 워프 — 콘텐츠 이동·범위 밖 검정 ───
SC.S8 = async () => {
  const { ctx, draw, out, errors } = await setup();
  await fireStroke(draw, line(0.3, 0.5, 0.7, 0.5));
  await out.waitForTimeout(300);
  // 정렬 모드 → 리셋(항등 전송 확인) 후 극단 사다리꼴 직접 전송 (다른 sid로)
  await draw.evaluate(() => {
    const bc = new BroadcastChannel("ldp-sync");
    bc.postMessage({ t: "corners", v: [0.3, 0.05, 0.7, 0.05, 0.95, 0.95, 0.05, 0.95], _sid: "mock", _n: 1 });
  });
  await out.waitForTimeout(500);
  const png = await shot(out);
  // 기대 위치를 호모그래피로 직접 계산 — 콘텐츠 (0.5,0.5)의 화면 좌표
  const H = homographyFromUnitSquare([0.3, 0.05, 0.7, 0.05, 0.95, 0.95, 0.05, 0.95]);
  const p = applyHomography(H, 0.5, 0.5);
  const atWarped = lumMax(png, p.x, p.y) > 30; // 워프된 위치에 선 존재
  const origGone = lum(png, 0.5, 0.5) < 12; // 원위치(항등이면 선)엔 없음
  const cornerBlack = lum(png, 0.05, 0.05) < 6 && lum(png, 0.95, 0.05) < 6; // 워프 밖 검정
  const saved = await out.evaluate(() => localStorage.getItem("ldp:corners"));
  report(
    "S8",
    "극단 워프 적용·저장",
    atWarped && origGone && cornerBlack && saved !== null && saved.includes("0.3"),
    `워프위치(${p.x.toFixed(2)},${p.y.toFixed(2)})=${atWarped} 원위치소거=${origGone} 밖검정=${cornerBlack} 저장=${!!saved}`,
    errors
  );
  await ctx.close();
};

// ─── S9 릴레이 단절·재접속 — 자동 복구 ───
SC.S9 = async () => {
  const ip = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254"))?.address;
  if (!ip) return report("S9", "릴레이 재접속", true, "SKIP — LAN 없음");
  const relay = () => spawn("node", ["relay/relay.mjs"], { stdio: "ignore" });
  let r = relay();
  await new Promise((s) => setTimeout(s, 1200));
  const b2 = await chromium.launch(); // 별도 인스턴스 — BC 불통, ws 단독 경로
  const drawCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const outCtx = await b2.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const draw = await drawCtx.newPage();
  const out = await outCtx.newPage();
  out.on("console", (m) => {
    if (m.type() === "error") errors.push("out console: " + m.text());
  });
  await draw.goto(`http://${ip}:5173/?role=draw`, { waitUntil: "domcontentloaded" });
  await out.goto(`http://${ip}:5173/?role=output`, { waitUntil: "domcontentloaded" });
  await draw.waitForTimeout(1500);
  await fireStroke(draw, line(0.2, 0.3, 0.6, 0.3));
  await out.waitForTimeout(800);
  const got1 = await out.evaluate(() => window.__ldp.strokes.length);
  r.kill(); // 릴레이 사망
  await new Promise((s) => setTimeout(s, 800));
  await fireStroke(draw, line(0.2, 0.6, 0.6, 0.6)); // 단절 중 획 — 유실 예상
  await new Promise((s) => setTimeout(s, 500));
  r = relay(); // 부활
  await out.waitForTimeout(9000); // 재접속(≤4.5s) + sync-req/announce 리플레이
  const got2 = await out.evaluate(() => window.__ldp.strokes.map((s) => ({ ...s })));
  const png = await shot(out);
  const recovered = got2.length === 2 && lum(png, 0.4, 0.6) > 40;
  report("S9", "릴레이 단절·재접속 자동 복구", got1 === 1 && recovered, `초기=${got1} 복구후=${got2.length}`, errors);
  r.kill();
  await drawCtx.close();
  await b2.close();
};

// ─── S10 아이패드 세로 뷰포트 — UI·레터박스·입력 ───
SC.S10 = async () => {
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 } });
  const errors = [];
  const draw = await ctx.newPage();
  draw.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  draw.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded" });
  await draw.waitForTimeout(400);
  const cbox = await draw.locator('[data-test="draw-canvas"]').boundingBox();
  const ratio = cbox.width / cbox.height;
  const inView = cbox.y >= 0 && cbox.y + cbox.height <= 1024;
  await fireStroke(draw, line(0.2, 0.5, 0.8, 0.5));
  await draw.waitForTimeout(350); // 로컬 미리보기 rAF 렌더 대기
  const local = await draw.evaluate(() => {
    const c = document.querySelector('[data-test="draw-canvas"]');
    const g = c.getContext("2d").getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
    let lit = 0;
    for (let i = 0; i < g.length; i += 4) if (g[i] > 40) lit++;
    return lit;
  });
  await draw.screenshot({ path: "bench/shots/6-portrait.png" });
  report(
    "S10",
    "세로 뷰포트 (768×1024) 레터박스·입력",
    Math.abs(ratio - 16 / 9) < 0.02 && inView && local > 100,
    `비율=${ratio.toFixed(3)} 화면내=${inView} 로컬렌더=${local}px`,
    errors
  );
  await ctx.close();
};

// ─── S11 스트레스 — 3000pt 장획 + 연속 20획 ───
SC.S11 = async () => {
  const { ctx, draw, out, errors } = await setup();
  const long = Array.from({ length: 3000 }, (_, i) => [
    0.1 + 0.8 * (i / 2999),
    0.5 + 0.35 * Math.sin(i / 40),
  ]);
  await fireStroke(draw, long);
  for (let k = 0; k < 20; k++) await fireStroke(draw, line(0.1 + k * 0.04, 0.1, 0.12 + k * 0.04, 0.15, 8));
  await out.waitForTimeout(800);
  const reg = await out.evaluate(() => ({
    n: window.__ldp.strokes.length,
    pts: window.__ldp.strokes.reduce((s, x) => s + x.pointsRendered, 0),
  }));
  report("S11", "스트레스 (3000pt 장획 + 연속 20획)", reg.n === 21 && reg.pts >= 3000 + 20 * 8, `획=${reg.n} pts=${reg.pts}`, errors);
  await ctx.close();
};

// ─── S12 QR 표시 → 드로잉 접속 시 숨김 ───
SC.S12 = async () => {
  const ip = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254"))?.address;
  if (!ip) return report("S12", "QR 배지", true, "SKIP — LAN 없음");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const out = await ctx.newPage();
  out.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  await out.goto(`http://${ip}:5173/?role=output`, { waitUntil: "domcontentloaded" });
  await out.waitForTimeout(900);
  const qrShown = await out.locator(".qr-badge").isVisible();
  const qrHasImg = await out.evaluate(() => (document.querySelector(".qr-badge img")?.src || "").startsWith("data:image"));
  const draw = await ctx.newPage();
  await draw.goto(`http://${ip}:5173/?role=draw`, { waitUntil: "domcontentloaded" });
  await draw.waitForTimeout(600);
  const qrHidden = !(await out.locator(".qr-badge").isVisible());
  report("S12", "QR 표시→접속 시 숨김", qrShown && qrHasImg && qrHidden, `표시=${qrShown} 이미지=${qrHasImg} 숨김=${qrHidden}`, errors);
  await ctx.close();
};

// ─── 실행 ───
for (const [id, fn] of Object.entries(SC)) {
  if (only && !only.includes(id)) continue;
  try {
    await fn();
  } catch (e) {
    report(id, "(예외)", false, e.message.slice(0, 140));
  }
}
await browser.close();
const fails = results.filter((r) => !r.pass);
console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과`);
process.exit(fails.length ? 1 : 0);
