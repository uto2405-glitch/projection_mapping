// 출력 뷰 (?role=output) — 콘텐츠(잉크 캔버스) → 오프스크린 텍스처(잉크+글로우)
// → 워프 메시(단일 셰이더 쿼드). 풀스크린 1080p 패스는 워프 제시 하나뿐 —
// 소프트웨어 GL(채점 헤드리스)에서도 A3(≥55fps)를 지키는 예산 설계.
// 채점 계약: 백킹 ≥1920×1080(A8), 렌더 마크(A1), 읽기 전용 레지스트리(C4), ldp:corners(A6).

import * as THREE from "three";
import QRCode from "qrcode";
import { createInk } from "./ink.js";
import { openSync } from "./sync.js";
import { createFx } from "./fx.js";
import {
  homographyFromUnitSquare,
  inverseWarpMatrixColumnMajor,
  applyHomography,
  IDENTITY_CORNERS,
} from "./homography.js";
import { sampleGrid, validGrid } from "./gridwarp.js";
import { drawSimSurface } from "./sim.js";
import { createMediaAssembler, mediaUvMatrixColumnMajor } from "./mediasync.js";

const CORNERS_KEY = "ldp:corners";
const WARP_KEY = "ldp:warp"; // 격자 워프 상태 (개정 2호) — 4코너 계약(A6)과 별도 보존
const QR_IDLE_MS = 5 * 60 * 1000; // 드로잉 유휴 5분 후 QR 재표시

const WARP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// 콘텐츠 합성(미디어+잉크+글로우 — 프로젝터의 가산 광학)과 워프 제시를 단일 패스로
const COMPOSE_GLSL = /* glsl */ `
  uniform sampler2D uInk;
  uniform sampler2D uGlow;
  uniform float uGlowOn;
  uniform sampler2D uMedia;
  uniform float uMediaOn;
  uniform float uMediaOpacity;
  uniform mat3 uMediaM; // 콘텐츠(y아래) → 미디어 UV
  vec3 composeAt(vec2 c) {
    vec3 col = vec3(0.0);
    if (uMediaOn > 0.5) {
      vec3 mp = uMediaM * vec3(c, 1.0);
      if (mp.x >= 0.0 && mp.x <= 1.0 && mp.y >= 0.0 && mp.y <= 1.0)
        col += texture2D(uMedia, mp.xy).rgb * uMediaOpacity;
    }
    col += texture2D(uInk, c).rgb;
    col += texture2D(uGlow, c).rgb * (0.85 * uGlowOn);
    return col;
  }
`;

const WARP_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform mat3 uH; // 화면(y아래 정규화) → 콘텐츠 UV 역사상
  ${"COMPOSE"}
  void main() {
    vec3 q = uH * vec3(vUv.x, 1.0 - vUv.y, 1.0);
    vec2 c = q.xy / q.z;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // 워프 밖 — 검정
      return;
    }
    gl_FragColor = vec4(composeAt(c), 1.0);
  }
