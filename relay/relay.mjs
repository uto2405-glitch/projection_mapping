// ws 릴레이 — 두 기기 동기화 + 갤러리 영속화 (ORDER-06, VISION #7 테제 5).
// 채점 계약: npm run relay → ws://<host>:8787. 폐쇄 LAN 전용(C1).
// 봉투(_sid,_n) dedup: 클라이언트의 재송신(단절 복구 설계)이 영속화를 이중
// 처리하거나 낡은 clear로 갤러리를 소급 파괴하지 못하게 중복 봉투는 통째로 버린다.

import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8787;
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "relay-state.jsonl");
const TMP = FILE + ".tmp";
const SID = "relay-gallery";
let seq = Date.now();
const nextSeq = () => (seq = Math.max(seq + 1, Date.now())); // 시계 역행 방어

// ─── 갤러리 상태 — JSONL 이벤트 폴드 (add/del/clear) ───
function loadGallery() {
  const map = new Map(); // key(sid:id) → { stroke, srcSid, srcId }
  try {
    if (!fs.existsSync(FILE)) return map;
    for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.op === "add" && ev.key && ev.stroke)
          map.set(ev.key, { stroke: ev.stroke, srcSid: ev.srcSid, srcId: ev.srcId });
        else if (ev.op === "del" && ev.key) map.delete(ev.key);
        else if (ev.op === "clear") map.clear();
      } catch {
        /* 손상 라인 무시 */
      }
    }
  } catch {
    /* 파일 접근 불가 — 빈 갤러리 */
  }
  return map;
}
const gallery = loadGallery();

/** 원자적 압축 재기록 — 임시 파일 + rename (크래시·정전 시 반쪽 파일 방지) */
function compact() {
  try {
    fs.writeFileSync(
      TMP,
      [...gallery.entries()]
        .map(([key, v]) => JSON.stringify({ op: "add", key, stroke: v.stroke, srcSid: v.srcSid, srcId: v.srcId }))
        .join("\n") + (gallery.size ? "\n" : "")
    );
    fs.renameSync(TMP, FILE);
  } catch {
    /* noop */
  }
}
compact();
const appendEv = (ev) => {
  try {
    fs.appendFileSync(FILE, JSON.stringify(ev) + "\n");
  } catch {
    /* noop */
  }
};

// ─── 봉투 dedup — 발신자별 마지막 순번 ───
const lastSeen = new Map(); // sid → n
function isDuplicate(msg) {
  const sid = msg && msg._sid;
  const n = msg && msg._n;
  if (typeof sid !== "string" || !Number.isFinite(n)) return false; // 봉투 없음 — 통과
  const last = lastSeen.get(sid) || 0;
  if (n <= last) return true;
  lastSeen.set(sid, n);
  if (lastSeen.size > 500) lastSeen.delete(lastSeen.keys().next().value);
  return false;
}

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress;
  console.log(`[ldp-relay] 접속: ${peer} (총 ${wss.clients.size}, 갤러리 ${gallery.size}획)`);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  // 신규 접속에 갤러리 리플레이 — srcSid/srcId 동봉 (출력의 라이브 사본 중복 방지·undo 정합)
  if (gallery.size) {
    const strokes = [...gallery.entries()].map(([key, v]) => ({
      ...v.stroke,
      id: key,
      srcSid: v.srcSid,
      srcId: v.srcId,
      done: true,
    }));
    try {
      ws.send(JSON.stringify({ t: "replay", strokes, _sid: SID, _n: nextSeq() }));
    } catch {
      /* noop */
    }
  }

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        // 재송신 봉투는 영속화 부작용만 차단하고 중계는 통과 —
        // 늦게 재접속한 출력이 밀린 undo를 받아야 하고, 이미 받은 수신자는 순번으로 거른다.
        const sid = msg._sid || "anon";
        if (isDuplicate(msg)) {
          /* 부작용 없이 아래 중계로 */
        } else if (msg.t === "persist-stroke" && msg.stroke && msg.stroke.id) {
          const key = `${sid}:${msg.stroke.id}`;
          const stroke = { ...msg.stroke, id: undefined };
          gallery.set(key, { stroke, srcSid: sid, srcId: msg.stroke.id });
          appendEv({ op: "add", key, stroke, srcSid: sid, srcId: msg.stroke.id });
          try {
            ws.send(JSON.stringify({ t: "persist-ack", id: msg.stroke.id, _sid: SID, _n: nextSeq() }));
          } catch {
            /* noop */
          }
        } else if (msg.t === "undo" && msg.id) {
          const key = `${sid}:${msg.id}`;
          if (gallery.delete(key)) {
            appendEv({ op: "del", key });
            // 리플레이 사본(id=key)을 쓰는 출력에도 삭제 전파 (undo 정합)
            const ghost = JSON.stringify({ t: "undo", id: key, _sid: SID, _n: nextSeq() });
            for (const c of wss.clients) if (c.readyState === 1) c.send(ghost);
          }
        } else if (msg.t === "clear") {
          if (gallery.size) {
            gallery.clear();
            compact(); // 파일도 초기화 — '모두 지우기 = 파일 초기화' 이행
          }
        }
      } catch {
        /* JSON 아님 — 중계만 */
      }
    }
    for (const c of wss.clients) {
      if (c !== ws && c.readyState === 1) c.send(data, { binary: isBinary });
    }
  });
  ws.on("error", () => {});
  ws.on("close", () => console.log(`[ldp-relay] 종료: ${peer} (총 ${wss.clients.size})`));
});

// 유휴 연결 정리 + 사파리 절전 대응 keepalive
setInterval(() => {
  for (const c of wss.clients) {
    if (c.isAlive === false) {
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, 20_000);

console.log(`[ldp-relay] ws://0.0.0.0:${PORT} — 갤러리 ${gallery.size}획 로드 (Ctrl+C로 종료)`);
