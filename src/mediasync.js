// 미디어 전송 (ORDER-06) — 이미지·영상 파일을 동기화 버스로 청크 스트리밍.
// 같은 기기(BC)든 두 기기(ws 릴레이)든 단일 경로: base64 48KB 청크 + 재조립.
// 전송 상한 25MB. 인코딩된 청크는 발신 측에 캐시 — 출력 재부팅 시 재전송용.

const CHUNK = 48 * 1024; // base64 이전 원본 바이트 기준
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

let mediaSeq = 0;

/** 파일 → 청크 배열 (캐시 가능) */
export async function encodeMedia(file) {
  if (file.size > MEDIA_MAX_BYTES) throw new Error("25MB 초과");
  const buf = new Uint8Array(await file.arrayBuffer());
  const id = "m" + Date.now().toString(36) + mediaSeq++;
  const total = Math.ceil(buf.length / CHUNK);
  const kind = (file.type || "").startsWith("video") ? "video" : "image";
  const chunks = [];
  for (let i = 0; i < total; i++) {
    const slice = buf.subarray(i * CHUNK, (i + 1) * CHUNK);
    let bin = "";
    for (let j = 0; j < slice.length; j += 8192)
      bin += String.fromCharCode.apply(null, slice.subarray(j, j + 8192));
    chunks.push({
      t: "media-part",
      id,
      i,
      n: total,
      ...(i === 0 ? { kind, mime: file.type || (kind === "video" ? "video/mp4" : "image/png") } : {}),
      d: btoa(bin),
    });
  }
  return { id, kind, chunks };
}

/** 청크 발신 — 백프레셔(ws 송신 버퍼) 준수 + 취소 가능.
 *  반환된 함수를 호출하면 남은 전송이 중단된다 (announce 중첩·새 파일 교체 시). */
export function sendChunks(sync, chunks, done) {
  let i = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    // 실 WiFi에서 획 메시지가 미디어 뒤에 줄서지 않도록 송신 버퍼 1.5MB 상한
    if ((sync.bufferedAmount ? sync.bufferedAmount() : 0) > 1.5 * 1024 * 1024) {
      setTimeout(tick, 60);
      return;
    }
    const end = Math.min(chunks.length, i + 12);
    for (; i < end; i++) sync.send(chunks[i]);
    if (i < chunks.length) setTimeout(tick, 16);
    else if (done) done();
  };
  tick();
  return () => {
    cancelled = true;
  };
}

const MAX_CHUNKS = Math.ceil(MEDIA_MAX_BYTES / CHUNK) + 1; // 수신측 상한 (25MB 우회 봉쇄)
const MAX_PART_LEN = Math.ceil((CHUNK * 4) / 3) + 8; // base64 청크 길이 상한

/** 수신 재조립기 — 완성 시 onMedia({id, kind, blob}).
 *  수신측 검증: i·n 정수·상한·청크 길이 — 버스의 임의 메시지로부터 메모리를 지킨다. */
export function createMediaAssembler(onMedia) {
  let cur = null; // { id, kind, mime, parts: [], got }
  const completed = new Set(); // 이미 조립 완료한 전송 — 재전송(announce) 무시
  return (msg) => {
    if (!msg || msg.t !== "media-part" || typeof msg.d !== "string") return;
    if (typeof msg.id !== "string" || msg.id.length > 64) return;
    if (!Number.isInteger(msg.i) || !Number.isInteger(msg.n)) return;
    if (msg.n < 1 || msg.n > MAX_CHUNKS || msg.i < 0 || msg.i >= msg.n) return;
    if (msg.d.length > MAX_PART_LEN) return;
    if (completed.has(msg.id)) return; // 완료본 재전송 — 재조립 불필요
    if (!cur || cur.id !== msg.id) {
      if (msg.i !== 0) return; // 중간부터 온 낯선 전송 — 무시 (첫 청크에 메타)
      cur = { id: msg.id, kind: msg.kind === "video" ? "video" : "image", mime: msg.mime, parts: new Array(msg.n), got: 0 };
    }
    if (cur.parts[msg.i]) return;
    cur.parts[msg.i] = msg.d;
    cur.got++;
    if (cur.got === cur.parts.length) {
      completed.add(cur.id);
      if (completed.size > 16) completed.delete(completed.values().next().value);
      try {
        const bins = cur.parts.map((b64) => {
          const bin = atob(b64);
          const u = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
          return u;
        });
        const blob = new Blob(bins, { type: cur.mime });
        onMedia({ id: cur.id, kind: cur.kind, blob });
      } catch {
        /* 손상 전송 — 폐기 */
      }
      cur = null;
    }
  };
}

/** 콘텐츠 좌표(y아래) → 미디어 UV 변환 행렬 (열 우선, GLSL mat3용).
 *  media: {x, y(중심), scale(콘텐츠 가로 대비 폭), rot(라디안)}, am=미디어 종횡비 */
export function mediaUvMatrixColumnMajor(media, am) {
  const CW = 16;
  const CH = 9; // 콘텐츠 물리 비율
  const w = Math.max(0.02, media.scale) * CW; // 물리 폭
  const h = w / Math.max(0.05, am); // 물리 높이
  const cos = Math.cos(-media.rot);
  const sin = Math.sin(-media.rot);
  // u = ((cx-x)*CW*cos - (cy-y)*CH*sin)/w + 0.5  → 행렬 전개
  const a = (CW * cos) / w;
  const b = (-CH * sin) / w;
  const c0 = -(media.x * CW * cos - media.y * CH * sin) / w + 0.5;
  const d = (CW * sin) / h;
  const e = (CH * cos) / h;
  const f0 = -(media.x * CW * sin + media.y * CH * cos) / h + 0.5;
  // 행 우선 [[a,b,c0],[d,e,f0],[0,0,1]] → 열 우선
  return [a, d, 0, b, e, 0, c0, f0, 1];
}
