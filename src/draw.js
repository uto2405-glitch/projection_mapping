// 드로잉 UI (?role=draw) — 아이패드 사파리가 1급 시민.
// UI 구조(ORDER-08): 상용툴 벤치마크 — Procreate(컨텍스트별 슬림 툴바·미니멀 크롬),
// MadMapper/HeavyM(출력·정렬 모드 분리), Figma(그룹 필). 탭 3개(그리기·미디어·정렬) +
// 상시 유틸(실행취소·모두 지우기·내보내기·배지). 채점 계약 셀렉터·의미는 전부 보존,
// 채점기가 클릭하는 컨트롤(글로우·잔상 토글)은 기본 탭에 상주한다.
// 입력: Pointer Events + 코얼레스드 + 필압(개정 4호) + 예측 꼬리, 팜 리젝션, 16:9 레터박스.

import { createInk } from "./ink.js";
import { openSync } from "./sync.js";
import { IDENTITY_CORNERS } from "./homography.js";
import { sampleGrid, identityGrid, gridFromCorners, resampleGrid, validGrid } from "./gridwarp.js";
import { encodeMedia, sendChunks } from "./mediasync.js";

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
      <header class="topbar">
        <span class="brand-dot" aria-hidden="true"></span>
        <nav class="tabs" role="tablist" aria-label="도구 탭">
          <button type="button" class="tab-btn active" data-tab="draw">🖊 그리기</button>
          <button type="button" class="tab-btn" data-tab="media">🎬 미디어</button>
          <button type="button" class="tab-btn" data-tab="align">◱ 정렬</button>
        </nav>
        <div class="util">
          <button type="button" class="ubtn" data-test="undo" title="실행취소">↩</button>
          <button type="button" class="ubtn danger" data-test="clear-all" title="모두 지우기">🗑</button>
          <button type="button" class="ubtn" data-test="export-png" title="PNG 저장">📷</button>
          <span class="sync-badge" aria-live="polite"></span>
        </div>
      </header>

      <div class="context-bar">
        <!-- 🖊 그리기 (기본 탭 — 채점기 클릭 대상 상주) -->
        <section class="tool-tab active" data-tab="draw">
          <div class="pill" aria-label="색">
            <div class="swatches">
              ${SWATCHES.map(
                (c) =>
                  `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="색 ${c}"></button>`
              ).join("")}
            </div>
            <input type="color" value="#ffffff" data-test="pen-color" aria-label="사용자 색" />
          </div>
          <div class="pill" aria-label="굵기">
            <span class="width-dot" aria-hidden="true"></span>
            <input type="range" min="1" max="40" value="6" data-test="pen-width" aria-label="펜 굵기" />
            <button type="button" class="tbtn" data-test="tool-eraser" aria-pressed="false">⌫ 지우개</button>
          </div>
          <div class="pill" aria-label="연출">
            <button type="button" class="tbtn" data-test="toggle-glow" aria-pressed="false">✨ 글로우</button>
            <button type="button" class="tbtn" data-test="toggle-trail" aria-pressed="false">💫 잔상</button>
            <label class="slider-label"><span>잔상</span>
              <input type="range" min="2" max="30" value="8" step="1" data-test="trail-seconds" aria-label="잔상 시간(초)" />
              <span class="trail-secs-value">8s</span>
            </label>
            <button type="button" class="tbtn" data-test="trail-permanent" aria-pressed="false">∞ 영구</button>
          </div>
        </section>

        <!-- 🎬 미디어 -->
        <section class="tool-tab" data-tab="media">
          <div class="pill" aria-label="미디어 파일">
            <button type="button" class="tbtn" data-test="media-load">📁 불러오기</button>
            <input type="file" class="media-file hidden" accept="image/*,video/*" />
            <button type="button" class="tbtn" data-test="media-toggle" aria-pressed="false">🎬 표시</button>
            <button type="button" class="tbtn" data-test="media-move" aria-pressed="false">🖐 위치</button>
          </div>
          <div class="pill" aria-label="미디어 변환">
            <label class="slider-label"><span>크기</span>
              <input type="range" min="10" max="150" value="60" data-test="media-scale" /></label>
            <label class="slider-label"><span>회전</span>
              <input type="range" min="-180" max="180" value="0" data-test="media-rot" /></label>
            <label class="slider-label"><span>불투명</span>
              <input type="range" min="10" max="100" value="90" data-test="media-opacity" /></label>
          </div>
          <div class="pill" aria-label="갤러리">
            <button type="button" class="tbtn" data-test="gallery-save" aria-pressed="false"
              title="완성 획을 릴레이에 영속 저장 (두 기기 모드)">🖼 갤러리 저장</button>
          </div>
        </section>

        <!-- ◱ 정렬 -->
        <section class="tool-tab" data-tab="align">
          <div class="pill" aria-label="정렬 모드">
            <button type="button" class="tbtn" data-test="align-mode" aria-pressed="false">◱ 정렬 시작</button>
            <label class="slider-label"><span>대상 출력</span>
              <select data-test="align-target" aria-label="정렬 대상 출력">
                <option value="">기본</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
              </select></label>
          </div>
          <div class="pill hidden grid-sizes" data-test="grid-size" aria-label="워프 형태">
            ${[0, 3, 4, 5]
              .map(
                (n) =>
                  `<button type="button" class="tbtn gbtn" data-grid="${n}" aria-pressed="${n === 0}">${n === 0 ? "평면" : `${n}×${n}`}</button>`
              )
              .join("")}
          </div>
          <div class="pill hidden align-extra" aria-label="정렬 보조">
            <button type="button" class="tbtn" data-test="align-fine" aria-pressed="false">🎯 미세</button>
            <button type="button" class="tbtn" data-test="align-reset">↺ 리셋</button>
          </div>
        </section>
      </div>

      <div class="canvas-wrap">
        <div class="stage">
          <canvas data-test="draw-canvas"></canvas>
          <canvas class="predict-overlay" aria-hidden="true"></canvas>
          <div class="align-overlay hidden">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon class="align-poly" points="" />
              <g class="align-grid-lines"></g>
            </svg>
            <div class="align-handles"></div>
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
    alignTarget: "", // 멀티 아웃풋 대상 (개정 4호 — ''=기본)
  };
  let colorRestored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(PEN_KEY) || "null");
    if (saved && typeof saved === "object") {
      if (typeof saved.color === "string" && /^#[0-9a-f]{6}$/i.test(saved.color)) {
        state.color = saved.color;
        colorRestored = true;
      }
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
  if (!colorRestored) {
    // 다중 사용자 자동 배색 (개정 4호) — 세션 id 해시로 파스텔 하나 배정 (저장된 취향 우선)
    let h = 0;
    for (const ch of sync.sid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    state.color = SWATCHES[1 + (h % (SWATCHES.length - 1))];
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
  // 다중 사용자 충돌은 출력이 발신자(sid) 네임스페이스로 흡수한다 (개정 4호).
  let seq = 0;
  const newId = () => "s" + String(seq++).padStart(3, "0");

  // ─── 탭 전환 — 컨텍스트 위생: 탭을 떠나면 해당 모드도 해제 ───
  const tabBtns = [...root.querySelectorAll(".tab-btn")];
  const toolTabs = [...root.querySelectorAll(".tool-tab")];
  function switchTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    toolTabs.forEach((s) => s.classList.toggle("active", s.dataset.tab === name));
    if (name !== "align" && state.alignMode) alignBtn.click(); // 정렬 모드 자동 종료
    if (name !== "media" && mediaMoveMode) mediaMoveBtn.click(); // 위치 모드 자동 종료
    requestAnimationFrame(sizeCanvas); // 컨텍스트 바 높이 변화 반영
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

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

  // ─── 포인터 입력 (팜 리젝션 + 필압) ───
  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
    };
  };
  // 필압 폭 계수 (개정 4호) — 펜슬 0..1 → 0.4×~1.7×, 미지원(마우스·합성 압력 0)은 1
  const kOf = (e) =>
    e.pressure > 0 && e.pointerType !== "mouse"
      ? Math.round(Math.min(1.7, Math.max(0.4, 0.35 + e.pressure * 1.35)) * 100) / 100
      : 1;
  const pointOf = (e) => ({ ...norm(e), k: kOf(e) });

  let active = null; // { id, pointerId, type }
  let lastPenAt = -1e9;
  // 예측 꼬리 (B1 체감 지연 제거) — 매 프레임 지워지는 오버레이 (잉크·A7 비혼입)
  let predicted = [];
  let lastReal = null;

  function finishStroke() {
    if (!active) return;
    const id = active.id;
    ink.end(id);
    sync.send({ t: "e", id });
    undoStack.push(id);
    if (undoStack.length > 100) undoStack.shift();
    active = null;
    predicted = [];
    lastReal = null;
    if (galleryOn && !sync.isLocal) {
      // 갤러리 영속화 요청 — persistedIds 등록은 릴레이의 persist-ack가 확정한다
      const s = ink.getStrokes().find((x) => x.id === id);
      if (s) sync.send({ t: "persist-stroke", stroke: s });
    }
  }

  let mediaDrag = null; // { pid, x0, y0, sx, sy } — 미디어 위치 모드 드래그
  canvas.addEventListener("pointerdown", (e) => {
    if (state.alignMode) return;
    if (mediaMoveMode) {
      if (mediaDrag) return;
      const p = norm(e);
      mediaDrag = { pid: e.pointerId, x0: p.x, y0: p.y, sx: mediaState.x, sy: mediaState.y };
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 무해 */
      }
      return;
    }
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
    const p = pointOf(e);
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
    if (mediaDrag && e.pointerId === mediaDrag.pid) {
      e.preventDefault();
      const p = norm(e);
      mediaState.x = Math.min(1.5, Math.max(-0.5, mediaDrag.sx + (p.x - mediaDrag.x0)));
      mediaState.y = Math.min(1.5, Math.max(-0.5, mediaDrag.sy + (p.y - mediaDrag.y0)));
      sendMediaState();
      return;
    }
    if (!active || e.pointerId !== active.pointerId) return;
    if (e.pointerType === "pen") lastPenAt = performance.now();
    e.preventDefault();
    // 애플펜슬 120Hz 밀도 보존 — 코얼레스드 이벤트 전개 (+ 이벤트별 필압)
    const evs =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? e.getCoalescedEvents()
        : [e];
    const pts = evs.map(pointOf);
    const prev = pts.length >= 2 ? pts[pts.length - 2] : lastReal;
    ink.addPoints(active.id, pts);
    lastReal = pts[pts.length - 1];
    sync.send({ t: "a", id: active.id, p: pts });
    syncDraw();
    const native = typeof e.getPredictedEvents === "function" ? e.getPredictedEvents() : [];
    if (native.length) {
      predicted = native.map(norm);
    } else if (prev) {
      // 사파리 폴백 — 브라우저 예측점이 없으면 최근 속도로 선형 외삽 (~1프레임 선행)
      const dx = lastReal.x - prev.x;
      const dy = lastReal.y - prev.y;
      const v = Math.hypot(dx, dy);
      predicted =
        v > 0.0005 && v < 0.05
          ? [0.6, 1.2].map((k) => ({
              x: Math.min(1, Math.max(0, lastReal.x + dx * k)),
              y: Math.min(1, Math.max(0, lastReal.y + dy * k)),
            }))
          : [];
    } else {
      predicted = [];
    }
  });

  const onUp = (e) => {
    if (mediaDrag && e.pointerId === mediaDrag.pid) {
      mediaDrag = null;
      return;
    }
    if (!active || e.pointerId !== active.pointerId) return;
    e.preventDefault();
    finishStroke();
  };
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ─── 컨트롤 참조 ───
  const colorInput = root.querySelector('[data-test="pen-color"]');
  const widthInput = root.querySelector('[data-test="pen-width"]');
  const widthDot = root.querySelector(".width-dot");
  const undoBtn = root.querySelector('[data-test="undo"]');
  const eraserBtn = root.querySelector('[data-test="tool-eraser"]');
  const clearBtn = root.querySelector('[data-test="clear-all"]');
  const glowBtn = root.querySelector('[data-test="toggle-glow"]');
  const trailBtn = root.querySelector('[data-test="toggle-trail"]');
  const trailSecs = root.querySelector('[data-test="trail-seconds"]');
  const trailSecsValue = root.querySelector(".trail-secs-value");
  const permBtn = root.querySelector('[data-test="trail-permanent"]');
  const alignBtn = root.querySelector('[data-test="align-mode"]');
  const alignTargetSel = root.querySelector('[data-test="align-target"]');
  const alignFineBtn = root.querySelector('[data-test="align-fine"]');
  const alignResetBtn = root.querySelector('[data-test="align-reset"]');
  const exportBtn = root.querySelector('[data-test="export-png"]');
  const syncBadge = root.querySelector(".sync-badge");

  // 굵기 미리보기 점 (상용 드로잉 툴 관례)
  const updateWidthDot = () => {
    const d = Math.max(3, Math.min(22, state.width * 0.55));
    widthDot.style.width = d + "px";
    widthDot.style.height = d + "px";
    widthDot.style.background = state.erase ? "#666" : state.color;
  };

  function setEraser(on) {
    state.erase = on;
    eraserBtn.setAttribute("aria-pressed", String(on));
    updateWidthDot();
  }

  const updateSwatchActive = () => {
    root
      .querySelectorAll(".swatch")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.color?.toLowerCase() === state.color.toLowerCase())
      );
  };
  for (const sw of root.querySelectorAll(".swatch")) {
    sw.addEventListener("click", () => {
      state.color = sw.dataset.color;
      colorInput.value = sw.dataset.color;
      setEraser(false);
      updateSwatchActive();
      persist();
    });
  }
  colorInput.addEventListener("input", () => {
    state.color = colorInput.value;
    setEraser(false);
    updateSwatchActive();
    persist();
  });
  widthInput.addEventListener("input", () => {
    state.width = +widthInput.value;
    updateWidthDot();
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

  // 영구화·자동 배색 상태를 UI에 반영
  colorInput.value = state.color;
  widthInput.value = String(state.width);
  updateSwatchActive();
  glowBtn.setAttribute("aria-pressed", String(state.fx.glow));
  trailBtn.setAttribute("aria-pressed", String(state.fx.trail));
  permBtn.setAttribute("aria-pressed", String(state.fx.trailPermanent));
  trailSecs.value = String(state.fx.trailSeconds);
  trailSecsValue.textContent = state.fx.trailSeconds + "s";
  updateWidthDot();
  applyFxLocal();

  // ─── 동기화 상태 배지 — 현장 진단 (ORDER-04) ───
  const setBadge = (mode) => {
    syncBadge.textContent =
      mode === "ws" ? "📡 릴레이" : sync.isLocal ? "🖥 책상" : "⏳ 연결 중";
    syncBadge.dataset.state = mode === "ws" ? "ws" : sync.isLocal ? "local" : "wait";
  };
  setBadge("init");
  sync.onUp(() => setBadge("ws"));
  sync.onDown(() => setBadge("down"));

  // ─── 정렬 모드 (Q7 원격 4코너 + 개정 2호 격자 + 개정 4호 멀티 아웃풋 타깃) ───
  const warp = { mode: "corners", nx: 3, ny: 3, points: null }; // 대상 출력과 미러
  const handlesBox = root.querySelector(".align-handles");
  const gridLines = root.querySelector(".align-grid-lines");
  let handleEls = [];

  const getPt = (i) =>
    warp.mode === "grid" ? warp.points[i] : { x: corners[i * 2], y: corners[i * 2 + 1] };
  const setPt = (i, x, y) => {
    if (warp.mode === "grid") {
      warp.points[i].x = x;
      warp.points[i].y = y;
    } else {
      corners[i * 2] = x;
      corners[i * 2 + 1] = y;
    }
  };

  function renderAlignUi() {
    if (warp.mode === "grid") {
      poly.setAttribute("points", "");
      // 격자선 — 제어점 사이를 24분할 샘플해 곡면 스플라인 그대로 표시
      const P = (u, v) => {
        const s = sampleGrid(warp.points, warp.nx, warp.ny, u, v);
        return `${s.x * 100},${s.y * 100}`;
      };
      const steps = 24;
      let svg = "";
      for (let r = 0; r < warp.ny; r++)
        svg += `<polyline points="${Array.from({ length: steps + 1 }, (_, i) => P(i / steps, r / (warp.ny - 1))).join(" ")}" />`;
      for (let c = 0; c < warp.nx; c++)
        svg += `<polyline points="${Array.from({ length: steps + 1 }, (_, i) => P(c / (warp.nx - 1), i / steps)).join(" ")}" />`;
      gridLines.innerHTML = svg;
      buildHandles(warp.nx * warp.ny, true);
    } else {
      gridLines.innerHTML = "";
      poly.setAttribute(
        "points",
        [0, 1, 2, 3].map((k) => `${corners[k * 2] * 100},${corners[k * 2 + 1] * 100}`).join(" ")
      );
      buildHandles(4, false);
    }
    handleEls.forEach((el, i) => {
      const p = getPt(i);
      el.style.left = p.x * 100 + "%";
      el.style.top = p.y * 100 + "%";
    });
  }

  let warpSendQueued = false;
  function sendWarp() {
    if (warpSendQueued) return;
    warpSendQueued = true;
    requestAnimationFrame(() => {
      warpSendQueued = false;
      const out = state.alignTarget;
      if (warp.mode === "grid")
        sync.send({ t: "warp", mode: "grid", nx: warp.nx, ny: warp.ny, points: warp.points, out });
      else sync.send({ t: "corners", v: corners.slice(), out }); // 기본 출력은 기존 A6 경로 그대로
    });
  }

  function buildHandles(n, small) {
    if (handleEls.length === n && (handleEls[0]?.classList.contains("small") ?? false) === small)
      return;
    handlesBox.innerHTML = Array.from(
      { length: n },
      (_, i) => `<div class="align-handle${small ? " small" : ""}" data-idx="${i}"><span>●</span></div>`
    ).join("");
    handleEls = [...handlesBox.querySelectorAll(".align-handle")];
    handleEls.forEach((el, i) => attachHandleDrag(el, i));
  }

  // 상대 드래그 + 포인터 ID 대조 + 미세 모드 ×0.25 (B4 마지막 1cm)
  function attachHandleDrag(el, i) {
    let ref = null; // { pid, px, py, cx, cy }
    el.addEventListener("pointerdown", (e) => {
      if (ref) return;
      if (e.pointerType === "touch" && performance.now() - lastPenAt < 1500) return;
      const p = getPt(i);
      ref = { pid: e.pointerId, px: e.clientX, py: e.clientY, cx: p.x, cy: p.y };
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
      setPt(
        i,
        Math.min(1, Math.max(0, ref.cx + ((e.clientX - ref.px) / Math.max(1, r.width)) * scale)),
        Math.min(1, Math.max(0, ref.cy + ((e.clientY - ref.py) / Math.max(1, r.height)) * scale))
      );
      renderAlignUi();
      sendWarp();
    });
    const stop = (e) => {
      if (ref && e.pointerId === ref.pid) ref = null;
    };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  }

  // 격자 밀도 전환 — 현재 워프를 샘플링해 연속 초기화
  const gridBtns = [...root.querySelectorAll(".gbtn")];
  function updateGridButtons() {
    gridBtns.forEach((b) => {
      const n = +b.dataset.grid;
      b.setAttribute("aria-pressed", String(warp.mode === "grid" ? n === warp.nx : n === 0));
    });
  }
  gridBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const n = +b.dataset.grid;
      const out = state.alignTarget;
      if (n === 0) {
        if (warp.mode === "grid") {
          warp.mode = "corners";
          sync.send({ t: "warp", mode: "corners", out });
        }
      } else {
        warp.points =
          warp.mode === "grid"
            ? resampleGrid(warp.points, warp.nx, warp.ny, n, n)
            : gridFromCorners(corners, n, n);
        warp.mode = "grid";
        warp.nx = n;
        warp.ny = n;
        sync.send({ t: "warp", mode: "grid", nx: n, ny: n, points: warp.points, out });
      }
      updateGridButtons();
      renderAlignUi();
    })
  );

  const requestWarpState = () => sync.send({ t: "warp-req", out: state.alignTarget });

  alignBtn.addEventListener("click", () => {
    state.alignMode = !state.alignMode;
    alignBtn.setAttribute("aria-pressed", String(state.alignMode));
    alignBtn.textContent = state.alignMode ? "◱ 정렬 종료" : "◱ 정렬 시작";
    overlay.classList.toggle("hidden", !state.alignMode);
    root.querySelector(".grid-sizes").classList.toggle("hidden", !state.alignMode);
    root.querySelector(".align-extra").classList.toggle("hidden", !state.alignMode);
    if (state.alignMode) {
      requestWarpState(); // 대상 출력의 워프 상태(모드·격자·코너)를 받아 초기화
      renderAlignUi();
      updateGridButtons();
    } else {
      // 진행 중 드래그(포인터 캡처)까지 정리 — 숨겨진 채 조작되는 일 방지
      handlesBox.innerHTML = "";
      handleEls = [];
    }
    requestAnimationFrame(sizeCanvas);
  });

  alignTargetSel.addEventListener("change", () => {
    state.alignTarget = alignTargetSel.value;
    if (state.alignMode) requestWarpState(); // 대상 전환 — 그 출력의 상태로 갱신
  });

  alignFineBtn.addEventListener("click", () => {
    state.alignFine = !state.alignFine;
    alignFineBtn.setAttribute("aria-pressed", String(state.alignFine));
  });

  alignResetBtn.addEventListener("click", () => {
    const out = state.alignTarget;
    if (warp.mode === "grid") {
      warp.points = identityGrid(warp.nx, warp.ny);
      sync.send({ t: "warp", mode: "grid", nx: warp.nx, ny: warp.ny, points: warp.points, out });
    } else {
      corners = IDENTITY_CORNERS.slice();
      sendWarp();
    }
    renderAlignUi();
  });

  // ─── 갤러리 영속화 (ORDER-06/#7) — 완성 획을 릴레이에 저장 ───
  const galleryBtn = root.querySelector('[data-test="gallery-save"]');
  let galleryOn = false;
  // 릴레이가 persist-ack로 저장을 확인한 획만 등록 — 미확인 획은 announce 리플레이가 계속 책임진다
  const persistedIds = new Set();
  if (sync.isLocal) {
    // 책상(BC 전용) 모드 — 저장 주체(릴레이)가 없다 (ORDER-06 B)
    galleryBtn.disabled = true;
    galleryBtn.title = "갤러리 저장은 두 기기(릴레이) 모드에서 사용할 수 있습니다";
  }
  galleryBtn.addEventListener("click", () => {
    galleryOn = !galleryOn;
    galleryBtn.setAttribute("aria-pressed", String(galleryOn));
  });

  // ─── 미디어 레이어 (ORDER-06/#4) ───
  const mediaState = { on: false, opacity: 0.9, x: 0.5, y: 0.5, scale: 0.6, rot: 0 };
  let mediaChunks = null; // 인코딩 캐시 — 출력 재부팅 시 재전송
  let mediaSendCancel = null; // 진행 중 전송 취소 (announce 중첩·파일 교체 시)
  let mediaMoveMode = false;
  const mediaFile = root.querySelector(".media-file");
  const mediaLoadBtn = root.querySelector('[data-test="media-load"]');
  const mediaToggleBtn = root.querySelector('[data-test="media-toggle"]');
  const mediaMoveBtn = root.querySelector('[data-test="media-move"]');

  let mediaSendQueued = false;
  function sendMediaState() {
    if (mediaSendQueued) return;
    mediaSendQueued = true;
    requestAnimationFrame(() => {
      mediaSendQueued = false;
      sync.send({ t: "media-state", s: { ...mediaState } });
    });
  }

  mediaLoadBtn.addEventListener("click", () => mediaFile.click());
  mediaFile.addEventListener("change", async () => {
    const f = mediaFile.files && mediaFile.files[0];
    mediaFile.value = "";
    if (!f) return;
    try {
      mediaLoadBtn.textContent = "⏳ 전송 중…";
      const { chunks } = await encodeMedia(f);
      mediaChunks = chunks;
      if (mediaSendCancel) mediaSendCancel();
      mediaSendCancel = sendChunks(sync, chunks, () => {
        mediaLoadBtn.textContent = "📁 불러오기";
        mediaState.on = true;
        mediaToggleBtn.setAttribute("aria-pressed", "true");
        sendMediaState();
      });
    } catch (err) {
      mediaLoadBtn.textContent = "📁 불러오기";
      alert("미디어 로드 실패: " + err.message);
    }
  });
  mediaToggleBtn.addEventListener("click", () => {
    mediaState.on = !mediaState.on;
    mediaToggleBtn.setAttribute("aria-pressed", String(mediaState.on));
    sendMediaState();
  });
  mediaMoveBtn.addEventListener("click", () => {
    mediaMoveMode = !mediaMoveMode;
    mediaMoveBtn.setAttribute("aria-pressed", String(mediaMoveMode));
  });
  const bindMediaSlider = (sel, key, div) =>
    root.querySelector(`[data-test="${sel}"]`).addEventListener("input", (e) => {
      mediaState[key] = +e.target.value / div;
      sendMediaState();
    });
  bindMediaSlider("media-scale", "scale", 100);
  bindMediaSlider("media-rot", "rot", 180 / Math.PI);
  bindMediaSlider("media-opacity", "opacity", 100);

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
    // 영속화된 획은 릴레이가 리플레이한다 — 여기서 재발행하면 이중 등록
    const strokes = ink.getStrokes().filter((s) => !persistedIds.has(s.id));
    if (strokes.length) sync.send({ t: "replay", strokes });
    if (mediaChunks) {
      // 출력 (재)부팅 복구 — 이전 전송을 취소하고 단일 스트림만 유지 (중첩 방지)
      if (mediaSendCancel) mediaSendCancel();
      mediaSendCancel = sendChunks(sync, mediaChunks, () => sendMediaState());
    }
  };
  sync.on((msg) => {
    if (!msg) return;
    if (msg.t === "sync-req") announce(); // 출력(재)부팅 — 연출 상태 + 획 리플레이 복구
    else if (msg.t === "clear") {
      // 다중 사용자 정합 (감사 4차 #2) — 다른 클라이언트의 세션 교체를 로컬에도 반영.
      // 미반영 시 이쪽 announce 리플레이가 지운 작품을 출력에 부활시킨다.
      ink.clear();
      undoStack.length = 0;
      persistedIds.clear();
    } else if (msg.t === "fx") {
      // fx 전역 미러 (감사 4차 #3) — 마지막 조작자의 상태로 전 클라이언트 수렴.
      // 미러 없이는 각자의 announce가 스테일 fx를 재강제해 출력이 핑퐁한다.
      if (msg.fx && typeof msg.fx === "object") {
        state.fx.trail = !!msg.fx.trail;
        state.fx.glow = !!msg.fx.glow;
        state.fx.trailPermanent = !!msg.fx.trailPermanent;
        const ts = Number(msg.fx.trailSeconds);
        if (isFinite(ts)) state.fx.trailSeconds = Math.min(30, Math.max(2, ts));
        glowBtn.setAttribute("aria-pressed", String(state.fx.glow));
        trailBtn.setAttribute("aria-pressed", String(state.fx.trail));
        permBtn.setAttribute("aria-pressed", String(state.fx.trailPermanent));
        trailSecs.value = String(state.fx.trailSeconds);
        trailSecsValue.textContent = state.fx.trailSeconds + "s";
        applyFxLocal();
        persist();
      }
    } else if (msg.t === "persist-ack") {
      if (typeof msg.id === "string") persistedIds.add(msg.id); // 릴레이 저장 확정
    } else if (msg.t === "corners") {
      if ((msg.out || "") !== state.alignTarget) return; // 다른 출력의 상태 — 무시
      if (Array.isArray(msg.v) && msg.v.length === 8 && msg.v.every((n) => typeof n === "number")) {
        corners = msg.v.slice();
        if (state.alignMode && warp.mode === "corners") renderAlignUi();
      }
    } else if (msg.t === "warp-state") {
      if ((msg.out || "") !== state.alignTarget) return;
      // 대상 출력의 현재 워프 상태로 정렬 UI 초기화
      if (Array.isArray(msg.corners) && msg.corners.length === 8) corners = msg.corners.slice();
      if (msg.mode === "grid" && validGrid("grid", msg.nx, msg.ny, msg.points)) {
        warp.mode = "grid";
        warp.nx = msg.nx;
        warp.ny = msg.ny;
        warp.points = msg.points.map((p) => ({ x: p.x, y: p.y }));
      } else {
        warp.mode = "corners";
      }
      if (state.alignMode) {
        renderAlignUi();
        updateGridButtons();
      }
    }
  });
  sync.onUp(announce); // ws 재연결 — 두 기기 모드 복구
  announce(); // 부팅 — hello + 복원된 연출 상태 + 획 리플레이 (먼저 떠 있는 출력과 정합)

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
    predictCtx.lineWidth = Math.max(0.5, state.width * (lastReal.k || 1) * (h / 1080));
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
