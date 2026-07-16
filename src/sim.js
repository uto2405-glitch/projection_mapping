// 가상 표면 시뮬레이터 (ORDER-05) — 프로젝터 없이 브라우저에서 굴곡면 맵핑 연습.
// 절차적 굴곡면(커튼 주름·원기둥·지구본)을 배경으로 깔고, 출력 캔버스를
// screen 블렌드로 얹으면 프로젝터의 가산 광학(검정=빛 없음)이 재현된다.
// 채점기는 sim 파라미터를 사용하지 않는다 — 계약 무영향.

const W = 480;
const H = 270;

export function drawSimSurface(canvas, kind) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const d = img.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      let L = 30; // 배경 어두운 벽

      if (kind === "curtain") {
        // 세로 주름 커튼 — 접힘의 명암 + 아래로 갈수록 살짝 어둡게
        const f = Math.sin(u * Math.PI * 2 * 7 + Math.sin(v * 2.2) * 0.6);
        L = 96 + 66 * Math.max(f, 0) ** 0.75 - 34 * Math.max(-f, 0) ** 0.75;
        L *= 1 - v * 0.18;
      } else if (kind === "column") {
        // 중앙 원기둥 — 실린더 셰이딩, 좌측광
        const dd = (u - 0.5) / 0.26;
        if (Math.abs(dd) <= 1) {
          const n = Math.sqrt(1 - dd * dd);
          L = 62 + 150 * n * (0.72 - 0.28 * dd);
        } else {
          L = 26 + 14 * v;
        }
      } else if (kind === "globe") {
        // 지구본 — 구면 셰이딩, 좌상단 하이라이트 (VISION case-globe의 책상 대역)
        const cx = 0.5 * W;
        const cy = 0.54 * H;
        const R = 0.44 * H;
        const dx = (x - cx) / R;
        const dy = (y - cy) / R;
        const r2 = dx * dx + dy * dy;
        if (r2 <= 1) {
          const n = Math.sqrt(1 - r2);
          const light = Math.max(0.15, 0.75 * n - 0.35 * dx - 0.35 * dy + 0.25);
          L = 46 + 175 * Math.min(1, light);
        } else {
          L = 24;
        }
      }

      const i = (y * W + x) * 4;
      d[i] = L;
      d[i + 1] = L * 0.97;
      d[i + 2] = L * 0.93;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export const SIM_KINDS = ["curtain", "column", "globe"];
