// 잉크 표면 — 획 데이터와 2D 렌더링의 단일 소스.
// draw 페이지는 화면 캔버스에 직접, output 페이지는 오프스크린 캔버스에 그린 뒤
// 텍스처로 워프 메시에 얹는다 (콘텐츠 → 오프스크린 텍스처 → 워프 메시, CLAUDE.md 구조).
//
// 좌표는 0..1 정규화로 저장하고 그릴 때 표면 크기로 스케일한다.
// 획 폭은 1080p 기준 픽셀 값이며 surface 높이에 비례해 스케일된다.
// 점마다 수신 시각 t를 기록한다 — 잔상(사이클 #2)의 시간 감쇠 재료.
//
// 잔상 모드(trail ON, 영구 제외): 프레임마다 만료 포인트를 전진시키고 살아있는
// 구간만 알파 감쇠로 재드로우한다. pointsRendered는 "한 번이라도 실제 렌더된
// 포인트"의 누적치로, 잔상 소거로 소급 차감되지 않는다 (ORDER-02 금지 조항).

export function createInk({ canvas = null, width = 1920, height = 1080 } = {}) {
  const surface = canvas || document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  // 불투명 캔버스 — 배경이 항상 검정이므로 알파 불필요. 텍스처 업로드 고속 경로.
  const ctx = surface.getContext("2d", { alpha: false });

  /** @type {Map<string, object>} id → 최신 세대 획 */
  const strokes = new Map();
  /** 도착 순서 (세대 교체된 옛 획 포함 — 재드로우·잔상 순서 보존) */
  const order = [];
  /** 읽기 전용 레지스트리 뷰 — 첫 렌더 시 pub 레코드가 쌓인다 (window.__ldp.strokes) */
  const pub = [];

  let dirty = false;
  const fade = { on: false, seconds: 8, permanent: false };
  let blackPresented = false; // 전량 만료 후 검정 프레임을 1회 제시했는지

  paintBackground();

  function paintBackground() {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, surface.width, surface.height);
  }

  const styleFor = (s) => (s.erase ? "#000000" : s.color);
  const lineWidthFor = (s) => Math.max(0.5, s.width * (surface.height / 1080));
  const fadeMode = () => fade.on && !fade.permanent;

  /** 획 시작 — 같은 ID가 이미 있으면(드로잉 기기 리로드 등) 옛 획을 봉인하고 대체.
   *  옛 획에 이어붙여 가짜 연결선·메타 오염이 생기는 것을 막는다 (감사 발견 #1). */
  function begin(id, { color = "#ffffff", width = 6, erase = false } = {}) {
    const prev = strokes.get(id);
    if (prev) prev.done = true;
    const s = {
      id,
      color,
      width,
      erase,
      points: [], // {x, y, t}
      drawn: 0, // 증분 렌더 완료 인덱스
      head: 0, // 잔상 만료 경계 (이전은 소거된 구간)
      ever: 0, // 한 번이라도 렌더된 포인트 누적 수
      marked: false,
      expired: false,
      done: false,
      pub: { id, pointsRendered: 0 },
    };
    strokes.set(id, s);
    order.push(s);
  }

  function addPoints(id, pts) {
    const s = strokes.get(id);
    if (!s || s.expired || !pts || !pts.length) return;
    const t = performance.now();
    for (const p of pts) {
      if (p && isFinite(p.x) && isFinite(p.y)) s.points.push({ x: p.x, y: p.y, t });
    }
    dirty = true;
    blackPresented = false;
  }

  function end(id) {
    const s = strokes.get(id);
    if (s) s.done = true;
  }

  function dot(p, s, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = styleFor(s);
    ctx.beginPath();
    ctx.arc(p.x * surface.width, p.y * surface.height, lineWidthFor(s) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 증분 렌더 — head(만료 경계) 이전과는 절대 잇지 않는다 */
  function drawStrokeIncrement(s) {
    const pts = s.points;
    const w = surface.width;
    const h = surface.height;
    let i = Math.max(s.drawn, s.head);
    if (i >= pts.length) {
      s.drawn = pts.length;
      return;
    }
    if (i === 0) {
      dot(pts[0], s);
      i = 1;
    } else if (i === s.head) {
      dot(pts[i], s); // 만료 경계에서 재시작 — 소거된 점과 잇지 않는다
      i += 1;
    }
    if (i < pts.length) {
      ctx.strokeStyle = styleFor(s);
      ctx.lineWidth = lineWidthFor(s);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x * w, pts[i - 1].y * h);
      for (; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
      ctx.stroke();
    }
    s.drawn = pts.length;
  }

  /** 잔상 렌더 — 살아있는 구간을 알파 감쇠(10버킷)로 그린다 */
  function drawStrokeFade(s, now, cutoffMs) {
    const pts = s.points;
    const w = surface.width;
    const h = surface.height;
    const i0 = s.head;
    if (pts.length - i0 === 1) {
      const a = Math.max(0, 1 - (now - pts[i0].t) / cutoffMs);
      if (a > 0.01) dot(pts[i0], s, a);
      return;
    }
    ctx.strokeStyle = styleFor(s);
    ctx.lineWidth = lineWidthFor(s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 알파 버킷별로 패스를 묶어 stroke() 호출 수를 제한
    const buckets = new Map();
    for (let k = i0 + 1; k < pts.length; k++) {
      const a = 1 - (now - pts[k].t) / cutoffMs;
      if (a <= 0.01) continue;
      const b = Math.min(10, Math.max(1, Math.ceil(a * 10)));
      let arr = buckets.get(b);
      if (!arr) buckets.set(b, (arr = []));
      arr.push(k);
    }
    for (const [b, idxs] of buckets) {
      ctx.globalAlpha = b / 10;
      ctx.beginPath();
      for (const k of idxs) {
        ctx.moveTo(pts[k - 1].x * w, pts[k - 1].y * h);
        ctx.lineTo(pts[k].x * w, pts[k].y * h);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** 실렌더 집계 — 첫 렌더 마크·레지스트리 등록·pointsRendered 누적 (C4) */
  function updateEver(s, first) {
    const total = s.points.length;
    if (total > s.ever) {
      if (s.ever === 0 && !s.marked) {
        s.marked = true;
        first.push(s.id);
        pub.push(s.pub);
      }
      s.pub.pointsRendered += total - s.ever;
      s.ever = total;
    }
  }

  function drawFadeFrame() {
    dirty = false; // 대기 포인트 소비 — 이후는 감쇠 진행(fadeBusy)이 틱을 요청한다
    const first = [];
    const now = performance.now();
    const cutoffMs = fade.seconds * 1000;
    let anyLive = false;
    paintBackground();
    for (const s of order) {
      if (s.expired) continue;
      const pts = s.points;
      while (s.head < pts.length && now - pts[s.head].t > cutoffMs) s.head++;
      updateEver(s, first);
      if (s.head >= pts.length) {
        if (s.done) {
          // 전량 만료 — 메모리 반납 (pub 레코드는 유지: 실렌더 이력)
          s.expired = true;
          pts.length = 0;
          s.head = 0;
          s.drawn = 0;
        }
        continue;
      }
      anyLive = true;
      drawStrokeFade(s, now, cutoffMs);
    }
    if (!anyLive) {
      if (blackPresented) return { dirty: false, first };
      blackPresented = true;
      return { dirty: true, first };
    }
    blackPresented = false;
    return { dirty: true, first };
  }

  /**
   * 프레임마다 호출. 반환 {dirty, first}:
   * dirty=이번 프레임 픽셀 변화 여부, first=첫 포인트가 처음 렌더된 획 id들(렌더 마크용).
   */
  function drawPending() {
    if (fadeMode()) return drawFadeFrame();
    if (!dirty) return { dirty: false, first: [] };
    const first = [];
    for (const s of order) {
      if (s.expired) continue;
      if (Math.max(s.drawn, s.head) < s.points.length) {
        drawStrokeIncrement(s);
        updateEver(s, first);
      }
    }
    dirty = false;
    return { dirty: true, first };
  }

  /** 연출 상태 반영 — 잔상 모드 전환 처리 */
  function setFade(fx) {
    const was = fadeMode();
    fade.on = !!fx.trail;
    const secs = Number(fx.trailSeconds);
    fade.seconds = Math.min(30, Math.max(2, isFinite(secs) ? secs : 8));
    fade.permanent = !!fx.trailPermanent;
    const is = fadeMode();
    if (was && !is) restoreOpaque(); // 잔상 종료 — 생존 구간을 불투명 복원
    if (!was && is) blackPresented = false;
    dirty = true;
  }

  function restoreOpaque() {
    paintBackground();
    for (const s of order) {
      if (s.expired) continue;
      s.drawn = s.head;
      drawStrokeIncrement(s);
    }
  }

  /** 모두 지우기 — 획·레지스트리·픽셀 전체 소거 (Q9: 세션 교체, 영구 잔상 포함) */
  function clear() {
    strokes.clear();
    order.length = 0;
    pub.length = 0;
    paintBackground();
    blackPresented = false;
    dirty = true;
  }

  /** 표면 크기 변경 (draw 페이지) — 복원이지 새 렌더가 아니므로 pub은 불변 */
  function resize(w, h) {
    surface.width = Math.max(1, Math.round(w));
    surface.height = Math.max(1, Math.round(h));
    paintBackground();
    if (!fadeMode()) {
      for (const s of order) {
        if (s.expired) continue;
        s.drawn = s.head;
        drawStrokeIncrement(s);
      }
    }
    dirty = true;
  }

  /** 리플레이용 스냅샷 (출력 재부팅 복구 — 감사 발견 #4) */
  function getStrokes() {
    return order
      .filter((s) => !s.expired && s.points.length > s.head)
      .map((s) => ({
        id: s.id,
        color: s.color,
        width: s.width,
        erase: s.erase,
        done: !!s.done,
        points: s.points.slice(s.head).map((p) => ({ x: p.x, y: p.y })),
      }));
  }

  const pointCount = (id) => {
    const s = strokes.get(id);
    return s && !s.expired ? s.points.length : 0;
  };

  return {
    canvas: surface,
    pub,
    begin,
    addPoints,
    end,
    drawPending,
    setFade,
    clear,
    resize,
    getStrokes,
    pointCount,
    /** 새 포인트·상태 변화 대기 여부 — 즉시 렌더가 필요한 프레임 */
    hasNew: () => dirty,
    /** 잔상 진행 중 여부 — 감쇠 애니메이션 틱이 필요한 상태 */
    fadeBusy: () => fadeMode() && !blackPresented,
  };
}
