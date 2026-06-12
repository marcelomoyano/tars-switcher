# TARS-Switcher — Implementation Spec

**One line:** Strip OBS down to a show. Two operators, browser, concurrent control. Same pattern as TARS-Atem, but easier — OBS hands us a documented control surface instead of a reverse-engineered wire protocol.

**First client:** Capital Flows. Cloud OBS, 2 hosts both controlling what's on screen, our session ISO links as sources when needed. Ready tomorrow.

---

## Architecture

```
  OBS (Linux/Win + NVENC)
        │  obs-websocket v5  (JSON over WS, ws://localhost:4455)
        ▼
  TARS-Switcher bridge  ──────►  Ably channel  ◄──────  Browser panel(s)
   (Node, on the box)            (control plane)         (2+ operators)
        │
        └─ subscribes to OBS events, republishes state to Ably
```

**State authority:** OBS itself is the single source of truth. obs-websocket broadcasts every state change (scene switched, source toggled, mute changed) as an event. The bridge subscribes to those events and republishes them to Ably. Both panels render from that one stream. No separate state store, nothing to reconcile — OBS arbitrates, panels reflect. This is what kills the cursor-fight problem Parsec has: two operators, one authoritative state, last-write-wins at OBS.

**Why this is less work than TARS-Atem:** ATEM needed the reverse-engineered UDP 9990 protocol. OBS ships obs-websocket v5 — documented JSON-RPC. Scene switch, source visibility, audio mute/gain, transitions, stream start/stop are all first-class requests. No protocol archaeology.

---

## obs-websocket v5 — the calls we need

Connect: `ws://localhost:4455`, password auth (SHA256 challenge handshake — the lib handles it).

**Requests (panel → OBS):**
| Action | Request | Params |
|---|---|---|
| Cut to scene | `SetCurrentProgramScene` | `sceneName` |
| List scenes | `GetSceneList` | — |
| Toggle a source on/off | `SetSceneItemEnabled` | `sceneName`, `sceneItemId`, `sceneItemEnabled` |
| Get scene items | `GetSceneItemList` | `sceneName` |
| Mute/unmute | `SetInputMute` | `inputName`, `inputMuted` |
| Set gain (fader) | `SetInputVolume` | `inputName`, `inputVolumeDb` |
| Transition | `TriggerStudioModeTransition` / `SetCurrentSceneTransition` | — |
| Start/stop stream | `StartStream` / `StopStream` | — |
| Get stream status | `GetStreamStatus` | — |

**Events (OBS → bridge → Ably → panels):**
`CurrentProgramSceneChanged`, `SceneItemEnableStateChanged`, `InputMuteStateChanged`, `InputVolumeChanged`, `StreamStateChanged`. Subscribe to all, republish each as-is. Panels stay in sync automatically.

Node lib: `obs-websocket-js` (v5). `npm i obs-websocket-js ably`.

---

## The bridge (runs on the OBS box)

Single Node process. ~150 lines.

