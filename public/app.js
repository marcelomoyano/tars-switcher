// TARS-Switcher panel. Renders entirely from state OBS pushes over the transport.
// Click -> command to bridge -> OBS changes -> event echoes back -> UI updates.
// No optimistic updates: every operator stays truthful to OBS.
import { createWhepPlayer } from './whep.js';
import { createPanelTransport } from './transport.js';

const state = {
  scenes: [],
  currentProgramSceneName: null,
  currentPreviewSceneName: null,
  studioMode: false,
  sceneItems: {},
  audio: [],
  streaming: false,
  timecode: '00:00:00',
  operators: 0,
  obsConnected: false,
  sceneCollection: null,
  show: {
    title: 'TARS-SWITCHER',
    scenes: [],
    hidePrefix: '_',
    audioInputs: [],
    whep: { preview: '', program: '' },
  },
};

// ── transport ────────────────────────────────────────────────────────────────
// Local WS by default; Ably when window.TARS_CONFIG.mode === 'ably'. Both speak
// the same {type,payload} / {cmd,...} messages, so nothing below this line cares.
let dragging = null; // inputName currently being dragged, so echoes don't fight the thumb

const transport = createPanelTransport({
  onOpen: () => {
    setConn('ok', 'linked');
    // On (re)connect always re-pull truth so we never render stale state.
    send({ cmd: 'requestSnapshot' });
  },
  onClose: () => setConn('bad', 'disconnected — reconnecting…'),
  onMessage: handle,
});

function send(msg) {
  transport.send(msg);
}

// ── inbound message handling ─────────────────────────────────────────────────
function handle(msg) {
  switch (msg.type) {
    case 'snapshot':
      applySnapshot(msg);
      break;
    case 'CurrentProgramSceneChanged':
      state.currentProgramSceneName = msg.payload.sceneName;
      break;
    case 'CurrentPreviewSceneChanged':
      state.currentPreviewSceneName = msg.payload.sceneName;
      break;
    case 'StudioModeStateChanged':
      state.studioMode = msg.payload.studioModeEnabled;
      // Toggling studio mode changes preview availability — refetch truth.
      send({ cmd: 'requestSnapshot' });
      break;
    case 'SceneItemEnableStateChanged': {
      const items = state.sceneItems[msg.payload.sceneName];
      const it = items?.find((i) => i.sceneItemId === msg.payload.sceneItemId);
      if (it) it.enabled = msg.payload.sceneItemEnabled;
      break;
    }
    case 'InputMuteStateChanged': {
      const a = state.audio.find((x) => x.inputName === msg.payload.inputName);
      if (a) a.muted = msg.payload.inputMuted;
      break;
    }
    case 'InputVolumeChanged': {
      const a = state.audio.find((x) => x.inputName === msg.payload.inputName);
      if (a && dragging !== msg.payload.inputName) a.volumeDb = round(msg.payload.inputVolumeDb);
      break;
    }
    case 'StreamStateChanged':
      state.streaming = msg.payload.outputActive;
      break;
    case 'heartbeat':
      state.obsConnected = msg.payload.obsConnected;
      state.operators = msg.payload.operators;
      state.streaming = msg.payload.streaming;
      if (!state.streaming) state.timecode = '00:00:00';
      else state.timecode = msg.payload.timecode || state.timecode;
      break;
    case 'presence':
      state.operators = msg.payload.operators;
      break;
    case 'bridge':
      state.obsConnected = msg.payload.obsConnected;
      // OBS came back (or transport reconnected) — pull fresh truth.
      if (msg.payload.obsConnected) send({ cmd: 'requestSnapshot' });
      break;
    case 'error':
      setConn('bad', `${msg.payload.cmd}: ${msg.payload.message}`);
      break;
  }
  render();
  reconcileFeeds(); // start/stop WHEP feeds when stream state or URLs change
}

function applySnapshot(msg) {
  const p = msg.payload;
  state.scenes = p.scenes || [];
  state.currentProgramSceneName = p.currentProgramSceneName;
  state.currentPreviewSceneName = p.currentPreviewSceneName ?? null;
  state.sceneCollection = p.sceneCollection ?? null;
  state.studioMode = p.studioMode || false;
  state.sceneItems = p.sceneItems || {};
  state.audio = p.audio || [];
  state.streaming = p.streaming || false;
  state.timecode = p.timecode || '00:00:00';
  state.obsConnected = p.obsConnected ?? true;
  if (msg.config) state.show = { ...state.show, ...msg.config };
}

// ── config-driven curation ───────────────────────────────────────────────────
// Empty whitelist = show everything live from OBS, in OBS order. A populated
// whitelist surfaces ONLY those entries, in the config's order (= button order),
// silently skipping any that aren't present in OBS. So onboarding a client is:
// name their scenes in OBS, then list the on-air ones here in the order you want.
function curate(whitelist, all, key = (x) => x) {
  if (!whitelist || whitelist.length === 0) return all;
  const byKey = new Map(all.map((x) => [key(x), x]));
  return whitelist.map((name) => byKey.get(name)).filter(Boolean);
}

