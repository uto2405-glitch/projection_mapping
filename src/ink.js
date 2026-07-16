// 잉크 표면 — 획 데이터와 2D 렌더링의 단일 소스.
// draw 페이지는 화면 캔버스에 직접, output 페이지는 오프스크린 캔버스에 그린 뒤
// 텍스처로 워프 메시에 얹는다 (콘텐츠 → 오프스크린 텍스처 → 워프 메시, CLAUDE.md 구조).
//
// 좌표는 0..1 정규화로 저장하고 그릴 때 표면 크기로 스케일한다.
// 획 폭은 1080p 기준 픽셀 값이며 surface 높이에 비례해 스케일된다.
// 점마다 수신 시각 t를 기록한다 — 사이클 #2 잔상(시간 감쇠)의 재료.

export function createInk({ canvas = null, width = 1920, height = 1080 } = {}) {
  const surface = canvas || document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const ctx = surface.getContext("2d");

  /** @type {Map<string, Stroke>} id → 획. Stroke: {id,color,width,erase,points,drawn,marked,pub} */
  const strokes = new Map();
  /** 그려진 순서 (재드로우용) */
  const order = [];
  /** 읽기 전용 레지스트리 뷰 — 첫 렌더 시 pub 레코드가 여기 쌓인다 (채점 계약 window.__ldp.strokes) */
  const pub = [];

  let dirty = false;

  paintBackground();

  function paintBackground() {
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, surface.width, surface.height);
  }

  function widthScale() {
    return surface.height / 1080;
  }

  /** 획 시작 — 메타 등록만, 실제 드로잉은 drawPending()에서 */
  function begin(id, { color = "#ffffff", width = 6, erase = false } = {}) {
    if (strokes.has(id)) return;
    const s = {
      id,
      color,
      width,
      erase,
      points: [], // {x, y, t}
      drawn: 0, // 렌더 완료된 포인트 수
      marked: false, // 첫 포인트 렌더 마크 발화 여부
      pub: { id, pointsRendered: 0 },
    };
    strokes.set(id, s);
    order.push(s);
  }

  /** 포인트 추가 (정규화 좌표 배열) */
  function addPoints(id, pts) {
    const s = strokes.get(id);
    if (!s || !pts || !pts.length) return;
    const t = performance.now();
    for (const p of pts) s.points.push({ x: p.x, y: p.y, t });
    dirty = true;
  }

  function end(id) {
    const s = strokes.get(id);
    if (s) s.done = true;
  }

  /** 획 하나의 미렌더 구간을 그린다. 반환: 이번에 그린 포인트 수 */
  function drawStrokeIncrement(s) {
    const w = surface.width;
    const h = surface.height;
    const k = widthScale();
    const lw = Math.max(0.5, s.width * k);
    // 지우개 = 불투명 검정 페인트 (배경과 동일) — 텍스처를 불투명하게 유지
    ctx.globalCompositeOperation = "source-over";
    const style = s.erase ? "#000000" : s.color;
    let n = 0;

    if (s.drawn === 0 && s.points.length > 0) {
      // 첫 포인트: 라운드 도트
      const p = s.points[0];
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, lw / 2, 0, Math.PI * 2);
      ctx.fill();
      s.drawn = 1;
      n++;
    }
    if (s.drawn < s.points.length) {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const prev = s.points[s.drawn - 1];
      ctx.moveTo(prev.x * w, prev.y * h);
      for (let i = s.drawn; i < s.points.length; i++) {
        const p = s.points[i];
        ctx.lineTo(p.x * w, p.y * h);
        n++;
      }
      ctx.stroke();
      s.drawn = s.points.length;
    }
    return n;
  }

  /**
   * 프레임마다 호출 — 대기 중인 포인트를 실제로 그린다.
   * 반환 {dirty, first}: dirty=이번 프레임에 픽셀 변화가 있었는지,
   * first=첫 포인트가 이번 프레임에 처음 렌더된 획 id 목록 (렌더 마크용).
   */
  function drawPending() {
    if (!dirty) return { dirty: false, first: [] };
    const first = [];
    for (const s of order) {
      if (s.drawn >= s.points.length) continue;
      const wasUnmarked = !s.marked && s.drawn === 0 && s.points.length > 0;
      const n = drawStrokeIncrement(s);
      if (n > 0) {
        if (wasUnmarked) {
          s.marked = true;
          first.push(s.id);
          pub.push(s.pub); // 실제로 렌더된 획만 레지스트리에 등장
        }
        s.pub.pointsRendered += n; // 실제 렌더 상태 반영 (C4)
      }
    }
    dirty = false;
    return { dirty: true, first };
  }

  /** 모두 지우기 — 획·레지스트리·픽셀 전체 소거 (Q9: 세션 교체용) */
  function clear() {
    strokes.clear();
    order.length = 0;
    pub.length = 0;
    paintBackground();
    dirty = true; // 출력 합성기가 검정 프레임을 다시 올리도록
  }

  /** 표면 크기 변경 (draw 페이지 리사이즈) — 전체 재드로우.
   *  복원이지 새 렌더가 아니므로 pointsRendered는 건드리지 않는다. */
  function resize(w, h) {
    surface.width = Math.max(1, Math.round(w));
    surface.height = Math.max(1, Math.round(h));
    paintBackground();
    for (const s of order) {
      s.drawn = 0;
      drawStrokeIncrement(s); // pub 미증가 — 화면 복원 전용
    }
    dirty = true; // 합성기가 새 픽셀을 올리도록
  }

  return {
    canvas: surface,
    pub,
    begin,
    addPoints,
    end,
    drawPending,
    clear,
    resize,
    /** 픽셀 변화 대기 여부 (합성기 스킵 판단용) */
    isDirty: () => dirty,
  };
}