1. Connect to OBS via obs-websocket-js. On connect, pull `GetSceneList` + per-scene `GetSceneItemList` + audio inputs → publish a `snapshot` to Ably so a newly-opened panel gets full state immediately.
2. Subscribe to OBS events → publish each to Ably channel `switcher:{clientId}` as `{type, payload}`.
3. Subscribe to Ably for inbound commands from panels → translate to obs-websocket requests → call OBS. OBS emits the resulting state event, which flows back out in step 2. (Panels don't optimistically update; they wait for the echo. Keeps all operators truthful to OBS.)
4. Heartbeat: publish OBS connection + stream status every 2s so panels show a live/dead indicator.

**Auth:** Ably token via a Worker (same control-plane pattern as TARS-Graphics — Worker signs, never expose the OBS password or Ably key to the browser). Panel gets a scoped token for its `switcher:{clientId}` channel only.

---

## The panel (browser, 2+ operators)

**Aesthetic:** TERMINAL — same as TARS-Atem / TARS-Graphics. JetBrains Mono, near-black bg, amber accents. Bloomberg-coded. Don't reinvent; operators already read this language.

**Layout — minimal first slice:**
```
┌─────────────────────────────────────────────┐
│ CAPITAL FLOWS · SWITCHER      ● LIVE  04:12  │  ← stream status + uptime
├─────────────────────────────────────────────┤
│  SCENES                                       │
│  [ INTRO ] [ TWO-SHOT ] [ SCREEN ] [ SOLO ]  │  ← program scene = amber fill
├─────────────────────────────────────────────┤
│  SOURCES (current scene)                      │
│  [▣ Host A cam] [▣ Host B cam] [▢ Screen]    │  ← toggle visibility
├─────────────────────────────────────────────┤
│  AUDIO                                         │
│  Host A  [mute] ▓▓▓▓▓▓░░  Host B [mute] ▓▓▓▓ │  ← mute + gain fader
├─────────────────────────────────────────────┤
│  STREAM   [ ■ STOP ]      operators online: 2 │
└─────────────────────────────────────────────┘
```

**Rules:**
- Expose a *show*, not OBS. Scenes are labeled buttons, sources are toggles, audio is mute + one fader each. Everything else in OBS stays hidden. Operator never learns OBS — same win as the Atem app.
- Program scene gets the amber fill; the rest are outlined. One glance = what's live.
- Every control reflects OBS state pushed over Ably. Click → command to bridge → OBS changes → event echoes back → button updates. All operators see the same change within the round-trip.
- "operators online" count from Ably presence so each host knows the other is on the panel.
- Config later: which scenes/sources/inputs show as buttons should be a per-client JSON config so onboarding a new client = writing a config, not editing code.

---

## Capital Flows test plan (tonight → tomorrow)

Today I have a **Windows** box; OBS + obs-websocket + the bridge all run identically on Windows, so tonight's build/test doesn't need Linux. Linux/NVENC is the production target (cheaper, headless), but it's the *same* obs-websocket — porting the box later changes nothing in the bridge or panel.

1. **Tonight (Windows):** OBS + obs-websocket v5 on, NVENC encoder. Build bridge, confirm scene cut + source toggle + mute round-trips through Ably. Open the panel in two browsers, confirm both reflect each other's actions.
2. **Sources:** wire their two host cams + a screen-share scene. Drop in a Streamless session ISO link as a browser/media source to prove the "our feeds as sources" path.
3. **Linux box:** spin a Paperspace/cloud NVIDIA box, install OBS + obs-websocket, point the same bridge at it. Should be a config change, nothing more.
4. **Tomorrow:** two Capital Flows hosts each get a panel URL + scoped token. They drive concurrently. Restream stays their output target (OBS streams to their Restream ingest — no change to their distribution).

---

## Build order (smallest shippable first)

1. Bridge: OBS connect + snapshot + scene-change event ↔ Ably. Scene switch only.
2. Panel: scenes as buttons, program highlighted, two-browser sync. **← this alone is a demo.**
3. Add source visibility toggles.
4. Add audio mute + gain.
5. Add stream start/stop + status + uptime.
6. Per-client JSON config (scenes/sources/inputs to surface). Worker-signed Ably tokens.
7. Presence count + dead-bridge indicator.

Steps 1–2 are the thing Capital Flows asked for. The rest is the same evening if it goes smooth.

---

## Notes / open questions for the Claude Code session tonight

- obs-websocket password: set it in OBS, store on the box only, Worker mints Ably tokens. Browser never sees it.
- Studio Mode? Capital Flows is simple cut-between-scenes — skip Studio Mode (preview/program) for v1, add later if they want preview-before-cut.
- Concurrency edge: two operators hit two different scenes within the same ~200ms. OBS processes sequentially, last one wins, both panels converge on OBS's final state. Acceptable — tell the hosts to agree who drives during a segment, same as any TD/operator split.
- Reconnect: panel should re-request snapshot on Ably reconnect so it never shows stale state after a drop.