// Panel-side transport. Picks local WS or Ably from window.TARS_CONFIG
// (set in runtime-config.js). Both call the same handlers:
//   onOpen()         — (re)connected; the panel re-requests a snapshot
//   onClose()        — dropped; will auto-reconnect
//   onMessage(msg)   — a {type, payload} state message from the bridge
// and expose send(msg) for {cmd, ...} commands.
import { createLocalTransport } from './transport-local.js';
import { createAblyTransport } from './transport-ably.js';

export function createPanelTransport(handlers) {
  const cfg = window.TARS_CONFIG || { mode: 'local' };
  return cfg.mode === 'ably' ? createAblyTransport(cfg, handlers) : createLocalTransport(handlers);
}
