// 격자 워프 (개정 2호) — N×M 제어점의 Catmull-Rom 텐서 보간.
// 순수 수학 모듈 (테스트에서 직접 임포트해 수치 대조).
// 좌표는 전부 0..1 정규화, y아래. 제어점은 행 우선 [{x,y}] (ny행 × nx열).

import { homographyFromUnitSquare, applyHomography } from "./homography.js";

function cr1(p0, p1, p2, p3, t) {
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

/** 1차원 Catmull-Rom (끝점 클램프) — vals.length ≥ 2, t ∈ [0,1] */
function splineAxis(vals, t) {
  const n = vals.length;
  const seg = Math.min(n - 2, Math.max(0, Math.floor(t * (n - 1))));
  const lt = t * (n - 1) - seg;
  const p = (i) => vals[Math.min(n - 1, Math.max(0, i))];
  return cr1(p(seg - 1), p(seg), p(seg + 1), p(seg + 2), lt);
}

/** 격자 보간: 콘텐츠 (u,v) → 화면 정규화 좌표 (y아래) */
export function sampleGrid(points, nx, ny, u, v) {
  const rx = new Array(ny);
  const ry = new Array(ny);
  for (let r = 0; r < ny; r++) {
    const xs = new Array(nx);
    const ys = new Array(nx);
    for (let c = 0; c < nx; c++) {
      const p = points[r * nx + c];
      xs[c] = p.x;
      ys[c] = p.y;
    }
    rx[r] = splineAxis(xs, u);
    ry[r] = splineAxis(ys, u);
  }
  return { x: splineAxis(rx, v), y: splineAxis(ry, v) };
}

/** 항등 격자 — 화면 균등 배치 */
export function identityGrid(nx, ny) {
  const pts = [];
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) pts.push({ x: c / (nx - 1), y: r / (ny - 1) });
  return pts;
}

/** 현재 4코너 호모그래피를 샘플링해 격자 초기화 — 모드 전환 시 연속성 보장 */
export function gridFromCorners(corners, nx, ny) {
  const H = homographyFromUnitSquare(corners);
  const pts = [];
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) pts.push(applyHomography(H, c / (nx - 1), r / (ny - 1)));
  return pts;
}

/** 격자 밀도 변경 — 기존 격자를 보간 재표집해 형태 유지 */
export function resampleGrid(points, nx, ny, nx2, ny2) {
  const pts = [];
  for (let r = 0; r < ny2; r++)
    for (let c = 0; c < nx2; c++) pts.push(sampleGrid(points, nx, ny, c / (nx2 - 1), r / (ny2 - 1)));
  return pts;
}

export function validGrid(mode, nx, ny, points) {
  if (mode === "corners") return true;
  if (mode !== "grid") return false;
  if (![3, 4, 5].includes(nx) || ![3, 4, 5].includes(ny)) return false;
  return (
    Array.isArray(points) &&
    points.length === nx * ny &&
    points.every((p) => p && isFinite(p.x) && isFinite(p.y))
  );
}