// Scenes are hybrid: an explicit config.scenes list wins (ordered curation),
// otherwise show every scene from OBS except utility ones the client prefixed
// with hidePrefix (default "_"). So the client self-serves exposure from OBS.
function curateScenes() {
  if (state.show.scenes && state.show.scenes.length) return curate(state.show.scenes, state.scenes);
  const prefix = state.show.hidePrefix;
  return prefix ? state.scenes.filter((s) => !s.startsWith(prefix)) : state.scenes;
}

// ── render ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function render() {
  $('title').textContent = state.show.title || 'TARS-SWITCHER';

  // header live indicator
  const dot = $('live-dot');
  const label = $('live-label');
  dot.className = 'dot';
  if (state.streaming) {
    dot.classList.add('live');
    label.textContent = 'LIVE';
  } else if (state.obsConnected) {
    dot.classList.add('connected');
    label.textContent = 'STANDBY';
  } else {
    label.textContent = 'OFFLINE';
  }
  $('uptime').textContent = state.streaming ? state.timecode : '00:00:00';
  $('operators').textContent = state.operators;

  // feed labels reflect what's staged (preview) vs on-air (program)
  $('preview-scene').textContent = state.currentPreviewSceneName ? `· ${state.currentPreviewSceneName}` : '';
  $('program-scene').textContent = state.currentProgramSceneName ? `· ${state.currentProgramSceneName}` : '';

  renderScenes();
  renderSources();
  renderAudio();
  renderStream();
}

function renderScenes() {
  const el = $('scenes');
  const sceneTags = [state.sceneCollection, state.studioMode ? 'studio · stage → cut' : null].filter(Boolean);
  $('scenes-mode').textContent = sceneTags.length ? `· ${sceneTags.join(' · ')}` : '';
  const scenes = curateScenes();
  if (scenes.length === 0) {
    el.innerHTML = '<span class="empty">— no scenes —</span>';
  } else {
    el.replaceChildren(
      ...scenes.map((name) => {
        const b = document.createElement('button');
        let cls = 'scene';
        if (name === state.currentProgramSceneName) cls += ' active';
        if (state.studioMode && name === state.currentPreviewSceneName) cls += ' preview';
        b.className = cls;
        b.textContent = name;
        // In Studio Mode a click stages the scene into preview; CUT/TAKE commits.
        // Otherwise it cuts straight to program (last-write-wins at OBS).
        b.onclick = () =>
          send(state.studioMode ? { cmd: 'setPreviewScene', sceneName: name } : { cmd: 'setScene', sceneName: name });
        return b;
      })
    );
  }

  // transition controls only make sense in Studio Mode
  const trans = $('transition');
  trans.classList.toggle('hidden', !state.studioMode);
  if (state.studioMode) {
    $('cut-btn').onclick = () => send({ cmd: 'cut' });
    $('take-btn').onclick = () => send({ cmd: 'take' });
  }
}

function renderSources() {
  const el = $('sources');
  const scene = state.currentProgramSceneName;
  $('sources-scene').textContent = scene ? `· ${scene}` : '';
  const items = (scene && state.sceneItems[scene]) || [];
  if (items.length === 0) {
    el.innerHTML = '<span class="empty">— no sources —</span>';
    return;
  }
  el.replaceChildren(
    ...items.map((it) => {
      const b = document.createElement('button');
      b.className = 'source ' + (it.enabled ? 'on' : 'off');
      b.innerHTML = `<span class="box">${it.enabled ? '▣' : '▢'}</span>${esc(it.sourceName)}`;
      b.onclick = () =>
        send({ cmd: 'toggleItem', sceneName: scene, sceneItemId: it.sceneItemId, enabled: !it.enabled });
      return b;
    })
  );
}

const DB_MIN = -60;
const DB_MAX = 0;

function renderAudio() {
  const el = $('audio');
  const inputs = curate(state.show.audioInputs, state.audio, (a) => a.inputName);
  if (inputs.length === 0) {
    el.innerHTML = '<span class="empty">— no audio inputs —</span>';
    return;
  }
  el.replaceChildren(
    ...inputs.map((a) => {
      const row = document.createElement('div');
      row.className = 'aud';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.inputName;
      name.title = a.inputName;

      const mute = document.createElement('button');
      mute.className = 'mute' + (a.muted ? ' muted' : '');
      mute.textContent = a.muted ? 'MUTED' : 'mute';
      mute.onclick = () => send({ cmd: 'setMute', inputName: a.inputName, muted: !a.muted });

      const fader = document.createElement('input');
      fader.type = 'range';
      fader.min = DB_MIN;
      fader.max = DB_MAX;
      fader.step = 0.5;
      const db = clampDb(a.volumeDb);
      fader.value = db;
      fader.style.setProperty('--fill', `${((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100}%`);
      fader.oninput = () => {
        dragging = a.inputName;
        const v = Number(fader.value);
        a.volumeDb = v;
        fader.style.setProperty('--fill', `${((v - DB_MIN) / (DB_MAX - DB_MIN)) * 100}%`);
        dbLabel.textContent = fmtDb(v);
        sendVolume(a.inputName, v);
      };
      fader.onchange = () => {
        dragging = null;
      };

      const dbLabel = document.createElement('span');
      dbLabel.className = 'db';
      dbLabel.textContent = fmtDb(db);

      row.append(name, mute, fader, dbLabel);
      return row;
    })
  );
}

