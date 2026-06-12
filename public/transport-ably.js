// Ably transport: connects with a scoped token from the Worker (never the API
// key), subscribes to bridge state on channel `switcher:{clientId}`, and enters
// presence so the bridge can count operators online.
//
//   'm'   — bridge → us   : state messages  → onMessage
//   'cmd' — us → bridge    : commands        ← send()
//
// cfg (from window.TARS_CONFIG):
//   { mode:'ably', clientId:'capital-flows', ablyTokenUrl:'https://…/token' }
let AblyLib = null;
async function loadAbly() {
  if (AblyLib || window.Ably) return (AblyLib = window.Ably || AblyLib);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.ably.com/lib/ably.min-2.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return (AblyLib = window.Ably);
}

export function createAblyTransport(cfg, { onOpen, onClose, onMessage }) {
  let realtime = null;
  let channel = null;

  async function connect() {
    const Ably = await loadAbly();
    // The Worker mints a token scoped to switcher:{clientId}. authParams pass the
    // show id (and a per-tab operator id for presence identity).
    realtime = new Ably.Realtime({
      authUrl: cfg.ablyTokenUrl,
      authParams: { show: cfg.clientId, op: operatorId() },
    });
    realtime.connection.on('connected', () => onOpen?.());
    realtime.connection.on('disconnected', () => onClose?.());
    realtime.connection.on('suspended', () => onClose?.());

    channel = realtime.channels.get(`switcher:${cfg.clientId}`);
    channel.subscribe('m', (m) => onMessage?.(m.data));
    await channel.attach();
    await channel.presence.enter();
  }

  function send(msg) {
    channel?.publish('cmd', msg);
  }

  return { connect, send };
}

// Stable-per-tab operator id (so presence counts tabs, not reconnects).
function operatorId() {
  let id = sessionStorage.getItem('tars-op');
  if (!id) {
    id = 'op-' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('tars-op', id);
  }
  return id;
}
