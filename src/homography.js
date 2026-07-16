// 4코너 호모그래피 — 단위 사각형(0..1, y아래) ↔ 임의 사각형 사영 변환.
// CLAUDE.md: "셰이더는 호모그래피 행렬 하나로 충분하다" — 역사상 워프용 역행렬 제공.
// 코너 순서: [x0,y0, x1,y1, x2,y2, x3,y3] = TL, TR, BR, BL (ldp:corners 계약과 동일)

/** 단위 사각형 → 사각형(corners) 사상 3×3 행렬 (Heckbert 폐형식) */
export function homographyFromUnitSquare(c) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  // (u,v): (0,0)→p0(TL), (1,0)→p1(TR), (1,1)→p2(BR), (0,1)→p3(BL)
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;

  let g = 0;
  let h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    // 사영 성분
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const cc = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  // 행 우선: [[a,b,c],[d,e,f],[g,h,1]]
  return [a, b, cc, d, e, f, g, h, 1];
}

/** 3×3 역행렬 (행 우선). 특이 행렬이면 항등 반환 — 워프가 죽기보다 항등이 낫다 */
export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const id = 1 / det;
  return [
    A * id,
    -(b * i - c * h) * id,
    (b * f - c * e) * id,
    B * id,
    (a * i - c * g) * id,
    -(a * f - c * d) * id,
    C * id,
    -(a * h - b * g) * id,
    (a * e - b * d) * id,
  ];
}

/** 화면(y아래 정규화) → 콘텐츠 UV 역사상 행렬. GLSL mat3용 열 우선 배열로 반환 */
export function inverseWarpMatrixColumnMajor(corners) {
  const inv = invert3(homographyFromUnitSquare(corners));
  // 행 우선 [r0c0 r0c1 r0c2 r1c0 ...] → 열 우선 [c0r0 c0r1 c0r2, c1r0 ...]
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
}

/** 정사상 적용 (행 우선 3×3): 콘텐츠(0..1, y아래) → 화면(0..1, y아래) */
export function applyHomography(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  const iw = Math.abs(w) < 1e-9 ? 0 : 1 / w;
  return { x: (m[0] * x + m[1] * y + m[2]) * iw, y: (m[3] * x + m[4] * y + m[5]) * iw };
}

export const IDENTITY_CORNERS = [0, 0, 1, 0, 1, 1, 0, 1];
