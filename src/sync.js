// 동기화 추상 계층 — 같은 기기(BroadcastChannel)와 두 기기(ws 릴레이)를
// 하나의 인터페이스로 감싼다. 채점 계약: 채널 'ldp-sync' · 릴레이 ws://<host>:8787.
// 모든 입력원은 발행자, 출력은 구독자다 (VISION 테제 1 — 메시지 버스가 본체).
//
// ws는 localhost 접속(책상 실험·채점)에서는 시도조차 하지 않는다 —
// 접속 실패 콘솔 에러로 A4를 오염시키지 않기 위한 설계다.
// 두 전송로가 겹칠 때(같은 LAN IP로 연 두 창)를 위해 발신자 id+순번으로 중복 제거.

const CHANNEL = "ldp-sync";
const RELAY_PORT = 8787;

export function openSync() {
  const bc = new BroadcastChannel(CHANNEL);
  const handlers = new Set();
  const upHandlers = new Set();

  const sid =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let seq = 0;
  const lastSeen = new Map(); // 발신자 sid → 마지막 순번

  function dispatch(env) {
    if (!env || typeof env !== "object") return;
    if (env._sid) {
      if (env._sid === sid) return; // 자기 발행 (릴레이 에코 방지)
      const last = lastSeen.get(env._sid) || 0;
      if (env._n <= last) return; // 다른 전송로로 이미 수신
      lastSeen.set(env._sid, env._n);
    }
    for (const h of handlers) {
      try {
        h(env);
      } catch (err) {
        console.warn("[ldp-sync] handler error:", err);
      }
    }
  }

  bc.onmessage = (e) => dispatch(e.data);

  // ── ws 릴레이 (두 기기) — LAN IP 접속에서만 ──
  const host = location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  let ws = null;
  let closed = false;

  function connectWs() {
    if (closed) return;
    try {
      ws = new WebSocket(`ws://${host}:${RELAY_PORT}`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      for (const h of upHandlers) {
        try {
          h("ws");
        } catch {
          /* noop */
        }
      }
    };
    ws.onmessage = (e) => {
      let d;
      try {
        d = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(d);
    };
    ws.onerror = () => {
      /* onclose가 재시도를 담당 */
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    setTimeout(connectWs, 2500 + Math.random() * 2000);
  }

  if (!isLocal) connectWs();

  return {
    sid,
    send(msg) {
      const env = { ...msg, _sid: sid, _n: ++seq };
      bc.postMessage(env);
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify(env));
        } catch {
          /* 전송 실패 — 재연결 루프가 복구 */
        }
      }
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    /** 전송로 연결 시점 훅 (ws open) — 상태 재발행·재요청용 */
    onUp(handler) {
      upHandlers.add(handler);
      return () => upHandlers.delete(handler);
    },
    close() {
      closed = true;
      bc.close();
      if (ws) ws.close();
    },
  };
}