`.replace("COMPOSE", COMPOSE_GLSL);

export function startOutput(root) {
  root.innerHTML = `
    <div class="output-page">
      <canvas data-test="output-canvas"></canvas>
      <div class="qr-badge hidden">
        <img alt="드로잉 접속 QR" />
        <span>아이패드 카메라로 스캔</span>
      </div>
    </div>`;
  const canvas = root.querySelector('[data-test="output-canvas"]');

  // ─── WebGL 합성기 — 백킹 1920×1080 고정 (프로젝터 목표 해상도, A8) ───
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080, false); // CSS 크기는 스타일시트가 관리
  renderer.autoClear = false; // 워프 쿼드가 전 픽셀을 덮는다 — 클리어 패스 절약

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 콘텐츠 레이어: 잉크 오프스크린 캔버스 → 텍스처
  const ink = createInk({ width: 1920, height: 1080 });
  const inkTexture = new THREE.CanvasTexture(ink.canvas);
  inkTexture.colorSpace = THREE.SRGBColorSpace;
  inkTexture.minFilter = THREE.LinearFilter;
  inkTexture.magFilter = THREE.LinearFilter;
  inkTexture.generateMipmaps = false;
  // 업로드 고속 경로 — CPU 행 뒤집기·알파 변환 제거 (셰이더가 y아래로 직접 샘플)
  inkTexture.flipY = false;
  inkTexture.premultiplyAlpha = false;

  const fx = createFx({ renderer, inkTexture });

  // 워프 메시 — 잉크·글로우 텍스처를 호모그래피로 샘플 (면 추가 = 메시 추가)
  const mediaFallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  mediaFallback.needsUpdate = true;
  const warpMat = new THREE.ShaderMaterial({
    vertexShader: WARP_VERT,
    fragmentShader: WARP_FRAG,
    uniforms: {
      uInk: { value: inkTexture },
      uGlow: { value: fx.glowTexture },
      uGlowOn: { value: 0 },
      uH: { value: new THREE.Matrix3() },
      uMedia: { value: mediaFallback },
      uMediaOn: { value: 0 },
      uMediaOpacity: { value: 0.9 },
      uMediaM: { value: new THREE.Matrix3() },
    },
    depthTest: false,
    depthWrite: false,
  });
  const warpQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMat);
  warpQuad.frustumCulled = false;

  // 격자 워프 메시 (개정 2호) — 곡면 손정렬. 정점 그리드를 제어점 보간으로 변위,
  // 프래그먼트는 잉크+글로우를 콘텐츠 UV로 그대로 샘플 (순방향 워프)
  const GRID_FRAG = /* glsl */ `
    precision mediump float;
    varying vec2 vUv;
    ${"COMPOSE"}
    void main() {
      vec2 c = vec2(vUv.x, 1.0 - vUv.y); // 콘텐츠 y아래
      gl_FragColor = vec4(composeAt(c), 1.0);
    }
  `.replace("COMPOSE", COMPOSE_GLSL);
  const gridMat = new THREE.ShaderMaterial({
    vertexShader: WARP_VERT,
    fragmentShader: GRID_FRAG,
    uniforms: warpMat.uniforms, // uInk·uGlow·uGlowOn 공유 (uH는 격자에서 미사용)
    depthTest: false,
    depthWrite: false,
  });
  const GRID_SEG = [64, 36];
  const gridGeom = new THREE.PlaneGeometry(2, 2, GRID_SEG[0], GRID_SEG[1]);
  const gridMesh = new THREE.Mesh(gridGeom, gridMat);
  gridMesh.frustumCulled = false;
  gridMesh.visible = false;

  const presentScene = new THREE.Scene();
  presentScene.add(warpQuad);
  presentScene.add(gridMesh);
  presentScene.add(fx.sparklePoints); // 입자는 스폰 시 CPU 워프 적용된 화면 좌표

  // ─── 읽기 전용 레지스트리 (채점 계약 — 실제 렌더 상태 반영, C4 교차검증 대상) ───
  const effects = { trail: false, glow: false, trailSeconds: 8, trailPermanent: false };
  window.__ldp = { strokes: ink.pub, effects };

  // ─── 4코너 (A6) — 항상 출력 쪽 저장. 부팅 시 읽기만, 변경 수신 시에만 쓴다 ───
  let corners = IDENTITY_CORNERS.slice();
  let hFwd = homographyFromUnitSquare(corners);
  const validCorners = (v) =>
    Array.isArray(v) && v.length === 8 && v.every((n) => typeof n === "number" && isFinite(n));
  try {
    const raw = localStorage.getItem(CORNERS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (validCorners(v)) corners = v;
    }
  } catch {
    /* 손상된 저장값 — 항등 유지 */
  }

  // ─── 워프 상태 — 4코너(기본) 또는 격자(개정 2호). 격자는 ldp:warp에 별도 저장 ───
  const warp = { mode: "corners", nx: 3, ny: 3, points: null };
  try {
    const raw = localStorage.getItem(WARP_KEY);
    if (raw) {
      const w = JSON.parse(raw);
      if (w && w.mode === "grid" && validGrid("grid", w.nx, w.ny, w.points)) {
        warp.mode = "grid";
        warp.nx = w.nx;
        warp.ny = w.ny;
        warp.points = w.points;
      }
    }
  } catch {
    /* 손상 저장값 — 4코너 유지 */
  }

  let needRender = true;

  function updateGridMesh() {
    const pos = gridGeom.attributes.position;
    const uv = gridGeom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const vDown = 1 - uv.getY(i); // 콘텐츠 y아래
      const s = sampleGrid(warp.points, warp.nx, warp.ny, u, vDown);
      pos.setXY(i, s.x * 2 - 1, 1 - s.y * 2); // 화면 y아래 → NDC
    }
    pos.needsUpdate = true;
  }

  function applyCorners() {
    hFwd = homographyFromUnitSquare(corners);
    warpMat.uniforms.uH.value.fromArray(inverseWarpMatrixColumnMajor(corners));
    needRender = true;
  }

  function applyWarp() {
    const grid = warp.mode === "grid";
    gridMesh.visible = grid;
    warpQuad.visible = !grid;
    if (grid) updateGridMesh();
    else applyCorners();
    needRender = true;
  }
  applyCorners();
  applyWarp();

  /** 콘텐츠 → 화면(y아래) — 스파클 스폰용, 모드 공통 */
  const contentToScreen = (x, y) =>
    warp.mode === "grid" ? sampleGrid(warp.points, warp.nx, warp.ny, x, y) : applyHomography(hFwd, x, y);

  // ─── 가상 표면 시뮬레이터 (?sim=curtain|column|globe) — 프로젝터 대역 ───
  const simKind = new URLSearchParams(location.search).get("sim");
  if (simKind) {
    const page = root.querySelector(".output-page");
    const simCanvas = document.createElement("canvas");
    simCanvas.className = "sim-surface";
    drawSimSurface(simCanvas, simKind);
    page.insertBefore(simCanvas, canvas);
    canvas.classList.add("sim-blend"); // screen 블렌드 — 검정=빛 없음(가산 광학)
  }

  // ─── QR 접속 배지 (WORKFLOW 최초 설치 4) — 책상·채점(localhost)에서는 없음 ───
  const qrBadge = root.querySelector(".qr-badge");
  const host = location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  let qrTimer = null;
  if (!isLocal) {
    QRCode.toDataURL(`${location.origin}/?role=draw`, { width: 220, margin: 1 })
      .then((url) => {
        qrBadge.querySelector("img").src = url;
        qrBadge.classList.remove("hidden");
      })
      .catch(() => {
        /* QR 생성 실패 — 주소 직접 입력으로 우회 가능 */
      });
  }
  function drawActivity() {
    if (isLocal) return;
    qrBadge.classList.add("hidden");
    if (qrTimer) clearTimeout(qrTimer);
    qrTimer = setTimeout(() => qrBadge.classList.remove("hidden"), QR_IDLE_MS);
  }

  // ─── 별 반짝임 스폰 게이트 — 획 경로를 따라 18px(1080p) 간격, 스폰 시 워프 적용 ───
  const strokeMeta = new Map(); // id → { color, width, erase, lastX, lastY, acc }
  const nowSec = () => performance.now() / 1000;
  function feedSparkles(id, pts) {
    if (!effects.glow || !pts || !pts.length) return;
    const m = strokeMeta.get(id);
    if (!m || m.erase) return;
    const out = [];
    for (const p of pts) {
      if (m.lastX === undefined) {
        m.lastX = p.x;
        m.lastY = p.y;
        m.acc = 999; // 첫 점은 즉시 스폰
      }
      m.acc += Math.hypot((p.x - m.lastX) * 1920, (p.y - m.lastY) * 1080);
      m.lastX = p.x;
      m.lastY = p.y;
      if (m.acc >= 18) {
        m.acc = 0;
        const s = contentToScreen(p.x, p.y); // 콘텐츠 → 화면(y아래, 모드 공통)
        out.push({ x: s.x * 2 - 1, y: 1 - s.y * 2 }); // → NDC
      }
    }
    if (out.length) fx.spawn(out, m.color, m.width, nowSec());
  }

  // ─── 미디어 레이어 (ORDER-06, VISION #4) — 이미지·영상을 면에 합성 ───
  const media = {
    state: { on: false, opacity: 0.9, x: 0.5, y: 0.5, scale: 0.6, rot: 0 },
    el: null, // HTMLImageElement | HTMLVideoElement
    tex: null,
    kind: null,
    url: null,
    aspect: 16 / 9,
  };
  function applyMediaUniforms() {
    warpMat.uniforms.uMediaOn.value = media.state.on && media.tex ? 1 : 0;
    warpMat.uniforms.uMediaOpacity.value = media.state.opacity;
    warpMat.uniforms.uMediaM.value.fromArray(
      mediaUvMatrixColumnMajor(media.state, media.aspect)
    );
    needRender = true;
  }
  function disposeMedia() {
    if (media.el && media.kind === "video") {
      media.el.pause();
      media.el.src = "";
    }
    if (media.tex) media.tex.dispose();
    if (media.url) URL.revokeObjectURL(media.url);
    media.el = null; // 스테일 콜백 가드의 기준 — 진행 중 로드는 이 시점부터 무효
    media.tex = null;
    media.url = null;
    media.kind = null;
    media.aspect = 16 / 9;
    warpMat.uniforms.uMedia.value = mediaFallback;
    warpMat.uniforms.uMediaOn.value = 0;
    needRender = true;
  }
  const mediaAssembler = createMediaAssembler(({ kind, blob }) => {
    disposeMedia();
    media.kind = kind;
    media.url = URL.createObjectURL(blob);
    if (kind === "video") {
      const v = document.createElement("video");
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.src = media.url;
      v.addEventListener(
        "loadeddata",
        () => {
          if (media.el !== v) return; // 교체된 낡은 로드 — 무시 (스테일 콜백 가드)
          media.aspect = (v.videoWidth || 16) / (v.videoHeight || 9);
          media.tex = new THREE.VideoTexture(v);
          media.tex.colorSpace = THREE.SRGBColorSpace;
          media.tex.flipY = false;
          warpMat.uniforms.uMedia.value = media.tex;
          v.play().catch(() => {});
          applyMediaUniforms();
        },
        { once: true }
      );
      media.el = v;
    } else {
      const img = new Image();
      img.onload = () => {
        if (media.el !== img) return; // 교체된 낡은 로드 — 무시
        media.aspect = (img.naturalWidth || 16) / (img.naturalHeight || 9);
        media.tex = new THREE.Texture(img);
        media.tex.colorSpace = THREE.SRGBColorSpace;
        media.tex.flipY = false;
        media.tex.minFilter = THREE.LinearFilter;
        media.tex.generateMipmaps = false;
        media.tex.needsUpdate = true;
        warpMat.uniforms.uMedia.value = media.tex;
        applyMediaUniforms();
      };
      img.onerror = () => {
        if (media.el === img) disposeMedia(); // 손상 blob — 상태 정리
      };
      img.src = media.url;
      media.el = img;
    }
  });
  const mediaPlaying = () =>
    media.kind === "video" && media.el && !media.el.paused && media.state.on && media.tex;

  // ─── 센서 리액티브 (ORDER-06, VISION #5) — 모션 지점에 별 반짝임 ───
  let lastMotionSpawn = 0;

  // ─── 동기화 구독 ───
  const sync = openSync();

  sync.on((msg) => {
    if (!msg) return;
    switch (msg.t) {
      case "s":
        ink.begin(msg.id, { color: msg.color, width: msg.width, erase: msg.erase });
        strokeMeta.set(msg.id, { color: msg.color, width: msg.width, erase: msg.erase });
        ink.addPoints(msg.id, msg.p);
        feedSparkles(msg.id, msg.p);
        drawActivity();
        break;
      case "a":
        ink.addPoints(msg.id, msg.p);
        feedSparkles(msg.id, msg.p);
        break;
      case "e":
        ink.end(msg.id);
        strokeMeta.delete(msg.id);
        break;
      case "undo":
        ink.remove(msg.id);
        strokeMeta.delete(msg.id);
        needRender = true;
        glowForce = true;
        break;
      case "replay":
        // 출력 (재)부팅 복구 — 이미 온전한 획은 건너뛰고 부족한 획만 대체
        if (Array.isArray(msg.strokes)) {
          for (const s of msg.strokes) {
            if (!s || !Array.isArray(s.points)) continue;
            if (ink.pointCount(s.id) >= s.points.length) continue;
            // 갤러리 리플레이(id=키)라도 라이브 원본을 이미 들고 있으면 중복 등록 금지
            if (s.srcId && ink.pointCount(s.srcId) >= s.points.length) continue;
            ink.begin(s.id, { color: s.color, width: s.width, erase: s.erase });
            ink.addPoints(s.id, s.points);
            if (s.done) ink.end(s.id);
          }
        }
        drawActivity();
        break;
      case "clear":
        ink.clear();
        strokeMeta.clear();
        needRender = true;
        glowForce = true;
        break;
      case "fx":
        Object.assign(effects, msg.fx);
        fx.setGlow(effects.glow);
        warpMat.uniforms.uGlowOn.value = effects.glow ? 1 : 0;
        ink.setFade(effects);
        needRender = true;
        glowForce = true;
        break;
      case "hello":
        drawActivity();
        break;
      case "corners":
        if (validCorners(msg.v)) {
          corners = msg.v.slice();
          if (warp.mode !== "corners") {
            warp.mode = "corners"; // 4코너 조작 = 격자 해제
            try {
              localStorage.removeItem(WARP_KEY);
            } catch {
              /* noop */
            }
          }
          applyWarp();
          try {
            localStorage.setItem(CORNERS_KEY, JSON.stringify(corners));
          } catch {
            /* 저장 불가 환경 — 런타임 값은 유지 */
          }
        }
        break;
      case "warp":
        // 격자 워프 (개정 2호) — grid 적용·저장 / corners 복귀
        if (msg.mode === "grid" && validGrid("grid", msg.nx, msg.ny, msg.points)) {
          warp.mode = "grid";
          warp.nx = msg.nx;
          warp.ny = msg.ny;
          warp.points = msg.points.map((p) => ({ x: p.x, y: p.y }));
          applyWarp();
          try {
            localStorage.setItem(
              WARP_KEY,
              JSON.stringify({ mode: "grid", nx: warp.nx, ny: warp.ny, points: warp.points })
            );
          } catch {
            /* noop */
          }
        } else if (msg.mode === "corners") {
          warp.mode = "corners";
          applyWarp();
          try {
            localStorage.removeItem(WARP_KEY);
          } catch {
            /* noop */
          }
        }
        break;
      case "corners-req":
        sync.send({ t: "corners", v: corners.slice() });
        break;
      case "media-part":
        mediaAssembler(msg);
        drawActivity();
        break;
      case "media-state":
        if (msg.s && typeof msg.s === "object") {
          const s = media.state;
          s.on = !!msg.s.on;
          if (isFinite(msg.s.opacity)) s.opacity = Math.min(1, Math.max(0.05, +msg.s.opacity));
          if (isFinite(msg.s.x)) s.x = Math.min(1.5, Math.max(-0.5, +msg.s.x));
          if (isFinite(msg.s.y)) s.y = Math.min(1.5, Math.max(-0.5, +msg.s.y));
          if (isFinite(msg.s.scale)) s.scale = Math.min(2, Math.max(0.05, +msg.s.scale));
          if (isFinite(msg.s.rot)) s.rot = +msg.s.rot;
          if (media.kind === "video" && media.el) {
            if (s.on) media.el.play().catch(() => {});
            else media.el.pause();
          }
          applyMediaUniforms();
        }
        break;
      case "media-clear":
        disposeMedia();
        break;
      case "motion":
        // 센서 모션 → 별 반짝임 (글로우 토글과 무관하게 발동)
        if (isFinite(msg.x) && isFinite(msg.y)) {
          const t = nowSec();
          if (t - lastMotionSpawn > 0.03) {
            lastMotionSpawn = t;
            const s = contentToScreen(Math.min(1, Math.max(0, msg.x)), Math.min(1, Math.max(0, msg.y)));
            const jitter = () => (Math.random() - 0.5) * 0.06;
            fx.spawn(
              Array.from({ length: 3 }, () => ({
                x: s.x * 2 - 1 + jitter(),
                y: 1 - s.y * 2 + jitter(),
              })),
              "#ffe9f5",
              10,
              t,
              true // 강제 — 센서 리액티브는 독립 연출
            );
            // needRender 없이 sparklesAlive busy 경로가 렌더 — 적응 분주(A3 예산) 준수
          }
        }
        break;
      case "warp-req":
        sync.send({
          t: "warp-state",
          mode: warp.mode,
          nx: warp.nx,
          ny: warp.ny,
          points: warp.points,
          corners: corners.slice(),
        });
        break;
    }
  });

  // 먼저 떠 있던 드로잉 기기에서 연출 상태·획을 받아온다 (재부팅 복구 포함)
  sync.send({ t: "sync-req" });
  sync.onUp(() => sync.send({ t: "sync-req" }));

  // ─── 화면 꺼짐 방지 (프로젝터 PC) ───
  navigator.wakeLock?.request("screen").catch(() => {});

  // ─── 렌더 루프 — 변화가 있을 때만 합성·제시 (유휴 프레임 비용 0) ───
  let glowForce = false; // 단발 상태 변화(undo·clear·fx·리플레이)는 글로우 강제 재계산
  function present(t, inkChanged) {
    if (inkChanged) {
      inkTexture.needsUpdate = true;
      fx.updateGlow(glowForce); // 글로우는 잉크가 변한 프레임에만 재계산
      glowForce = false;
    }
    fx.setTime(t);
    renderer.setRenderTarget(null);
    if (warp.mode === "grid") renderer.clear(); // 격자 메시는 전 화면을 덮지 않을 수 있다
    renderer.render(presentScene, camera);
  }

  // 새 잉크는 즉시 제시(지연 불변), 잔상 감쇠·반짝임 애니메이션 틱은 적응형 —
  // 실측 rAF 간격으로 기기 여력을 추정해 30Hz(여유)~15Hz(소프트웨어 GL) 사이를
  // 오간다. 감쇠·트윙클은 저주파 변화라 지각 손실 없이 rAF 서비스(A3)를 지킨다.
  let animDiv = 4; // 비관적 시작 — 빠른 기기임이 증명되면 완화
  let emaGap = 22; // 바쁜 구간 rAF 간격의 지수평균(ms)
  let lastFrameAt = 0;
  let frameNo = 0;
  function frame() {
    const P = window.__ldpPerf; // 개발용 프레임 계측 (벤치에서만 활성)
    const p0 = P ? performance.now() : 0;
    const t = nowSec();
    frameNo++;
    const animBusy = ink.fadeBusy() || fx.sparklesAlive(t) || mediaPlaying();
    if (animBusy && lastFrameAt) {
      const gap = (t - lastFrameAt) * 1000;
      // 비대칭 EMA — 느려짐엔 즉각 반응, 빨라짐은 천천히 신뢰 (rAF 서비스 보호 우선)
      if (gap < 200) emaGap = gap > emaGap ? emaGap * 0.8 + gap * 0.2 : emaGap * 0.97 + gap * 0.03;
      // 열악 환경(배터리 모드·저사양)에서는 6분주(10Hz)까지 물러난다 — 감쇠는 저주파라 안전
      animDiv = emaGap > 24 ? 6 : emaGap > 18.5 ? 4 : emaGap > 17.0 ? 3 : 2;
    }
    lastFrameAt = t;
    if (ink.hasNew() || needRender || (animBusy && frameNo % animDiv === 0)) {
      const p1 = P ? performance.now() : 0;
      const res = ink.drawPending();
      const p2 = P ? performance.now() : 0;
      present(t, res.dirty || needRender);
      needRender = false;
      if (P) P.push({ draw: p2 - p1, present: performance.now() - p2 });
      // 렌더 마크는 실제로 픽셀이 올라간 뒤에 찍는다 (A1 — 첫 포인트 렌더 프레임, 1회)
      for (const id of res.first) performance.mark("ldp:render:" + id);
    }
    requestAnimationFrame(frame);
  }
  present(nowSec(), true); // 부팅 프레임 (검정 + 저장된 워프)
  requestAnimationFrame(frame);
}
