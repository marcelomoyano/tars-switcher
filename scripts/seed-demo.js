// Throwaway demo content so you can SEE the switcher work before wiring real
// cams/scenes. Creates a few scenes, some toggleable sources, and one audio
// input. Safe + headless (no camera/mic permission needed). Remove with
// `node scripts/seed-demo.js --clean`.
import OBSWebSocket from 'obs-websocket-js';

const obs = new OBSWebSocket();
await obs.connect(process.env.OBS_URL || 'ws://localhost:4455', process.env.OBS_PASSWORD || undefined);

const SCENES = ['INTRO', 'TWO-SHOT', 'SCREEN', 'SOLO'];
const clean = process.argv.includes('--clean');

async function call(req, params) {
  try {
    return await obs.call(req, params);
  } catch (e) {
    return null;
  }
}

const { scenes: existing } = await obs.call('GetSceneList');
const have = new Set(existing.map((s) => s.sceneName));

if (clean) {
  for (const s of SCENES) if (have.has(s)) await call('RemoveScene', { sceneName: s });
  await call('RemoveInput', { inputName: 'Desktop Audio' });
  await call('RemoveInput', { inputName: 'Host A cam' });
  await call('RemoveInput', { inputName: 'Host B cam' });
  await call('RemoveInput', { inputName: 'Screen' });
  console.log('demo content removed');
  await obs.disconnect();
  process.exit(0);
}

const color = (name, sceneName, rgb) =>
  call('CreateInput', {
    sceneName,
    inputName: name,
    inputKind: 'color_source_v3',
    inputSettings: { color: rgb, width: 1920, height: 1080 },
  });

const text = (name, sceneName, str) =>
  call('CreateInput', {
    sceneName,
    inputName: name,
    inputKind: 'text_ft2_source_v2',
    inputSettings: { text: str, font: { face: 'Menlo', size: 96 } },
  });

for (const s of SCENES) {
  if (!have.has(s)) await call('CreateScene', { sceneName: s });
}

// Shared toggleable sources (created once, added to scenes as scene items).
// 0xAABBGGRR color ints.
await color('BG-blue', 'INTRO', 0xff1a0d00);
await text('Title', 'INTRO', 'CAPITAL FLOWS');

await color('BG-grey', 'TWO-SHOT', 0xff202020);
await text('Host A cam', 'TWO-SHOT', '[ HOST A ]');
await text('Host B cam', 'TWO-SHOT', '[ HOST B ]');

await color('BG-dark', 'SCREEN', 0xff0a0a0a);
await text('Screen', 'SCREEN', '[ SCREEN SHARE ]');

await color('BG-solo', 'SOLO', 0xff151515);
await text('Solo cam', 'SOLO', '[ SOLO ]');

// One global audio input so the AUDIO row has something to drive.
await call('CreateInput', {
  sceneName: 'INTRO',
  inputName: 'Desktop Audio',
  inputKind: 'coreaudio_output_capture',
  inputSettings: {},
});

await obs.call('SetCurrentProgramScene', { sceneName: 'INTRO' });
console.log('demo content seeded: scenes', SCENES.join(', '));
await obs.disconnect();
