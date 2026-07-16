// 채점기 — SCORECARD v0.1 자동판정(A) 실행기
// 원칙: 바깥에서 관측한다(C4). 앱의 자가 보고는 픽셀 진실 검사로 교차검증한다.
// 사용: node grader/grade.mjs [--quick]   (--quick은 참고용 스모크, 공식 판정 아님)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenario, totalPoints } from "./scenario.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LDP_URL || "http://localhost:5173";
const QUICK = process.argv.includes("--quick");
const N_STROKES = QUICK ? 40 : 200;
const OBSERVE_MS = QUICK ? 25_000 : 300_000; // A3/A4: 5분 세션(공식)
const R = [];
const add = (id, status, detail = "") => R.push({ id, status, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

function report(exitCode) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n== SCORECARD 자동판정 리포트" + (QUICK ? " (QUICK — 참고용, 공식 판정 아님)" : "") + " ==");
  for (const r of R) console.log(`${pad(r.id, 4)} ${pad(r.status, 8)} ${r.detail}`);
  const fails = R.filter((r) => r.status === "FAIL").length;
  const pend = R.filter((r) => r.status === "PENDING").length;
  console.log(`\n요약: PASS ${R.filter((r) => r.status === "PASS").length} · FAIL ${fails} · PENDING ${pend}`);
  console.log(fails ? "판정: 불합격 (RED)" : pend ? "판정: 책상 항목 통과 — 실기기 항목 PENDING" : "판정: 전체 통과");
  fs.writeFileSync(path.join(__dirname, "last-report.json"), JSON.stringify({ when: new Date().toISOString(), quick: QUICK, results: R }, null, 2));
  process.exit(exitCode ?? (fails ? 1 : 0));
}

async function reachable(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; }
  catch { return false; }
}

// PNG(스크린샷) 휘도 분석 — pngjs로 디코드
async function luminanceStats(buf) {
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(buf);
  let lit = 0, sum = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    sum += l; if (l > 40) lit++;
  }
  return { litRatio: lit / total, mean: sum / total, w: png.width, h: png.height };
}

