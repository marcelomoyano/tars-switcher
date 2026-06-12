// Local transport: WebSocket to the bridge that served this page.
export function createLocalTransport({ onOpen, onClose, onMessage }) {
  let ws = null;

  function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => onOpen?.();
    ws.onclose = () => {
      onClose?.();
      setTimeout(connect, 1000); // auto-reconnect
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => onMessage?.(JSON.parse(e.data));
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  return { connect, send };
}
