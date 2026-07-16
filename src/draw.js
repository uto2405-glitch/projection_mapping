// 드로잉 UI (?role=draw) — 아이패드 사파리가 1급 시민.
// Pointer Events + getCoalescedEvents, touch-action 차단, 로컬 미리보기 즉시 렌더.
// 팜 리젝션: 펜 사용 중 터치 무시 + 포인터 ID 대조 (감사 발견 — B1 손맛 방어).
// 캔버스는 출력과 같은 16:9로 레터박스 — 정규화 좌표 왜곡 방지 (B3 방어).
// 정렬 모드(사이클 #3, Q7): 코너 핸들 4개를 원격 드래그 — 동기화 계층으로 출력에 전달.

import { createInk } from "./ink.js";
import { openSync } from "./sync.js";
import { IDENTITY_CORNERS } from "./homography.js";

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
        <div class="tgroup" aria-label="정렬">
          <button type="button" class="tbtn" data-test="align-mode" aria-pressed="false">◱ 정렬</button>
          <button type="button" class="tbtn hidden" data-test="align-reset">↺ 리셋</button>
        </div>
        <div class="tgroup" aria-label="내보내기">
          <button type="button" class="tbtn" data-test="export-png">📷 PNG 저장</button>
        </div>
      </div>
      <div class="canvas-wrap">
        <div class="stage">
          <canvas data-test="draw-canvas"></canvas>
          <div class="align-overlay hidden">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon class="align-poly" points="" />
            </svg>
            ${[0, 1, 2, 3]
              .map(
                (k) =>
                  `<div class="align-handle" data-corner="${k}"><span>${["↖", "↗", "↘", "↙"][k]}</span></div>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('[data-test="draw-canvas"]');
  const wrap = root.querySelector(".canvas-wrap");
  const stage = root.querySelector(".stage");
  const overlay = root.querySelector(".align-overlay");
  const poly = root.querySelector(".align-poly");
  const sync = openSync();
  const ink = createInk({ canvas, width: 1920, height: 1080 });

  // ─── 상태 ───
  const state = {
    color: "#ffffff",
    width: 6,
    erase: false,
    fx: { trail: false, glow: false, trailSeconds: 8, trailPermanent: false },
    alignMode: false,
  };
  let corners = IDENTITY_CORNERS.slice(); // 마지막으로 알려진 출력 코너 (정렬 UI용)

  // 획 ID — 채점기가 시나리오 id(s000…)와 레지스트리를 교차대조하므로 이 형식을 유지한다.
  // 리로드 시 재발급 충돌은 출력 ink.begin의 대체 방어가 흡수한다.
  let seq = 0;
  const newId = () => "s" + String(seq++).padStart(3, "0");

  // ─── 캔버스 크기: wrap 안에 최대 16:9 레터박스 (출력과 종횡비 일치) ───
  function sizeCanvas() {
    const r = wrap.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const stageW = Math.min(r.width, (r.height * 16) / 9);
    const stageH = (stageW * 9) / 16;
    stage.style.width = stageW + "px";
    stage.style.height = stageH + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ink.resize(stageW * dpr, stageH * dpr);
  }
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);
  // iOS 회전 직후 레이아웃 확정 지연 대응
  window.addEventListener("orientationchange", () => setTimeout(sizeCanvas, 350));

  // ─── 화면 꺼짐 방지 (공연 중 자동잠금 → 사파리 서스펜드 방어) ───
  const keepAwake = async () => {
    try {
      await navigator.wakeLock?.request("screen");
    } catch {
      /* 미지원·거부 — 운영 가이드(WORKFLOW)로 보완 */
    }
  };
  keepAwake();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") keepAwake();
  });

  // ─── 포인터 입력 (팜 리젝션 포함) ───
  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };

  let active = null; // { id, pointerId, type }
  let lastPenAt = -1e9;

  function finishStroke() {
    if (!active) return;
    ink.end(active.id);
    sync.send({ t: "e", id: active.id });
    active = null;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (state.alignMode) return;
    if (e.pointerType === "pen") lastPenAt = performance.now();
    if (active) {
      // 진행 중 획 보호: 펜은 터치(팜) 획을 탈취, 그 외 포인터는 무시
      if (e.pointerType === "pen" && active.type === "touch") finishStroke();
      else return;
    }
    // 펜을 쓰던 손의 손바닥 터치 무시
    if (e.pointerType === "touch" && performance.now() - lastPenAt < 1500) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 합성 이벤트(채점기)는 활성 포인터가 없어 캡처 불가 — 무해 */
    }
    const id = newId();
    active = { id, pointerId: e.pointerId, type: e.pointerType };
    const meta = { color: state.color, width: state.width, erase: state.erase };
    const p = norm(e);
    ink.begin(id, meta);
    ink.addPoints(id, [p]);
    sync.send({ t: "s", id, ...meta, p: [p] });
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    if (e.pointerType === "pen") lastPenAt = performance.now();
    e.preventDefault();
    // 애플펜슬 120Hz 밀도 보존 — 코얼레스드 이벤트 전개
    const evs =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];
    const pts = evs.map(norm);
    ink.addPoints(active.id, pts);
    sync.send({ t: "a", id: active.id, p: pts });
  });

  const onUp = (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    e.preventDefault();
    finishStroke();
  };
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
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
  const alignBtn = root.querySelector('[data-test="align-mode"]');
  const alignResetBtn = root.querySelector('[data-test="align-reset"]');
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
  const applyFxLocal = () => ink.setFade(state.fx); // 미리보기도 출력과 동일한 잔상 동작
  const bindToggle = (btn, key) => {
    btn.addEventListener("click", () => {
      state.fx[key] = !state.fx[key];
      btn.setAttribute("aria-pressed", String(state.fx[key]));
      applyFxLocal();
      sendFx();
    });
  };
  bindToggle(glowBtn, "glow");
  bindToggle(trailBtn, "trail");
  bindToggle(permBtn, "trailPermanent");
  trailSecs.addEventListener("input", () => {
    state.fx.trailSeconds = +trailSecs.value;
    trailSecsValue.textContent = trailSecs.value + "s";
    applyFxLocal();
    sendFx();
  });

  // ─── 정렬 모드 (Q7 — 아이패드 원격 4코너) ───
  const handles = [...root.querySelectorAll(".align-handle")];

  function renderAlignUi() {
    poly.setAttribute(
      "points",
      [0, 1, 2, 3].map((k) => `${corners[k * 2] * 100},${corners[k * 2 + 1] * 100}`).join(" ")
    );
    handles.forEach((el, k) => {
      el.style.left = corners[k * 2] * 100 + "%";
      el.style.top = corners[k * 2 + 1] * 100 + "%";
    });
  }

  let cornerSendQueued = false;
  function sendCorners() {
    if (cornerSendQueued) return;
    cornerSendQueued = true;
    requestAnimationFrame(() => {
      cornerSendQueued = false;
      sync.send({ t: "corners", v: corners.slice() });
    });
  }

  alignBtn.addEventListener("click", () => {
    state.alignMode = !state.alignMode;
    alignBtn.setAttribute("aria-pressed", String(state.alignMode));
    overlay.classList.toggle("hidden", !state.alignMode);
    alignResetBtn.classList.toggle("hidden", !state.alignMode);
    if (state.alignMode) {
      sync.send({ t: "corners-req" }); // 현재 출력 코너를 받아 핸들 초기화
      renderAlignUi();
    }
  });

  alignResetBtn.addEventListener("click", () => {
    corners = IDENTITY_CORNERS.slice();
    renderAlignUi();
    sendCorners();
  });

  handles.forEach((el, k) => {
    let dragging = false;
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 무해 */
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      corners[k * 2] = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
      corners[k * 2 + 1] = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
      renderAlignUi();
      sendCorners();
    });
    const stop = () => (dragging = false);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  });

  // ─── PNG 내보내기 — 현재 화면 스냅샷 (기념·기록) ───
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

  // ─── 버스 구독 ───
  const announce = () => {
    sync.send({ t: "hello", role: "draw" });
    sendFx();
    const strokes = ink.getStrokes();
    if (strokes.length) sync.send({ t: "replay", strokes });
  };
  sync.on((msg) => {
    if (!msg) return;
    if (msg.t === "sync-req") announce(); // 출력(재)부팅 — 연출 상태 + 획 리플레이 복구
    else if (msg.t === "corners") {
      if (Array.isArray(msg.v) && msg.v.length === 8 && msg.v.every((n) => typeof n === "number")) {
        corners = msg.v.slice();
        if (state.alignMode) renderAlignUi();
      }
    }
  });
  sync.onUp(announce); // ws 재연결 — 두 기기 모드 복구
  sync.send({ t: "hello", role: "draw" });

  // ─── 로컬 미리보기 렌더 루프 — 새 잉크 즉시, 잔상 감쇠 틱은 30Hz (출력과 동일 정책) ───
  let frameNo = 0;
  (function frame() {
    frameNo++;
    if (ink.hasNew() || (ink.fadeBusy() && frameNo % 2 === 0)) ink.drawPending();
    requestAnimationFrame(frame);
  })();
}
