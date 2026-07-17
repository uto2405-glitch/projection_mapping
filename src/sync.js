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
  const downHandlers = new Set();

  const sid =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let seq = 0;
  const lastSeen = new Map(); // 발신자 sid → 마지막 순번

  /** 단절 중 쌓인 undo·clear 재송출. 큐를 비우지 않는다 — 상대가 아직 미접속이면
   *  릴레이가 버리므로, 이후 sync-req 때마다 다시 흘린다. 중복 수신은 순번 dedup이
   *  걸러내고, undo/clear는 미수신자에게도 멱등이다. 15분 지나면 폐기. */
  function flushCritical() {
    if (!ws || ws.readyState !== 1) return;
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (let i = pendingCritical.length - 1; i >= 0; i--)
      if (pendingCritical[i].qt < cutoff) pendingCritical.splice(i, 1);
    for (const item of pendingCritical) {
      try {
        // 순번 재스탬프 — 원래 _n으로 보내면 그 사이 라이브 순번을 본 수신자가
        // '이미 수신'으로 오판해 영구 폐기한다 (감사 4차 #4). undo는 멱등이라 안전.
        ws.send(JSON.stringify({ ...item.env, _n: ++seq }));
      } catch {
        break; // 전송 실패 — 다음 기회에
      }
    }
  }

  function dispatch(env) {
    if (!env || typeof env !== "object") return;
    if (env._sid) {
      if (env._sid === sid) return; // 자기 발행 (릴레이 에코 방지)
      const last = lastSeen.get(env._sid) || 0;
      if (env._n <= last) return; // 다른 전송로로 이미 수신
      lastSeen.set(env._sid, env._n);
    }
    // sync-req = 상대가 방금 (재)접속해 상태를 묻는 순간 — 밀린 제거 메시지를
    // 새 응답(announce)보다 먼저 흘려보낸다. 내 소켓 open 시점 플러시만으로는
    // 상대가 아직 미접속이라 릴레이가 버릴 수 있다.
    if (env.t === "sync-req") flushCritical();
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
  /** ws 단절 중 발생한 상태-파괴 메시지(undo·clear) 보관 — 재접속 시 최우선 플러시.
   *  추가(획)는 리플레이가 복구하지만 제거는 비대칭이라 유실되면 프로젝터에 잔존한다 (감사 2차 #4). */
  const pendingCritical = [];

  function connectWs() {
    if (closed) return;
    try {
      ws = new WebSocket(`ws://${host}:${RELAY_PORT}`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      flushCritical(); // 상대가 이미 접속해 있는 경우를 위한 1차 시도
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
      for (const h of downHandlers) {
        try {
          h("ws");
        } catch {
          /* noop */
        }
      }
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
      } else if (!isLocal && msg.t === "undo") {
        // undo만 큐잉 — 특정 획 대상이라 늦게 도착해도 멱등·무해.
        // clear는 재송신하지 않는다: 스테일 clear가 이후 작품을 소급 전소하는 경로가
        // 이득보다 위험하고, 단절 중 clear 유실은 화면에 보여 운영자가 재클릭으로 복구한다.
        pendingCritical.push({ env, qt: Date.now() });
        if (pendingCritical.length > 200) pendingCritical.shift();
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
    /** 전송로 단절 훅 (ws close) — 상태 배지용 */
    onDown(handler) {
      downHandlers.add(handler);
      return () => downHandlers.delete(handler);
    },
    /** 책상 모드(localhost) 여부 — ws를 아예 쓰지 않는 환경 */
    isLocal,
    /** ws 송신 버퍼 적체량 (백프레셔 판단용) — BC 전용 모드는 0 */
    bufferedAmount: () => (ws && ws.readyState === 1 ? ws.bufferedAmount : 0),
    close() {
      closed = true;
      bc.close();
      if (ws) ws.close();
    },
  };
}
