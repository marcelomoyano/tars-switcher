// TARS-Switcher bridge — runs on the OBS box.
//
//   OBS  ──obs-websocket──►  bridge  ──transport──►  panel(s)
//
// Flow: panel command -> bridge -> OBS request -> OBS emits state event ->
// bridge mirrors it to every panel. OBS arbitrates; panels reflect.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOBS } from './obs.js';
import { createTransport } from './transport.js';
import { createAblyTransport } from './transport-ably.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(await readFile(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
// Password may also come from the environment so it never has to live in the repo.
const obsPassword = process.env.OBS_PASSWORD || config.obs.password || '';

let transport; // set once the local relay is listening

const obs = createOBS({
  url: config.obs.url,
  password: obsPassword,
  onEvent: async (type, payload) => {
    transport?.broadcast({ type, payload });
    // A collection switch swaps every scene — push a fresh snapshot to all panels.
    if (type === 'CurrentSceneCollectionChanged') await broadcastSnapshot();
  },
  onConnectionChange: async (connected) => {
    transport?.broadcast({ type: 'bridge', payload: { obsConnected: connected } });
    if (connected) {
      console.log('[obs] connected');
      if (config.show.sceneCollection) await obs.setSceneCollection(config.show.sceneCollection);
      if (config.show.studioMode) await obs.setStudioMode(true);
    } else {
      console.log('[obs] disconnected — retrying');
    }
  },
});

// Transport-agnostic handlers — identical whether the control plane is the
// local WS relay or Ably. `send` replies to the requester (local: just that
// socket; ably: the channel).
async function onCommand(msg, send) {
  if (msg.cmd === 'requestSnapshot') {
    send({ type: 'snapshot', payload: await safeSnapshot(), config: config.show });
    return;
  }
  try {
    await obs.dispatch(msg);
  } catch (err) {
    send({ type: 'error', payload: { cmd: msg.cmd, message: String(err.message || err) } });
  }
}
// A panel just connected — hand it full state immediately. (Local only; Ably
// panels self-request a snapshot on open via the requestSnapshot command.)
async function onConnect(send) {
  send({ type: 'snapshot', payload: await safeSnapshot(), config: config.show });
}
function onPresence(operators) {
  transport?.broadcast({ type: 'presence', payload: { operators } });
}

const mode = config.transport?.mode || 'local';
if (mode === 'ably') {
  const apiKey = process.env.ABLY_API_KEY || config.transport.ably?.apiKey || '';
  transport = await createAblyTransport({
    apiKey,
    clientId: config.transport.clientId,
    onCommand,
    onPresence,
  });
} else {
  transport = await createTransport({ port: config.server.port, onCommand, onConnect, onPresence });
}

async function broadcastSnapshot() {
  transport?.broadcast({ type: 'snapshot', payload: await safeSnapshot(), config: config.show });
}

async function safeSnapshot() {
  if (!obs.isConnected()) return { scenes: [], currentProgramSceneName: null, sceneItems: {}, audio: [], streaming: false, timecode: '00:00:00', obsConnected: false };
  try {
    return { ...(await obs.snapshot()), obsConnected: true };
  } catch (err) {
    console.error('[snapshot] failed:', err.message);
    return { scenes: [], currentProgramSceneName: null, sceneItems: {}, audio: [], streaming: false, timecode: '00:00:00', obsConnected: false };
  }
}

// Heartbeat: live/dead indicator + stream uptime, pushed every 2s.
setInterval(async () => {
  if (!transport) return;
  const obsConnected = obs.isConnected();
  const status = obsConnected ? await obs.streamStatus() : { streaming: false, timecode: '00:00:00' };
  transport.broadcast({
    type: 'heartbeat',
    payload: { obsConnected, operators: transport.operatorCount(), ...status },
  });
}, 2000);

// Keep trying OBS until it's up, then let obs-websocket-js surface drops.
async function ensureOBS() {
  if (!obs.isConnected()) await obs.connect();
}
await ensureOBS();
setInterval(ensureOBS, 3000);

if (mode === 'ably') console.log(`[bridge] ably transport · channel switcher:${config.transport.clientId}`);
else console.log(`[bridge] panel at http://localhost:${config.server.port}`);