function renderStream() {
  const btn = $('stream-btn');
  if (!state.obsConnected) {
    btn.className = 'stream-btn';
    btn.textContent = '— —';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  if (state.streaming) {
    btn.className = 'stream-btn stop';
    btn.textContent = '■ STOP';
    btn.onclick = () => send({ cmd: 'stopStream' });
  } else {
    btn.className = 'stream-btn go';
    btn.textContent = '▶ START';
    btn.onclick = () => send({ cmd: 'startStream' });
  }
}

// throttle fader spam to OBS (~20/s) while staying responsive
let volTimer = null;
let volPending = null;
function sendVolume(inputName, db) {
  volPending = { inputName, db };
  if (volTimer) return;
  volTimer = setTimeout(() => {
    volTimer = null;
    if (volPending) {
      send({ cmd: 'setVolumeDb', inputName: volPending.inputName, db: volPending.db });
      volPending = null;
    }
  }, 50);
}

// ── WHEP feeds (top-left preview, top-right program) ─────────────────────────
const videoPreview = $('whep-preview');
const videoProgram = $('whep-program');
const feeds = {
  preview: { label: 'PREVIEW', ph: $('preview-ph'), player: createWhepPlayer(videoPreview, $('preview-ph')) },
  program: { label: 'PROGRAM', ph: $('program-ph'), player: createWhepPlayer(videoProgram, $('program-ph')) },
};

// Audio monitoring — exclusive so two feeds never talk over each other.
// Videos stay muted by default (browsers require it for autoplay).
function setMonitor(which) {
  videoPreview.muted = which !== 'preview';
  videoProgram.muted = which !== 'program';
  $('mon-preview').classList.toggle('on', which === 'preview');
  $('mon-program').classList.toggle('on', which === 'program');
}
const toggleMonitor = (which) =>
  setMonitor((which === 'preview' ? !videoPreview.muted : !videoProgram.muted) ? null : which);
$('mon-preview').onclick = () => toggleMonitor('preview');
$('mon-program').onclick = () => toggleMonitor('program');

// Feed size — REGULAR (default) / LARGE. Persisted across reloads.
function setSize(size) {
  document.body.classList.toggle('large', size === 'large');
  $('size-btn').textContent = size === 'large' ? 'LARGE' : 'REGULAR';
  localStorage.setItem('tars-size', size);
}
$('size-btn').onclick = () =>
  setSize(document.body.classList.contains('large') ? 'regular' : 'large');
setSize(localStorage.getItem('tars-size') || 'regular');

// The WHEP feeds only exist while OBS is streaming — they go valid when the
// stream starts and stop when it stops. So the feeds follow stream state:
// reconcile only when streaming or the URLs actually change (no blips on
// unrelated snapshots), and retry the connect because the egress takes a beat
// to come up after StartStream.
let appliedSig = null;
const retryTimers = { preview: null, program: null };

function setPlaceholder(which, text) {
  feeds[which].ph.textContent = text;
  feeds[which].ph.classList.remove('hidden');
}

function applyFeed(which, url) {
  clearTimeout(retryTimers[which]);
  if (!url) {
    feeds[which].player.stop();
    setPlaceholder(which, `${feeds[which].label} · NOT CONFIGURED`);
    return;
  }
  if (!state.streaming) {
    feeds[which].player.stop();
    setPlaceholder(which, `${feeds[which].label} STOPPED`);
    return;
  }
  setPlaceholder(which, `${feeds[which].label} CONNECTING…`);
  playFeed(which, url, 0);
}

function playFeed(which, url, attempt) {
  feeds[which].player.play(url).catch(() => {
    if (!state.streaming) return; // stream stopped while we were connecting
    if (attempt < 12) {
      retryTimers[which] = setTimeout(() => playFeed(which, url, attempt + 1), 1500);
    } else {
      setPlaceholder(which, `${feeds[which].label} · NO SIGNAL`);
    }
  });
}

function reconcileFeeds() {
  const w = state.show.whep || {};
  const sig = `${state.streaming}|${w.preview || ''}|${w.program || ''}`;
  if (sig === appliedSig) return;
  appliedSig = sig;
  applyFeed('preview', w.preview);
  applyFeed('program', w.program);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function setConn(cls, text) {
  const el = $('conn');
  el.className = 'conn ' + cls;
  el.textContent = text;
}
const round = (n) => Math.round(n * 10) / 10;
const clampDb = (db) => Math.max(DB_MIN, Math.min(DB_MAX, db ?? 0));
const fmtDb = (db) => (db <= DB_MIN ? '-∞' : `${db.toFixed(1)}`);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

transport.connect();
render();
