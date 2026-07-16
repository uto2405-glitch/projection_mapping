// 동기화 추상 계층 — 같은 기기(BroadcastChannel)와 두 기기(ws 릴레이, 사이클 #3)를
// 하나의 인터페이스로 감싼다. 채점 계약: 채널 이름 'ldp-sync'.
// 모든 입력원은 발행자, 출력은 구독자다 (VISION 테제 1 — 메시지 버스가 본체).

const CHANNEL = "ldp-sync";

export function openSync() {
  const bc = new BroadcastChannel(CHANNEL);
  const handlers = new Set();

  bc.onmessage = (e) => {
    for (const h of handlers) {
      try {
        h(e.data);
      } catch (err) {
        // 구독자 하나의 실수가 버스를 죽이지 않게 — 단, 조용히 삼키지 않고 경고
        console.warn("[ldp-sync] handler error:", err);
      }
    }
  };

  return {
    send(msg) {
      bc.postMessage(msg);
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      bc.close();
    },
  };
}
