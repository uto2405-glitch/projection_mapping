// 센서 리액티브 (?role=sensor, ORDER-06 — VISION #5 1차 경로) — 웹캠 프레임 차분.
// ML 없이 모션 중심·강도만 추출한다: 전부 로컬 연산(C1), 어떤 기기 웹캠이든 동작.
// 발행: {t:'motion', x, y, k} (콘텐츠 정규화 좌표, 거울 반전) → 출력이 별 반짝임 스폰.
// "손을 흔들면 별이 손을 따라다닌다" (취향 앵커의 그 장면, VISION #5)

import { openSync } from "./sync.js";

const PW = 160;
const PH = 90; // 처리 해상도 — 충분히 민감하고 어디서나 싸다
const TICK_MS = 90; // ~11Hz 발행

export function startSensor(root) {
  root.innerHTML = `
    <div class="sensor-page">
      <h2>👋 센서 — 모션 리액티브</h2>
      <p class="sensor-status">카메라 준비 중…</p>
      <div class="sensor-stage">
        <video class="sensor-video" playsinline muted></video>
        <canvas class="sensor-overlay"></canvas>
      </div>
      <label class="slider-label">감도
        <input type="range" min="8" max="60" value="24" data-test="sensor-threshold" />
      </label>
      <p class="sensor-hint">이 페이지를 출력 PC(웹캠이 관객을 향하게)에서 열어두면,
      움직임이 있는 곳을 따라 프로젝션에 별이 반짝입니다.</p>
    </div>`;

  const sync = openSync();
  const video = root.querySelector(".sensor-video");
  const overlay = root.querySelector(".sensor-overlay");
  const status = root.querySelector(".sensor-status");
  const thInput = root.querySelector('[data-test="sensor-threshold"]');
  overlay.width = PW;
  overlay.height = PH;
  const octx = overlay.getContext("2d");

  const proc = document.createElement("canvas");
  proc.width = PW;
  proc.height = PH;
  const pctx = proc.getContext("2d", { willReadFrequently: true });
  let prev = null;
  let consecutive = 0;

  // 보안 컨텍스트 가드 — http LAN 오리진에서는 getUserMedia 자체가 없다.
  // 센서는 통상 출력 PC에서 돌므로 localhost로 열면 해결된다 (안내 메시지).
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent =
      "🔴 이 주소에서는 카메라를 쓸 수 없습니다 — 출력 PC에서 http://localhost:5173/?role=sensor 로 여세요 (카메라는 보안 컨텍스트 전용)";
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ video: { width: 320, height: 180 }, audio: false })
    .then((stream) => {
      video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      if (track)
        track.onended = () => {
          status.textContent = "🔴 카메라 연결이 끊겼습니다 — 케이블·권한을 확인하세요";
        };
      return video.play();
    })
    .then(() => {
      status.textContent = "🟢 감지 중 — 카메라 앞에서 움직여 보세요";
      setInterval(tick, TICK_MS);
    })
    .catch((err) => {
      status.textContent = "🔴 카메라를 열 수 없습니다: " + err.message;
    });

  function tick() {
    if (video.readyState < 2) return;
    pctx.drawImage(video, 0, 0, PW, PH);
    const cur = pctx.getImageData(0, 0, PW, PH).data;
    if (!prev) {
      prev = new Uint8ClampedArray(cur);
      return;
    }
    const th = +thInput.value;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < PH; y += 2) {
      for (let x = 0; x < PW; x += 2) {
        const i = (y * PW + x) * 4;
        const dl =
          Math.abs(cur[i] - prev[i]) +
          Math.abs(cur[i + 1] - prev[i + 1]) +
          Math.abs(cur[i + 2] - prev[i + 2]);
        if (dl > th * 3) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    prev.set(cur);
    octx.clearRect(0, 0, PW, PH);
    // 노이즈 플로어 — 어두운 현장 고게인 웹캠의 유령 모션 억제: 최소 픽셀 수 + 2틱 연속
    if (n >= 15) consecutive++;
    else consecutive = 0;
    if (consecutive >= 2) {
      const cx = sx / n / (PW - 1);
      const cy = sy / n / (PH - 1);
      const k = Math.min(1, n / 400);
      // 거울 반전 — 관객이 오른손을 들면 화면 오른쪽에서 반응
      sync.send({ t: "motion", x: 1 - cx, y: cy, k });
      octx.fillStyle = "rgba(255, 209, 234, 0.9)";
      octx.beginPath();
      octx.arc(cx * PW, cy * PH, 4 + k * 8, 0, Math.PI * 2);
      octx.fill();
    }
  }

  // 화면 꺼짐 방지 — 상설 센서 노드
  navigator.wakeLock?.request("screen").catch(() => {});
}
