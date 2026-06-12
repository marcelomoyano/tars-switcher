// Stand-in operator: connects to the same Ably channel as a panel would (here
// with key-auth instead of a Worker token), and exercises the bridge↔Ably path:
// presence, snapshot request, a command, and the echoed state event.
//
//   ABLY_API_KEY=… node scripts/ably-smoke.js
import Ably from 'ably';

const key = process.env.ABLY_API_KEY;
if (!key) throw new Error('set ABLY_API_KEY');
const clientId = 'capital-flows';

const realtime = new Ably.Realtime({ key, clientId: 'op-smoke', echoMessages: false });
const channel = realtime.channels.get(`switcher:${clientId}`);

const seen = [];
let snapshot = null;

channel.subscribe('m', (m) => {
  const msg = m.data;
  if (msg.type === 'snapshot' && !snapshot) snapshot = msg.payload;
  else seen.push(msg);
});

await new Promise((res, rej) => {
  realtime.connection.once('connected', res);
  realtime.connection.once('failed', rej);
});
await channel.attach();
await channel.presence.enter();

// 1) request a snapshot
await channel.publish('cmd', { cmd: 'requestSnapshot' });
await waitFor(() => snapshot, 5000, 'snapshot');
console.log('✓ snapshot received · scenes:', snapshot.scenes.join(', '));
console.log('  studioMode:', snapshot.studioMode, '· program:', snapshot.currentProgramSceneName, '· preview:', snapshot.currentPreviewSceneName);

// 2) fire a command, expect the OBS echo back over Ably
const target = snapshot.scenes.find((s) => s !== snapshot.currentPreviewSceneName) || snapshot.scenes[0];
await channel.publish('cmd', { cmd: 'setPreviewScene', sceneName: target });
await waitFor(() => seen.find((m) => m.type === 'CurrentPreviewSceneChanged' && m.payload.sceneName === target), 5000, 'preview echo');
console.log(`✓ command round-trip: staged "${target}" → echoed back`);

// 3) presence count flowing
const presence = seen.filter((m) => m.type === 'presence').pop();
console.log('✓ presence broadcast · operators online:', presence ? presence.payload.operators : '(none yet)');

// 4) heartbeat / live indicator
await waitFor(() => seen.find((m) => m.type === 'heartbeat'), 3000, 'heartbeat');
const hb = seen.filter((m) => m.type === 'heartbeat').pop();
console.log('✓ heartbeat · obsConnected:', hb.payload.obsConnected, '· streaming:', hb.payload.streaming);

console.log('\nALL GOOD — bridge↔Ably transport verified.');
await channel.presence.leave();
realtime.close();
process.exit(0);

function waitFor(cond, ms, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 100);
  });
}