async function main() {
  if (!(await reachable(BASE))) {
    for (const id of ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]) add(id, "FAIL", `앱에 접속 불가(${BASE}) — 미구현이거나 npm run dev 미기동`);
    add("A2", "PENDING", "실기기 항목 (승격 시 측정)");
    add("D2", "FAIL", "효과 검증 불가 — 앱 부재");
    return report(1);
  }

  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { add("A1", "FAIL", "playwright 미설치 — grader에서 npm install 후 npx playwright install chromium"); return report(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const hook = (p, tag) => { p.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error") errors.push(`${tag} console: ${m.text()}`); }); };

  const draw = await ctx.newPage(); hook(draw, "draw");
  const out = await ctx.newPage(); hook(out, "out");
  try {
    await draw.goto(`${BASE}/?role=draw`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await out.goto(`${BASE}/?role=output`, { waitUntil: "domcontentloaded", timeout: 10000 });
  } catch (e) { add("A1", "FAIL", `역할 URL 로드 실패: ${e.message}`); await browser.close(); return report(1); }

  // D2 사전조건: 효과 토글 ON 강제 + 상태 검증
  try {
    for (const t of ["toggle-trail", "toggle-glow"]) {
      const el = draw.locator(`[data-test="${t}"]`);
      if ((await el.getAttribute("aria-pressed")) !== "true") await el.click({ timeout: 3000 });
      if ((await el.getAttribute("aria-pressed")) !== "true") throw new Error(`${t} aria-pressed!=true`);
    }
  } catch (e) { add("D2", "FAIL", `효과 토글 계약 위반: ${e.message}`); }

  // 채점기 소유 fps 카운터 주입 (외부 관측 — 앱이 위조 불가)
  await out.evaluate(() => { window.__graderFrames = 0; const loop = () => { window.__graderFrames++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });

  const outCanvas = out.locator('[data-test="output-canvas"]');
  const drawCanvas = draw.locator('[data-test="draw-canvas"]');
  let box;
  try { box = await drawCanvas.boundingBox(); if (!box) throw new Error("draw-canvas 없음"); }
  catch (e) { add("A1", "FAIL", `드로잉 캔버스 계약 위반: ${e.message}`); await browser.close(); return report(1); }

  const beforeShot = await outCanvas.screenshot().catch(() => null);
  const strokes = buildScenario(undefined, N_STROKES);
  const latencies = [];
  const f0 = await out.evaluate(() => window.__graderFrames);
  const tInjectStart = Date.now();

  // 획 주입: draw 페이지 캔버스에 PointerEvent 시퀀스 발사
  for (const s of strokes) {
    const t0 = await out.evaluate(() => performance.now());
    await draw.evaluate(({ pts, box }) => {
      const el = document.querySelector('[data-test="draw-canvas"]');
      const fire = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerType: "pen", isPrimary: true, bubbles: true, clientX: box.x + x * box.width, clientY: box.y + y * box.height, buttons: type === "pointerup" ? 0 : 1 }));
      fire("pointerdown", pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) fire("pointermove", pts[i].x, pts[i].y);
      fire("pointerup", pts[pts.length - 1].x, pts[pts.length - 1].y);
    }, { pts: s.points, box });
    // 렌더 마크 대기 (자가 보고 — 아래 픽셀 진실 검사로 교차검증)
    const mark = await out.evaluate(async (id) => {
      for (let i = 0; i < 40; i++) { const m = performance.getEntriesByName("ldp:render:" + id); if (m.length) return m[0].startTime; await new Promise((r) => setTimeout(r, 5)); }
      return null;
    }, s.id);
    if (mark !== null) latencies.push(mark - t0);
    const elapsed = Date.now() - tInjectStart;
    const target = s.startMs + (1000 / 3);
    if (target > elapsed) await sleep(Math.min(target - elapsed, 400));
  }

  // 픽셀 진실 검사: 주입 후 출력 캔버스에 실제 변화가 있어야 한다 (C4)
  let pixelTruth = false, glowStats = null;
  try {
    const afterShot = await outCanvas.screenshot();
    glowStats = await luminanceStats(afterShot);
    if (beforeShot) { const b = await luminanceStats(beforeShot); pixelTruth = Math.abs(glowStats.litRatio - b.litRatio) > 0.002 || Math.abs(glowStats.mean - b.mean) > 1; }
    else pixelTruth = glowStats.litRatio > 0.002;
  } catch (e) { add("A1", "FAIL", `픽셀 진실 검사 실패: ${e.message}`); }

  // A1
  if (latencies.length === 0) add("A1", "FAIL", "렌더 마크(ldp:render:*)가 하나도 관측되지 않음 — 계약 미구현");
  else if (!pixelTruth) add("A1", "FAIL", "마크는 있으나 출력 픽셀 변화 없음 — 자가 보고 의심(C4)");
  else { const med = median(latencies); add("A1", med <= 50 ? "PASS" : "FAIL", `같은기기 지연 중앙값 ${med.toFixed(1)}ms (n=${latencies.length}, 채점기 오버헤드 포함 보수 측정)`); }
  add("A2", "PENDING", "실기기 두 대 + 릴레이 — 승격 시 측정");

  // 관측 구간 유지 후 A3/A4
  const injectDur = Date.now() - tInjectStart;
  if (OBSERVE_MS > injectDur) await sleep(OBSERVE_MS - injectDur);
  const f1 = await out.evaluate(() => window.__graderFrames);
  const fps = (f1 - f0) / ((Date.now() - tInjectStart) / 1000);
  add("A3", fps >= 55 ? "PASS" : "FAIL", `출력 평균 ${fps.toFixed(1)}fps (${QUICK ? "quick 구간" : "5분 세션"})`);
  add("A4", errors.length === 0 ? "PASS" : "FAIL", errors.length ? `에러 ${errors.length}건: ${errors[0]}` : "크래시·콘솔 에러 0");

  // A5·A9: 읽기 전용 레지스트리 + 교차검증
  try {
    const reg = await out.evaluate(() => (window.__ldp && window.__ldp.strokes) ? window.__ldp.strokes.map((s) => ({ id: s.id, p: s.pointsRendered })) : null);
    if (!reg) { add("A5", "FAIL", "window.__ldp.strokes 계약 미구현"); add("A9", "FAIL", "동일"); }
    else {
      const got = new Set(reg.map((r) => r.id));
      const missing = strokes.filter((s) => !got.has(s.id)).length;
      add("A5", missing === 0 && pixelTruth ? "PASS" : "FAIL", `유실 ${missing}/${strokes.length} (창 2개 모의${pixelTruth ? "" : ", 픽셀 진실 불충족"})`);
      const rendered = reg.reduce((n, r) => n + (r.p || 0), 0);
      const injected = totalPoints(strokes);
      const ratio = rendered / injected;
      add("A9", ratio >= 0.9 ? "PASS" : "FAIL", `충실도 ${(ratio * 100).toFixed(1)}% (${rendered}/${injected}pt)`);
    }
  } catch (e) { add("A5", "FAIL", e.message); add("A9", "FAIL", e.message); }

  // A6: 4코너 저장 복원
  try {
    const sample = JSON.stringify([0.05, 0.05, 0.95, 0.08, 0.93, 0.94, 0.06, 0.9]);
    await out.evaluate((v) => localStorage.setItem("ldp:corners", v), sample);
    await out.reload({ waitUntil: "domcontentloaded" });
    const back = await out.evaluate(() => localStorage.getItem("ldp:corners"));
    const alive = await out.locator('[data-test="output-canvas"]').count();
    add("A6", back === sample && alive > 0 ? "PASS" : "FAIL", back === sample ? "복원 일치, 리로드 생존" : "값 불일치 또는 캔버스 소실");
  } catch (e) { add("A6", "FAIL", e.message); }

  // A7: PNG 내보내기
  try {
    const dl = draw.waitForEvent("download", { timeout: 8000 });
    await draw.locator('[data-test="export-png"]').click();
    const file = await dl;
    const p = path.join(__dirname, "export-check.png");
    await file.saveAs(p);
    const buf = fs.readFileSync(p);
    const isPng = buf.length > 1024 && buf[0] === 0x89 && buf[1] === 0x50;
    add("A7", isPng ? "PASS" : "FAIL", isPng ? `PNG ${(buf.length / 1024).toFixed(0)}KB` : "PNG 시그니처/크기 불충족");
  } catch (e) { add("A7", "FAIL", `내보내기 실패: ${e.message}`); }

  // A8: 백킹 해상도
  try {
    const res = await out.evaluate(() => { const c = document.querySelector('[data-test="output-canvas"]'); return c ? { w: c.width, h: c.height } : null; });
    add("A8", res && res.w >= 1920 && res.h >= 1080 ? "PASS" : "FAIL", res ? `${res.w}×${res.h}` : "캔버스 없음");
  } catch (e) { add("A8", "FAIL", e.message); }

  // D2: 효과 실재 휴리스틱 (토글 검증은 위에서, 여기선 발광 픽셀 확산)
  if (!R.find((r) => r.id === "D2")) {
    if (glowStats) add("D2", glowStats.litRatio > 0.005 && glowStats.litRatio < 0.8 ? "PASS" : "FAIL", `발광 픽셀 비율 ${(glowStats.litRatio * 100).toFixed(2)}% (휴리스틱 + 시사 B2로 최종 판정)`);
    else add("D2", "FAIL", "스크린샷 분석 불가");
  }

  await browser.close();
  report();
}

main().catch((e) => { add("A1", "FAIL", `채점기 예외: ${e.message}`); report(1); });
