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
          <button type="button" class="tbtn" data-test="undo">↩ 실행취소</button>
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
          <button type="button" class="tbtn hidden" data-test="align-fine" aria-pressed="false">🎯 미세</button>
          <button type="button" class="tbtn hidden" data-test="align-reset">↺ 리셋</button>
        </div>
        <div class="tgroup" aria-label="내보내기">
          <button type="button" class="tbtn" data-test="export-png">📷 PNG 저장</button>
        </div>
        <span class="sync-badge" aria-live="polite"></span>
      </div>
      <div class="canvas-wrap">
        <div class="stage">
          <canvas data-test="draw-canvas"></canvas>
          <canvas class="predict-overlay" aria-hidden="true"></canvas>
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
  const predictCanvas = root.querySelector(".predict-overlay");
  const predictCtx = predictCanvas.getContext("2d");
  const wrap = root.querySelector(".canvas-wrap");
  const stage = root.querySelector(".stage");
  const overlay = root.querySelector(".align-overlay");
  const poly = root.querySelector(".align-poly");
  const sync = openSync();
  const ink = createInk({ canvas, width: 1920, height: 1080 });

  // ─── 상태 (ldp:pen에 영구화 — 리로드·재방문 시 이어서, ORDER-04) ───
  const PEN_KEY = "ldp:pen";
  const state = {
    color: "#ffffff",
    width: 6,
    erase: false,
    fx: { trail: false, glow: false, trailSeconds: 8, trailPermanent: false },
    alignMode: false,
    alignFine: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PEN_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (typeof saved.color === "string" && /^#[0-9a-f]{6}$/i.test(saved.color)) state.color = saved.color;
      if (isFinite(saved.width)) state.width = Math.min(40, Math.max(1, +saved.width));
      if (saved.fx && typeof saved.fx === "object") {
        state.fx.trail = !!saved.fx.trail;
        state.fx.glow = !!saved.fx.glow;
        state.fx.trailPermanent = !!saved.fx.trailPermanent;
        if (isFinite(saved.fx.trailSeconds))
          state.fx.trailSeconds = Math.min(30, Math.max(2, +saved.fx.trailSeconds));
      }
    }
  } catch {
    /* 손상 저장값 무시 */
  }
  const persist = () => {
    try {
      localStorage.setItem(
        PEN_KEY,
        JSON.stringify({ color: state.color, width: state.width, fx: state.fx })
      );
    } catch {
      /* 저장 불가 환경 — 무시 */
    }
  };
  let corners = IDENTITY_CORNERS.slice(); // 마지막으로 알려진 출력 코너 (정렬 UI용)
  const undoStack = []; // 이 기기에서 그린 획 id (per-client 실행취소)

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
    predictCanvas.width = Math.max(1, Math.round(stageW * dpr));
    predictCanvas.height = Math.max(1, Math.round(stageH * dpr));
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
  // 예측 꼬리 (B1 체감 지연 제거) — 브라우저의 포인터 예측점을 반투명으로 선행 표시.
  // 다음 프레임마다 지워지는 오버레이라 실제 잉크·내보내기(A7)에는 절대 섞이지 않는다.
  let predicted = [];
  let lastReal = null;

  function finishStroke() {
    if (!active) return;
    ink.end(active.id);
    sync.send({ t: "e", id: active.id });
    undoStack.push(active.id);
    if (undoStack.length > 100) undoStack.shift();
    active = null;
    predicted = [];
    lastReal = null;
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
    lastReal = p;
    sync.send({ t: "s", id, ...meta, p: [p] });
    syncDraw();
  });

  // 새 잉크 즉시 커밋 — rAF 대기(~8ms) 없이 그 자리에서 그린다 (잔상 재드로우 모드 제외)
  const syncDraw = () => {
    if (!(state.fx.trail && !state.fx.trailPermanent)) ink.drawPending();
  };

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
    lastReal = pts[pts.length - 1];
    sync.send({ t: "a", id: active.id, p: pts });
    syncDraw();
    predicted =
      typeof e.getPredictedEvents === "function" ? e.getPredictedEvents().map(norm) : [];
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
  const undoBtn = root.querySelector('[data-test="undo"]');
  const eraserBtn = root.querySelector('[data-test="tool-eraser"]');
  const clearBtn = root.querySelector('[data-test="clear-all"]');
  const glowBtn = root.querySelector('[data-test="toggle-glow"]');
  const trailBtn = root.querySelector('[data-test="toggle-trail"]');
  const trailSecs = root.querySelector('[data-test="trail-seconds"]');
  const trailSecsValue = root.querySelector(".trail-secs-value");
  const permBtn = root.querySelector('[data-test="trail-permanent"]');
  const alignBtn = root.querySelector('[data-test="align-mode"]');
  const alignFineBtn = root.querySelector('[data-test="align-fine"]');
  const alignResetBtn = root.querySelector('[data-test="align-reset"]');
  const exportBtn = root.querySelector('[data-test="export-png"]');
  const syncBadge = root.querySelector(".sync-badge");

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
      persist();
    });
  }
  colorInput.addEventListener("input", () => {
    state.color = colorInput.value;
    setEraser(false);
    root.querySelectorAll(".swatch").forEach((b) => b.classList.remove("active"));
    persist();
  });
  widthInput.addEventListener("input", () => {
    state.width = +widthInput.value;
    persist();
  });
  eraserBtn.addEventListener("click", () => setEraser(!state.erase));

  undoBtn.addEventListener("click", () => {
    const id = undoStack.pop();
    if (!id) return;
    ink.remove(id);
    sync.send({ t: "undo", id });
  });

  clearBtn.addEventListener("click", () => {
    ink.clear();
    undoStack.length = 0;
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
      persist();
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
    persist();
  });

  // 영구화된 상태를 UI에 반영 (리로드 복원)
  colorInput.value = state.color;
  widthInput.value = String(state.width);
  root.querySelectorAll(".swatch").forEach((b) =>
    b.classList.toggle("active", b.dataset.color?.toLowerCase() === state.color.toLowerCase())
  );
  glowBtn.setAttribute("aria-pressed", String(state.fx.glow));
  trailBtn.setAttribute("aria-pressed", String(state.fx.trail));
  permBtn.setAttribute("aria-pressed", String(state.fx.trailPermanent));
  trailSecs.value = String(state.fx.trailSeconds);
  trailSecsValue.textContent = state.fx.trailSeconds + "s";
  applyFxLocal();

  // ─── 동기화 상태 배지 — 현장 진단 (ORDER-04) ───
  const setBadge = (mode) => {
    syncBadge.textContent = mode === "ws" ? "📡 릴레이 연결됨" : sync.isLocal ? "🖥 책상 모드" : "⏳ 릴레이 연결 중…";
    syncBadge.dataset.state = mode === "ws" ? "ws" : sync.isLocal ? "local" : "wait";
  };
  setBadge("init");
  sync.onUp(() => setBadge("ws"));
  sync.onDown(() => setBadge("down"));

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
    alignFineBtn.classList.toggle("hidden", !state.alignMode);
    alignResetBtn.classList.toggle("hidden", !state.alignMode);
    if (state.alignMode) {
      sync.send({ t: "corners-req" }); // 현재 출력 코너를 받아 핸들 초기화
      renderAlignUi();
    }
  });

  alignFineBtn.addEventListener("click", () => {
    state.alignFine = !state.alignFine;
    alignFineBtn.setAttribute("aria-pressed", String(state.alignFine));
  });

  alignResetBtn.addEventListener("click", () => {
    corners = IDENTITY_CORNERS.slice();
    renderAlignUi();
    sendCorners();
  });

  // 상대 드래그 — 잡는 순간 점프 없음. 미세 모드는 이동량 ×0.25 (마지막 1cm용, B4)
  // 포인터 ID 대조 — 드래그 중 손바닥 개입이 기준점을 탈취하지 못하게 (감사 2차 #6)
  handles.forEach((el, k) => {
    let ref = null; // { pid, px, py, cx, cy }
    el.addEventListener("pointerdown", (e) => {
      if (ref) return; // 진행 중 드래그 보호 — 두 번째 포인터(팜) 무시
      if (e.pointerType === "touch" && performance.now() - lastPenAt < 1500) return;
      ref = { pid: e.pointerId, px: e.clientX, py: e.clientY, cx: corners[k * 2], cy: corners[k * 2 + 1] };
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 무해 */
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!ref || e.pointerId !== ref.pid) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const scale = state.alignFine ? 0.25 : 1;
      corners[k * 2] = Math.min(
        1,
        Math.max(0, ref.cx + ((e.clientX - ref.px) / Math.max(1, r.width)) * scale)
      );
      corners[k * 2 + 1] = Math.min(
        1,
        Math.max(0, ref.cy + ((e.clientY - ref.py) / Math.max(1, r.height)) * scale)
      );
      renderAlignUi();
      sendCorners();
    });
    const stop = (e) => {
      if (ref && e.pointerId === ref.pid) ref = null;
    };
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
  announce(); // 부팅 — hello + 복원된 연출 상태 + 획 리플레이 (먼저 떠 있는 출력과 정합, 감사 2차 #2)

  // ─── 예측 꼬리 렌더 — 매 프레임 지우고 다시 그리는 반투명 선행선 ───
  let overlayDirty = false;
  function renderPredict() {
    if (overlayDirty) {
      predictCtx.clearRect(0, 0, predictCanvas.width, predictCanvas.height);
      overlayDirty = false;
    }
    if (!active || !lastReal || !predicted.length || state.erase) return;
    const w = predictCanvas.width;
    const h = predictCanvas.height;
    predictCtx.globalAlpha = 0.45;
    predictCtx.strokeStyle = state.color;
    predictCtx.lineWidth = Math.max(0.5, state.width * (h / 1080));
    predictCtx.lineCap = "round";
    predictCtx.lineJoin = "round";
    predictCtx.beginPath();
    predictCtx.moveTo(lastReal.x * w, lastReal.y * h);
    for (const p of predicted) predictCtx.lineTo(p.x * w, p.y * h);
    predictCtx.stroke();
    predictCtx.globalAlpha = 1;
    overlayDirty = true;
  }

  // ─── 로컬 미리보기 렌더 루프 — 새 잉크 즉시, 잔상 감쇠 틱은 30Hz (출력과 동일 정책) ───
  let frameNo = 0;
  (function frame() {
    frameNo++;
    if (ink.hasNew() || (ink.fadeBusy() && frameNo % 2 === 0)) ink.drawPending();
    renderPredict();
    requestAnimationFrame(frame);
  })();
}
