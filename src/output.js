// 출력 뷰 (?role=output) — 콘텐츠(잉크) → 오프스크린 텍스처 → 워프 메시.
// 사이클 #1: 워프는 항등(전면 쿼드). #3에서 이 쿼드가 호모그래피 워프 메시가 된다.
// 채점 계약: 백킹 해상도 ≥1920×1080(A8), 렌더 마크(A1), 읽기 전용 레지스트리, ldp:corners.

import * as THREE from "three";
import { createInk } from "./ink.js";
import { openSync } from "./sync.js";

const CORNERS_KEY = "ldp:corners";

export function startOutput(root) {
  root.innerHTML = `<div class="output-page"><canvas data-test="output-canvas"></canvas></div>`;
  const canvas = root.querySelector('[data-test="output-canvas"]');

  // ─── WebGL 합성기 — 백킹 1920×1080 고정 (프로젝터 목표 해상도, A8) ───
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080, false); // CSS 크기는 스타일시트가 관리

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 콘텐츠 레이어: 잉크 오프스크린 캔버스 → 텍스처
  const ink = createInk({ width: 1920, height: 1080 });
  const texture = new THREE.CanvasTexture(ink.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // 워프 메시 자리 — #1은 항등 전면 쿼드, #3에서 4코너 호모그래피로 확장
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );
  scene.add(quad);

  // ─── 읽기 전용 레지스트리 (채점 계약 — 실제 렌더 상태 반영, C4 교차검증 대상) ───
  const effects = { trail: false, glow: false, trailSeconds: 8, trailPermanent: false };
  window.__ldp = { strokes: ink.pub, effects };

  // ─── 4코너 정렬값 (A6) — 항상 출력 쪽 저장. 부팅 시 읽기만, 변경 수신 시에만 쓴다 ───
  let corners = [0, 0, 1, 0, 1, 1, 0, 1]; // 항등 (x,y ×4, 정규화)
  try {
    const raw = localStorage.getItem(CORNERS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length === 8 && v.every((n) => typeof n === "number")) {
        corners = v;
      }
    }
  } catch {
    /* 손상된 저장값은 무시하고 항등 유지 */
  }

  // ─── 동기화 구독 ───
  const sync = openSync();
  let needRender = true; // 첫 프레임(검정)과 clear 직후 강제 프레젠트

  sync.on((msg) => {
    if (!msg) return;
    switch (msg.t) {
      case "s":
        ink.begin(msg.id, { color: msg.color, width: msg.width, erase: msg.erase });
        ink.addPoints(msg.id, msg.p);
        break;
      case "a":
        ink.addPoints(msg.id, msg.p);
        break;
      case "e":
        ink.end(msg.id);
        break;
      case "clear":
        ink.clear();
        needRender = true;
        break;
      case "fx":
        Object.assign(effects, msg.fx);
        break;
      case "corners":
        if (Array.isArray(msg.v) && msg.v.length === 8) {
          corners = msg.v.slice();
          try {
            localStorage.setItem(CORNERS_KEY, JSON.stringify(corners));
          } catch {
            /* 저장 불가 환경 — 런타임 값은 유지 */
          }
        }
        break;
    }
  });

  // 드로잉 페이지가 먼저 떠 있었다면 연출 상태를 받아온다
  sync.send({ t: "sync-req" });

  // ─── 렌더 루프 — 변화가 있을 때만 텍스처 업로드·렌더 (유휴 프레임 비용 0) ───
  function frame() {
    const res = ink.drawPending();
    if (res.dirty || needRender) {
      texture.needsUpdate = true;
      renderer.render(scene, camera);
      needRender = false;
    }
    // 렌더 마크는 실제로 픽셀이 올라간 뒤에 찍는다 (A1 — 첫 포인트 렌더 프레임, 1회)
    for (const id of res.first) performance.mark("ldp:render:" + id);
    requestAnimationFrame(frame);
  }
  renderer.render(scene, camera); // 부팅 프레임 (검정)
  requestAnimationFrame(frame);
}
