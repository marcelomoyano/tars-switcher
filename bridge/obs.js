// OBS side of the bridge: connect, build snapshots, forward events, dispatch commands.
// OBS itself is the single source of truth — we never hold a parallel state store.
import OBSWebSocket from 'obs-websocket-js';

// Events we mirror straight through to the panels. OBS emits one of these after
// every state change; the panel waits for the echo instead of optimistically
// updating, so every operator stays truthful to OBS.
const MIRRORED_EVENTS = [
  'CurrentProgramSceneChanged',
  'CurrentPreviewSceneChanged',
  'StudioModeStateChanged',
  'SceneItemEnableStateChanged',
  'InputMuteStateChanged',
  'InputVolumeChanged',
  'StreamStateChanged',
  // Switching scene collection swaps the whole scene list — the bridge reacts
  // to this by rebuilding + rebroadcasting a snapshot (see server.js).
  'CurrentSceneCollectionChanged',
];

export function createOBS({ url, password, onEvent, onConnectionChange }) {
  const obs = new OBSWebSocket();
  let connected = false;

  const setConnected = (v) => {
    if (v === connected) return;
    connected = v;
    onConnectionChange?.(v);
  };

  for (const name of MIRRORED_EVENTS) {
    obs.on(name, (data) => onEvent(name, data));
  }

  obs.on('ConnectionClosed', () => setConnected(false));
  obs.on('ConnectionError', () => setConnected(false));

  async function connect() {
    try {
      await obs.connect(url, password || undefined);
      setConnected(true);
      return true;
    } catch (err) {
      setConnected(false);
      return false;
    }
  }

  // Studio Mode = preview/program. Scenes stage into preview; a cut/take commits.
  async function setStudioMode(enabled) {
    try {
      const { studioModeEnabled } = await obs.call('GetStudioModeEnabled');
      if (studioModeEnabled !== enabled) await obs.call('SetStudioModeEnabled', { studioModeEnabled: enabled });
    } catch {
      /* ignore */
    }
  }

  // Pin the show's scene collection so the panel always reflects the right set
  // of scenes, even if OBS opened on a different collection.
  async function setSceneCollection(name) {
    if (!name) return;
    try {
      const { currentSceneCollectionName } = await obs.call('GetSceneCollectionList');
      if (currentSceneCollectionName !== name) {
        await obs.call('SetCurrentSceneCollection', { sceneCollectionName: name });
      }
    } catch (err) {
      console.error('[obs] could not select scene collection:', err.message);
    }
  }

  // Pull full state so a freshly-opened panel gets everything at once.
  async function snapshot() {
    const { scenes, currentProgramSceneName } = await obs.call('GetSceneList');
    // GetSceneList returns scenes bottom-to-top relative to the OBS UI; reverse
    // so the panel lists them in the same order the operator sees in OBS.
    const orderedScenes = [...scenes].reverse().map((s) => s.sceneName);

    const sceneItems = {};
    for (const name of orderedScenes) {
      const { sceneItems: items } = await obs.call('GetSceneItemList', { sceneName: name });
      sceneItems[name] = items.map((it) => ({
        sceneItemId: it.sceneItemId,
        sourceName: it.sourceName,
        enabled: it.sceneItemEnabled,
      }));
    }

    // Audio inputs: probe every input; the ones that answer GetInputMute have audio.
    const { inputs } = await obs.call('GetInputList');
    const audio = [];
    for (const inp of inputs) {
      try {
        const { inputMuted } = await obs.call('GetInputMute', { inputName: inp.inputName });
        const { inputVolumeDb } = await obs.call('GetInputVolume', { inputName: inp.inputName });
        audio.push({ inputName: inp.inputName, muted: inputMuted, volumeDb: round(inputVolumeDb) });
      } catch {
        /* input has no audio track — skip */
      }
    }

    let streaming = false;
    let timecode = '00:00:00';
    try {
      const st = await obs.call('GetStreamStatus');
      streaming = st.outputActive;
      timecode = st.outputTimecode?.slice(0, 8) ?? timecode;
    } catch {
      /* ignore */
    }

    let studioMode = false;
    let currentPreviewSceneName = null;
    try {
      studioMode = (await obs.call('GetStudioModeEnabled')).studioModeEnabled;
      if (studioMode) currentPreviewSceneName = (await obs.call('GetCurrentPreviewScene')).sceneName;
    } catch {
      /* ignore */
    }

    let sceneCollection = null;
    try {
      sceneCollection = (await obs.call('GetSceneCollectionList')).currentSceneCollectionName;
    } catch {
      /* ignore */
    }

    return {
      scenes: orderedScenes,
      currentProgramSceneName,
      currentPreviewSceneName,
      sceneCollection,
      studioMode,
      sceneItems,
      audio,
      streaming,
      timecode,
    };
  }

  async function streamStatus() {
    try {
      const st = await obs.call('GetStreamStatus');
      return { streaming: st.outputActive, timecode: st.outputTimecode?.slice(0, 8) ?? '00:00:00' };
    } catch {
      return { streaming: false, timecode: '00:00:00' };
    }
  }

  // Translate a panel command into an obs-websocket request. The resulting OBS
  // event echoes back out through onEvent and updates every panel.
  async function dispatch(msg) {
    switch (msg.cmd) {
      case 'setScene':
        return obs.call('SetCurrentProgramScene', { sceneName: msg.sceneName });
      case 'setPreviewScene':
        return obs.call('SetCurrentPreviewScene', { sceneName: msg.sceneName });
      case 'cut': {
        // Instant cut: in Studio Mode, setting program to the staged preview
        // scene swaps it on-air with no transition.
        const { sceneName } = await obs.call('GetCurrentPreviewScene');
        return obs.call('SetCurrentProgramScene', { sceneName });
      }
      case 'take':
        // The configured transition (Fade etc.) from preview to program.
        return obs.call('TriggerStudioModeTransition');
      case 'toggleItem':
        return obs.call('SetSceneItemEnabled', {
          sceneName: msg.sceneName,
          sceneItemId: msg.sceneItemId,
          sceneItemEnabled: msg.enabled,
        });
      case 'setMute':
        return obs.call('SetInputMute', { inputName: msg.inputName, inputMuted: msg.muted });
      case 'setVolumeDb':
        return obs.call('SetInputVolume', { inputName: msg.inputName, inputVolumeDb: msg.db });
      case 'startStream':
        return obs.call('StartStream');
      case 'stopStream':
        return obs.call('StopStream');
      default:
        throw new Error(`unknown command: ${msg.cmd}`);
    }
  }

  return {
    connect,
    setStudioMode,
    setSceneCollection,
    snapshot,
    streamStatus,
    dispatch,
    isConnected: () => connected,
  };
}

const round = (n) => Math.round(n * 10) / 10;
