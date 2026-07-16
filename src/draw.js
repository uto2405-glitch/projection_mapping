// 드로잉 UI (?role=draw) — 아이패드 사파리가 1급 시민.
// Pointer Events + getCoalescedEvents, touch-action 차단, 로컬 미리보기 즉시 렌더.
// 획·상태 변경은 전부 동기화 버스로 발행한다 (출력이 구독).

import { createInk } from "./ink.js";
import { openSync } from "./sync.js";

// 취향 앵커(개정 1호) 계열의 파스텔 발광 톤 + 기본 흰색
const SWATCHES = [
  "#ffffff",
  "#ffd1ea", // 파스텔 핑크
  "#c9e6ff", // 파스텔 블루
  "#d9ffd1", // 파스텔 그린
  "#fff3c4", // 파스텔 옐로
  "#e6d1ff", // 파스텔 라벤더
];

export function startDraw(root) {
  root.innerHTML = `
    <div class="draw-page">
      <div class="toolbar">
        <div class="tgroup" aria-label="펜">
          <div class="swatches">
            ${SWATCHES.map(
              (c, i) =>
                `<button type="button" class="swatch${i === 0 ? " active" : ""}" data-color="${c}" style="--c:${c}" aria-label="색 ${c}"></button>`
            ).join("")}
          </div>
          <input type="color" value="#ffffff" data-test="pen-color" aria-label="사용자 색" />
          <label class="slider-label">굵기
            <input type="range" min="1" max="40" value="6" data-test="pen-width" aria-label="펜 굵기" />
          </label>
        </div>
        <div class="tgroup" aria-label="도구">
          <button type="button" class="tbtn" data-test="tool-eraser" aria-pressed="false">⌫ 지우개</button>
          <button type="button" class="tbtn danger" data-test="clear-all">🗑 모두 지우기</button>
        </div>
        <div class="tgroup" aria-label="연출">
          <button type="button" class="tbtn" data-test="toggle-glow" aria-pressed="false">✨ 글로우</button>
          <button type="button" class="tbtn" data-test="toggle-trail" aria-pressed="false">💫 잔상</button>
          <label class="slider-label">잔상 시간
            <input type="range" min="2" max="30" value="8" step="1" data-test="trail-seconds" aria-label="잔상 시간(초)" />
            <span class="trail-secs-value">8s</span>
          </label>
          <button type="button" class="tbtn" data-test="trail-permanent" aria-pressed="false">∞ 영구</button>
        </div>
        <div class="tgroup" aria-label="내보내기">
          <button type="button" class="tbtn" data-test="export-png">📷 PNG 저장</button>
        </div>
      </div>
      <div class="canvas-wrap">
        <canvas data-test="draw-canvas"></canvas>
      </div>
    </div>`;

  const canvas = root.querySelector('[data-test="draw-canvas"]');
  const wrap = root.querySelector(".canvas-wrap");
  const sync = openSync();
  const ink = createInk({ canvas, width: 1920, height: 1080 });

  // ─── 상태 ───
  const state = {
    color: "#ffffff",
    width: 6,
    erase: false,
    fx: { trail: false, glow: false, trailSeconds: 8, trailPermanent: false },
  };
  // 획 ID — 채점기가 시나리오 id(s000…)와 레지스트리를 교차대조하므로 이 형식을 유지한다
  let seq = 0;
  const newId = () => "s" + String(seq++).padStart(3, "0");

  // ─── 캔버스 크기 (CSS×DPR 백킹) ───
  function sizeCanvas() {
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ink.resize(Math.max(1, r.width * dpr), Math.max(1, r.height * dpr));
  }
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  // ─── 포인터 입력 ───
  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };

  let activeId = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트(채점기)는 활성 포인터가 없어 캡처 불가 — 무해 */
    }
    const id = newId();
    activeId = id;
    const meta = { color: state.color, width: state.width, erase: state.erase };
    const p = norm(e);
    ink.begin(id, meta);
    ink.addPoints(id, [p]);
    sync.send({ t: "s", id, ...meta, p: [p] });
  });

  canvas.addEventListener("pointermove", (e) => {
    if (activeId === null) return;
    e.preventDefault();
    // 애플펜슬 120Hz 밀도 보존 — 코얼레스드 이벤트 전개
    const evs =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];
    const pts = evs.map(norm);
    ink.addPoints(activeId, pts);
    sync.send({ t: "a", id: activeId, p: pts });
  });

  const finish = (e) => {
    if (activeId === null) return;
    if (e) e.preventDefault();
    ink.end(activeId);
    sync.send({ t: "e", id: activeId });
    activeId = null;
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ─── 툴바 ───
  const colorInput = root.querySelector('[data-test="pen-color"]');
  const widthInput = root.querySelector('[data-test="pen-width"]');
  const eraserBtn = root.querySelector('[data-test="tool-eraser"]');
  const clearBtn = root.querySelector('[data-test="clear-all"]');
  const glowBtn = root.querySelector('[data-test="toggle-glow"]');
  const trailBtn = root.querySelector('[data-test="toggle-trail"]');
  const trailSecs = root.querySelector('[data-test="trail-seconds"]');
  const trailSecsValue = root.querySelector(".trail-secs-value");
  const permBtn = root.querySelector('[data-test="trail-permanent"]');
  const exportBtn = root.querySelector('[data-test="export-png"]');

  function setEraser(on) {
    state.erase = on;
    eraserBtn.setAttribute("aria-pressed", String(on));
  }

  for (const sw of root.querySelectorAll(".swatch")) {
    sw.addEventListener("click", () => {
      state.color = sw.dataset.color;
      colorInput.value = sw.dataset.color;
      setEraser(false);
      root.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("active", b === sw));
    });
  }
  colorInput.addEventListener("input", () => {
    state.color = colorInput.value;
    setEraser(false);
    root.querySelectorAll(".swatch").forEach((b) => b.classList.remove("active"));
  });
  widthInput.addEventListener("input", () => {
    state.width = +widthInput.value;
  });
  eraserBtn.addEventListener("click", () => setEraser(!state.erase));

  clearBtn.addEventListener("click", () => {
    ink.clear();
    sync.send({ t: "clear" });
  });

  const sendFx = () => sync.send({ t: "fx", fx: { ...state.fx } });
  const bindToggle = (btn, key) => {
    btn.addEventListener("click", () => {
      state.fx[key] = !state.fx[key];
      btn.setAttribute("aria-pressed", String(state.fx[key]));
      sendFx();
    });
  };
  bindToggle(glowBtn, "glow");
  bindToggle(trailBtn, "trail");
  bindToggle(permBtn, "trailPermanent");
  trailSecs.addEventListener("input", () => {
    state.fx.trailSeconds = +trailSecs.value;
    trailSecsValue.textContent = trailSecs.value + "s";
    sendFx();
  });

  // PNG 내보내기 — 현재 화면 스냅샷 (기념·기록)
  exportBtn.addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "live-drawing-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, "image/png");
  });

  // 출력이 늦게 떠서 상태를 요청하면 현재 연출 상태를 재발행
  sync.on((msg) => {
    if (msg && msg.t === "sync-req") sendFx();
  });

  // ─── 로컬 미리보기 렌더 루프 ───
  (function frame() {
    ink.drawPending();
    requestAnimationFrame(frame);
  })();
}
