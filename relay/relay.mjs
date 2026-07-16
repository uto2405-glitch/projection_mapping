// ws 릴레이 (사이클 #3) — 두 기기 동기화. 채점 계약: npm run relay → ws://<host>:8787
// 폐쇄 LAN 전용(C1). 수신 메시지를 발신자 제외 전원에게 중계한다.
// 획은 증발하지만 훗날 관객 상태는 여기서 영속화한다 (VISION 테제 5의 자리).

import { WebSocketServer } from "ws";

const PORT = 8787;
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

wss.on("connection", (ws, req) => {
  const peer = req.socket.remoteAddress;
  console.log(`[ldp-relay] 접속: ${peer} (총 ${wss.clients.size})`);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (data, isBinary) => {
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

console.log(`[ldp-relay] ws://0.0.0.0:${PORT} — 대기 중 (Ctrl+C로 종료)`);
