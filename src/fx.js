// 연출 (사이클 #2) — 글로우 텍스처 파이프라인 + 별 반짝임 입자.
//
// 구조: 콘텐츠(잉크 캔버스) → 오프스크린 텍스처(잉크 텍스처 + 저해상 글로우 RT)
//       → 워프 메시(출력의 단일 셰이더 쿼드)가 두 텍스처를 합성 샘플.
// 풀스크린 1080p 패스는 워프 제시 단 하나 — 소프트웨어 GL(채점기 헤드리스)에서도
// 55fps를 지키기 위한 예산 설계다. 글로우 블러는 480×270에서만 돈다.
//
// 별 반짝임(취향 앵커): 획 경로를 따라 생성되는 트윙클 입자. 위치는 스폰 시점에
// CPU에서 워프(호모그래피)를 적용해 화면 공간에 고정한다 — 입자 수명이 짧아
// 스폰 후 코너 변경과의 오차는 무시 가능.

import * as THREE from "three";

const GLOW_W = 320;
const GLOW_H = 180;
const SPARKLE_CAP = 768;

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uGain;
  void main() {
    gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uGain, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uDir; // (1/w,0) 또는 (0,1/h) × 스프레드
  void main() {
    vec3 c = texture2D(uTex, vUv).rgb * 0.227027;
    c += texture2D(uTex, vUv + uDir * 1.3846).rgb * 0.3162162;
    c += texture2D(uTex, vUv - uDir * 1.3846).rgb * 0.3162162;
    c += texture2D(uTex, vUv + uDir * 3.2308).rgb * 0.0702703;
    c += texture2D(uTex, vUv - uDir * 3.2308).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// 2단계 글로우 합성 — 좁은 심지(선명한 발광) + 넓은 번짐(앵커의 부드러운 확산광)
const COMBINE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D uTight;
  uniform sampler2D uWide;
  void main() {
    vec3 c = texture2D(uTight, vUv).rgb * 0.55 + texture2D(uWide, vUv).rgb * 0.8;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const SPARK_VERT = /* glsl */ `
  attribute float aBirth;
  attribute float aLife;
  attribute float aSize;
  attribute float aSeed;
  attribute vec3 aColor;
  attribute vec2 aVel;
  uniform float uTime;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float age = uTime - aBirth;
    float t = age / max(aLife, 0.001);
    if (t < 0.0 || t > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // 클립 밖 — 죽은 입자
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      vColor = vec3(0.0);
      return;
    }
    float fadeIn = smoothstep(0.0, 0.12, t);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, t);
    float tw = 0.55 + 0.45 * sin(uTime * (5.0 + aSeed * 9.0) + aSeed * 47.0);
    vAlpha = fadeIn * fadeOut * tw;
    vColor = aColor;
    gl_PointSize = aSize * (0.75 + 0.35 * tw);
    // 부유 드리프트 — 앵커의 떠다니는 발광체 느낌 (느린 상승 + 미세 흔들림)
    vec2 drift = position.xy + aVel * age + vec2(sin(uTime * 1.3 + aSeed * 31.0) * 0.004, 0.0);
    gl_Position = vec4(drift, 0.0, 1.0);
  }
`;

const SPARK_FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float core = smoothstep(1.0, 0.0, r);
    core *= core;
    // 십자 스파이크 — 별 반짝임의 형태 (취향 앵커)
    float spikes = (pow(max(0.0, 1.0 - abs(p.x)), 6.0) + pow(max(0.0, 1.0 - abs(p.y)), 6.0)) * 0.8;
    spikes *= smoothstep(1.25, 0.1, r);
    float a = clamp(core + spikes, 0.0, 1.2) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

function fsQuadScene(material) {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return scene;
}

/** 파스텔화 — 원색을 흰빛 쪽으로 절반 끌어올린다 (부드럽게 번지는 발광 톤) */
function pastel(hex) {
  const c = new THREE.Color(typeof hex === "string" ? hex : "#ffffff");
  return c.lerp(new THREE.Color(1, 1, 1), 0.45);
}

export function createFx({ renderer, inkTexture }) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── 글로우 핑퐁 RT (저해상 — 비용 상한 고정) ──
  const mkRT = () =>
    new THREE.WebGLRenderTarget(GLOW_W, GLOW_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  const rtA = mkRT();
  const rtB = mkRT();
  const rtC = mkRT();

  const copyMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: COPY_FRAG,
    uniforms: { uTex: { value: inkTexture }, uGain: { value: 1.2 } },
    depthTest: false,
    depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: BLUR_FRAG,
    uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });
  const combineMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: COMBINE_FRAG,
    uniforms: { uTight: { value: rtA.texture }, uWide: { value: rtC.texture } },
    depthTest: false,
    depthWrite: false,
  });
  const copyScene = fsQuadScene(copyMat);
  const blurScene = fsQuadScene(blurMat);
  const combineScene = fsQuadScene(combineMat);

  let glowOn = false;

  const blurPass = (fromRT, toRT, spread, dirX) => {
    blurMat.uniforms.uTex.value = fromRT.texture;
    blurMat.uniforms.uDir.value.set(dirX ? spread / GLOW_W : 0, dirX ? 0 : spread / GLOW_H);
    renderer.setRenderTarget(toRT);
    renderer.render(blurScene, camera);
  };

  /** 잉크가 변한 프레임에 호출 — 2단계(심지+넓은 번짐) 글로우 → rtA.
   *  연속 틱(잔상 감쇠)은 격틱으로 아껴 쓰되, force=단발 갱신(undo·clear·연출 전환·
   *  만료 검정 프레임)은 반드시 재계산 — 스킵되면 글로우 잔상이 남는다 (감사 2차 #5). */
  let glowTick = 0;
  function updateGlow(force = false) {
    if (!glowOn) return;
    if (!force && glowTick++ % 2) return;
    renderer.setRenderTarget(rtB);
    renderer.render(copyScene, camera); // 잉크 다운샘플 → rtB
    blurPass(rtB, rtA, 1.4, true); // H
    blurPass(rtA, rtB, 1.4, false); // V — 심지(tight) 완성 → rtB
    blurPass(rtB, rtA, 3.4, true); // H (심지에서 이어 확산)
    blurPass(rtA, rtC, 3.4, false); // V — 넓은 번짐(wide) 완성 → rtC
    combineMat.uniforms.uTight.value = rtB.texture;
    combineMat.uniforms.uWide.value = rtC.texture;
    renderer.setRenderTarget(rtA);
    renderer.render(combineScene, camera); // 최종 글로우 → rtA
    renderer.setRenderTarget(null);
  }

  // ── 별 반짝임 입자 풀 (화면 공간 NDC — 스폰 시 CPU 워프 적용) ──
  const pos = new Float32Array(SPARKLE_CAP * 3);
  const birth = new Float32Array(SPARKLE_CAP).fill(-1e9);
  const life = new Float32Array(SPARKLE_CAP).fill(1);
  const size = new Float32Array(SPARKLE_CAP);
  const seed = new Float32Array(SPARKLE_CAP);
  const col = new Float32Array(SPARKLE_CAP * 3);
  const vel = new Float32Array(SPARKLE_CAP * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(vel, 2));

  const sparkMat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const sparklePoints = new THREE.Points(geo, sparkMat);
  sparklePoints.frustumCulled = false;
  sparklePoints.renderOrder = 1; // 워프 쿼드 위에

  let cursor = 0;
  let lastDeath = -1;

  /** 입자 생성 — ndcPts는 이미 워프 적용된 화면 NDC 좌표 배열 */
  function spawn(ndcPts, colorHex, widthPx, now) {
    if (!glowOn || !ndcPts.length) return;
    const c = pastel(colorHex);
    for (const p of ndcPts) {
      const i = cursor;
      cursor = (cursor + 1) % SPARKLE_CAP;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = 0;
      birth[i] = now;
      life[i] = 0.7 + Math.random() * 1.1;
      size[i] = (6 + Math.random() * 10) * (0.8 + Math.min(widthPx || 6, 24) / 24);
      seed[i] = Math.random();
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      // 부유 드리프트 — 느린 상승(+y NDC) + 미세 좌우 (앵커의 떠다니는 발광체)
      vel[i * 2] = (Math.random() - 0.5) * 0.01;
      vel[i * 2 + 1] = 0.012 + Math.random() * 0.024;
      lastDeath = Math.max(lastDeath, now + life[i]);
    }
    for (const key of ["position", "aBirth", "aLife", "aSize", "aSeed", "aColor", "aVel"]) {
      geo.attributes[key].needsUpdate = true;
    }
  }

  return {
    glowTexture: rtA.texture,
    sparklePoints,
    updateGlow,
    spawn,
    setGlow(on) {
      glowOn = !!on;
      sparklePoints.visible = glowOn;
    },
    isGlowOn: () => glowOn,
    sparklesAlive: (now) => glowOn && now <= lastDeath,
    setTime(now) {
      sparkMat.uniforms.uTime.value = now;
    },
  };
}
