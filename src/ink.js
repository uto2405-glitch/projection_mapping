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
  /** drawPending 밖(restoreOpaque·resize)에서 처음 렌더된 획 id — 다음 프레임 마크로 합류.
   *  미렌더 대기 포인트가 이 경로로 그려져도 레지스트리·렌더 마크가 누락되지 않는다 (감사 2차 #1). */
  const deferredFirst = [];

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

  /** 획 시작 — 같은 키가 이미 있으면(드로잉 기기 리로드 등) 옛 획을 봉인하고 대체.
   *  key는 내부 식별자(다중 사용자 시 발신자 네임스페이스), publicId는 레지스트리·
   *  렌더 마크에 쓰는 공개 id(채점 계약: s000…). 단일 사용자는 둘이 같다.
   *  supersede=true(리플레이 승격 — 같은 획의 완성본)면 옛 세대를 완전 만료시켜
   *  이후 재드로우(undo·잔상)에서 유령으로 부활하지 못하게 한다 (감사 4차 #1). */
  function begin(id, { color = "#ffffff", width = 6, erase = false } = {}, publicId = id, supersede = false) {
    const prev = strokes.get(id);
    if (prev) {
      prev.done = true;
      if (supersede && !prev.expired) {
        prev.expired = true;
        prev.points.length = 0;
        const pi = pub.indexOf(prev.pub);
        if (pi >= 0) pub.splice(pi, 1); // 같은 공개 id의 중복 레지스트리 방지
      }
    }
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
      tip: false, // 종료 팁(마지막 반조각) 렌더 여부
      pub: { id: publicId, pointsRendered: 0 },
    };
    strokes.set(id, s);
    order.push(s);
  }

  function addPoints(id, pts) {
    const s = strokes.get(id);
    if (!s || s.expired || !pts || !pts.length) return;
    const t = performance.now();
    for (const p of pts) {
      if (p && isFinite(p.x) && isFinite(p.y)) {
        // k = 필압 폭 계수 (개정 4호) — 미지원 입력은 1
        const k = isFinite(p.k) ? Math.min(1.7, Math.max(0.4, p.k)) : 1;
        s.points.push({ x: p.x, y: p.y, t, k });
      }
    }
    dirty = true;
    blackPresented = false;
  }

  function end(id) {
    const s = strokes.get(id);
    if (!s) return;
    s.done = true;
    if (!s.tip && s.points.length - s.head >= 2) dirty = true; // 팁 반조각 마감 렌더
  }

  function dot(p, s, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = styleFor(s);
    ctx.beginPath();
    ctx.arc(
      p.x * surface.width,
      p.y * surface.height,
      (lineWidthFor(s) * (p.k || 1)) / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ─── 스무딩 (ORDER-04, B3) — 입력 폴리라인을 중점 이차곡선으로 렌더 ───
  // 조각 규약: 시작 p[h]→m(h,h+1) 직선, 이후 m(k-2,k-1) —ctrl p[k-1]→ m(k-1,k) 곡선,
  // 획 종료 시 m(끝-1,끝)→p[끝] 팁 직선. pointsRendered 의미는 불변(입력 포인트당 1).

  /** 증분 렌더 — head(만료 경계) 이전과는 절대 잇지 않는다 */
  function drawStrokeIncrement(s) {
    const pts = s.points;
    const n = pts.length;
    const w = surface.width;
    const h = surface.height;
    const px = (a) => pts[a].x * w;
    const py = (a) => pts[a].y * h;
    const mx = (a, b) => (px(a) + px(b)) / 2;
    const my = (a, b) => (py(a) + py(b)) / 2;
    let i = Math.max(s.drawn, s.head);
    const wantTip = s.done && !s.tip && n - s.head >= 2 && i >= n;
    if (i >= n && !wantTip) {
      s.drawn = n;
      return;
    }
    if (i < n && i === s.head) {
      dot(pts[i], s); // 시작점(또는 만료 경계 재시작) — 이전과 잇지 않는다
      i += 1;
    }
    if (i < n || wantTip) {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = styleFor(s);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const base = lineWidthFor(s);
      // 필압 가변폭 — 조각별 평균 계수로 폭을 바꾼다 (같은 폭 조각은 한 패스로 병합)
      let curW = -1;
      let open = false;
      const setW = (w) => {
        const q = Math.max(0.5, Math.round(w * 4) / 4);
        if (q !== curW) {
          if (open) ctx.stroke();
          ctx.lineWidth = q;
          ctx.beginPath();
          open = false;
          curW = q;
        }
      };
      for (; i < n; i++) {
        const kk = ((pts[i - 1].k || 1) + (pts[i].k || 1)) / 2;
        setW(base * kk);
        if (i === s.head + 1) {
          ctx.moveTo(px(i - 1), py(i - 1));
          ctx.lineTo(mx(i - 1, i), my(i - 1, i));
        } else {
          if (!open) ctx.moveTo(mx(i - 2, i - 1), my(i - 2, i - 1));
          ctx.quadraticCurveTo(px(i - 1), py(i - 1), mx(i - 1, i), my(i - 1, i));
        }
        open = true;
      }
      if (s.done && !s.tip && n - s.head >= 2) {
        setW(base * (pts[n - 1].k || 1));
        if (!open) ctx.moveTo(mx(n - 2, n - 1), my(n - 2, n - 1));
        ctx.lineTo(px(n - 1), py(n - 1)); // 팁 — 마지막 반조각 마감
        open = true;
        s.tip = true;
      }
      if (open) ctx.stroke();
    }
    s.drawn = n;
  }

  /** 잔상 렌더 — 살아있는 구간을 알파 감쇠(10버킷)로, 조각별 스무딩 유지 */
  function drawStrokeFade(s, now, cutoffMs) {
    const pts = s.points;
    const n = pts.length;
    const w = surface.width;
    const h = surface.height;
    const i0 = s.head;
    if (n - i0 === 1) {
      const a = Math.max(0, 1 - (now - pts[i0].t) / cutoffMs);
      if (a > 0.01) dot(pts[i0], s, a);
      return;
    }
    const px = (a) => pts[a].x * w;
    const py = (a) => pts[a].y * h;
    const mx = (a, b) => (px(a) + px(b)) / 2;
    const my = (a, b) => (py(a) + py(b)) / 2;
    ctx.strokeStyle = styleFor(s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const base = lineWidthFor(s);
    // (알파×폭) 버킷별로 패스를 묶어 stroke() 호출 수를 제한 (조각은 독립 moveTo)
    const buckets = new Map(); // key `${알파버킷}|${폭}` → { a, w, idxs }
    for (let k = i0 + 1; k < n; k++) {
      const a = 1 - (now - pts[k].t) / cutoffMs;
      if (a <= 0.01) continue;
      const b = Math.min(10, Math.max(1, Math.ceil(a * 10)));
      const w = Math.max(0.5, Math.round(base * (((pts[k - 1].k || 1) + (pts[k].k || 1)) / 2) * 4) / 4);
      const bk = b + "|" + w;
      let entry = buckets.get(bk);
      if (!entry) buckets.set(bk, (entry = { a: b / 10, w, idxs: [] }));
      entry.idxs.push(k);
    }
    for (const { a, w, idxs } of buckets.values()) {
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const k of idxs) {
        if (k === i0 + 1) {
          ctx.moveTo(px(k - 1), py(k - 1));
          ctx.lineTo(mx(k - 1, k), my(k - 1, k));
        } else {
          ctx.moveTo(mx(k - 2, k - 1), my(k - 2, k - 1));
          ctx.quadraticCurveTo(px(k - 1), py(k - 1), mx(k - 1, k), my(k - 1, k));
        }
        if (k === n - 1 && s.done) ctx.lineTo(px(n - 1), py(n - 1)); // 팁
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
        first.push(s.pub.id); // 렌더 마크는 공개 id로 (채점 계약 s000…)
        pub.push(s.pub);
      }
      s.pub.pointsRendered += total - s.ever;
      s.ever = total;
    }
  }

  function drawFadeFrame() {
    dirty = false; // 대기 포인트 소비 — 이후는 감쇠 진행(fadeBusy)이 틱을 요청한다
    const first = deferredFirst.splice(0);
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
    const first = deferredFirst.splice(0);
    for (const s of order) {
      if (s.expired) continue;
      const hasPts = Math.max(s.drawn, s.head) < s.points.length;
      const needTip = s.done && !s.tip && s.points.length - s.head >= 2;
      if (hasPts || needTip) {
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
      s.tip = false; // 팁 포함 전체 재드로우
      drawStrokeIncrement(s);
      updateEver(s, deferredFirst); // 미렌더 대기분도 집계 — 레지스트리·마크 누락 방지
    }
  }

  /** 획 제거 (실행취소, ORDER-04) — 벡터 재드로우라 지우개 획 취소 시 하부가 복원된다 */
  function remove(id) {
    const s = strokes.get(id);
    if (!s || s.expired) return false;
    s.expired = true;
    s.points.length = 0;
    s.head = 0;
    s.drawn = 0;
    const pi = pub.indexOf(s.pub); // 레지스트리에서도 제거 — 실제 렌더 상태 반영(C4)
    if (pi >= 0) pub.splice(pi, 1);
    strokes.delete(id);
    if (!fadeMode()) restoreOpaque();
    blackPresented = false;
    dirty = true;
    return true;
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
        s.tip = false;
        drawStrokeIncrement(s);
        updateEver(s, deferredFirst); // 리사이즈 중 도착한 신규 포인트 집계
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
        points: s.points.slice(s.head).map((p) => ({ x: p.x, y: p.y, k: p.k })),
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
    remove,
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
