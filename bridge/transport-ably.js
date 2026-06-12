// Ably control plane — the cloud counterpart to transport.js.
//
// Same surface the local relay exposes (broadcast / onCommand / presence), so
// server.js doesn't care which one it's using. The bridge only ever talks
// OUTBOUND to Ably (no inbound ports), which is what lets the OBS box sit
// behind NAT in the cloud.
//
// Wire format on the channel `switcher:{clientId}`:
//   'm'   — bridge → panels : every {type, payload} state message (broadcast)
//   'cmd' — panels → bridge : a {cmd, ...} command
// Presence members are the operator panels; their count is "operators online".
//
// The API key is server-side only (bridge + Worker). Browsers never see it —
// they connect with a scoped token minted by the Worker. See worker/.
import Ably from 'ably';

export async function createAblyTransport({ apiKey, clientId, onCommand, onPresence }) {
  if (!apiKey) throw new Error('[ably] ABLY_API_KEY missing — set it in the env before using ably transport');
  if (!clientId) throw new Error('[ably] config.transport.clientId missing');

  const realtime = new Ably.Realtime({ key: apiKey, clientId: 'bridge', echoMessages: false });
  const channel = realtime.channels.get(`switcher:${clientId}`);

  let operators = 0;
  const broadcast = (msg) => channel.publish('m', msg);

  async function refreshPresence() {
    try {
      const members = await channel.presence.get();
      // Only panels enter presence; the bridge does not. So count == operators.
      operators = members.length;
      onPresence?.(operators);
    } catch {
      /* ignore */
    }
  }

  await new Promise((resolve, reject) => {
    realtime.connection.once('connected', resolve);
    realtime.connection.once('failed', reject);
  });
  await channel.attach();
  channel.subscribe('cmd', (m) => onCommand?.(m.data, broadcast));
  channel.presence.subscribe(['enter', 'leave', 'update'], refreshPresence);
  await refreshPresence();

  return { broadcast, operatorCount: () => operators };
}
