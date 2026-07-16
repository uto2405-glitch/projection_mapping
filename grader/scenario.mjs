// 표준 부하 시나리오 생성기 — SCORECARD "표준 부하 시나리오" 구현
// 시드 고정: 어떤 머신에서 돌려도 같은 200획이 나온다.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 20260716;
export const STROKES_PER_SEC = 3;
export const TOTAL_STROKES = 200;
export const POINT_HZ = 120; // 애플펜슬 급 입력 밀도

// 반환: [{ id, startMs, points: [{x, y, dtMs}] }]  (x, y는 0..1 정규화)
export function buildScenario(seed = SEED, total = TOTAL_STROKES) {
  const rnd = mulberry32(seed);
  const strokes = [];
  const gapMs = 1000 / STROKES_PER_SEC;

  for (let i = 0; i < total; i++) {
    const kind = rnd();
    let nPoints;
    if (kind < 0.2) nPoints = 1 + Math.floor(rnd() * 3);        // 점 20%
    else if (kind < 0.7) nPoints = 20 + Math.floor(rnd() * 41); // 중간 곡선 50%
    else nPoints = 80 + Math.floor(rnd() * 121);                // 긴 곡선 30%

    const cx = 0.1 + rnd() * 0.8;
    const cy = 0.1 + rnd() * 0.8;
    const r = 0.03 + rnd() * 0.22;
    const a0 = rnd() * Math.PI * 2;
    const spin = (rnd() - 0.5) * 4;
    const wob = rnd() * 0.4;

    const points = [];
    for (let p = 0; p < nPoints; p++) {
      const t = nPoints === 1 ? 0 : p / (nPoints - 1);
      const ang = a0 + spin * t * Math.PI;
      const rr = r * (0.4 + 0.6 * t) * (1 + wob * Math.sin(t * 9));
      points.push({
        x: Math.min(0.98, Math.max(0.02, cx + Math.cos(ang) * rr)),
        y: Math.min(0.98, Math.max(0.02, cy + Math.sin(ang) * rr)),
        dtMs: 1000 / POINT_HZ,
      });
    }
    strokes.push({ id: `s${String(i).padStart(3, "0")}`, startMs: Math.round(i * gapMs), points });
  }
  return strokes;
}

export function totalPoints(strokes) {
  return strokes.reduce((n, s) => n + s.points.length, 0);
}
