# TARS-Switcher

Strip OBS down to a show. Two operators, browser, concurrent control.

OBS is the single source of truth. The bridge subscribes to obs-websocket events
and republishes them; every panel renders from that one stream. Click → command
to bridge → OBS changes → event echoes back → all panels update. Last-write-wins
at OBS, so two operators never fight over state.

```
  OBS ──obs-websocket v5 (ws://localhost:4455)──► bridge ──transport──► panel(s)
```

## Run (local)

1. In OBS: **Tools → WebSocket Server Settings → Enable**. Port `4455`.
   (Set a password later for production; leave blank for local.)
2. `npm install`
3. `npm start`
4. Open **http://localhost:4466** in two browser tabs/windows. Both reflect each
   other's actions in real time.

Optional demo content (throwaway scenes/sources/audio so you can see it work
before wiring real cams):

```
node scripts/seed-demo.js          # create demo scenes
node scripts/seed-demo.js --clean  # remove them
```

## Config

`config.json`:

- `obs.url` / `obs.password` — OBS websocket. Password can also come from the
  `OBS_PASSWORD` env var so it never lives in the repo.
- `server.port` — where the panel + relay listen (default `4466`).
- `show.title` — header label.
- `show.sceneCollection` — pin the OBS scene collection for this show. The bridge
  selects it on connect, and auto-refreshes every panel if the collection is
  switched in OBS. Empty = use whatever collection OBS currently has active.
- `show.scenes` — **hybrid scene exposure.**
  - Empty `[]` → show every scene in the active collection **except** ones the
    client prefixed with `show.hidePrefix` (default `"_"`). The client controls
    exposure from OBS itself — name utility/nested scenes `_foo` to hide them.
  - Non-empty → show **only** those scenes, **in the listed order** (= button
    order). Names must match OBS exactly; missing ones are silently skipped.
- `show.hidePrefix` — prefix that marks a scene as hidden when `show.scenes` is
  empty (default `"_"`). Set to `""` to show literally everything.
- `show.audioInputs` — same whitelist+order curation for the audio faders.

Onboarding a client = pick their collection, then either prefix utility scenes
with `_` in OBS or list the on-air scenes here. No code changes.

## What's wired

- Scene cut (`SetCurrentProgramScene`)
- Source visibility toggles for the current scene (`SetSceneItemEnabled`)
- Audio mute + gain fader per input (`SetInputMute` / `SetInputVolume`)
- Stream start/stop + live indicator + uptime (`StartStream` / `StopStream` / `GetStreamStatus`)
- Snapshot on connect + on reconnect (never shows stale state after a drop)
- Operators-online count
- Heartbeat every 2s → live/dead bridge indicator

## Transport: local (default) or Ably (cloud)

Two interchangeable control planes, same `{type, payload}` / `{cmd, ...}` wire
messages. Pick with `config.transport.mode`. Nothing in `server.js`, `obs.js`,
or the panel UI cares which is active.

**`local` (default)** — bridge serves the panel over HTTP and relays over its own
WebSocket. No account, no inbound-from-internet. Great for the OBS box on the LAN.

**`ably`** — bridge talks **outbound only** to Ably channel `switcher:{clientId}`
(good for a cloud OBS box behind NAT). Browsers connect with **scoped tokens**
minted by the Worker — the Ably API key never reaches the browser.

### Going cloud

1. **Ably:** app **TARS-Switcher**, one key named `tars-switcher`, capabilities
   `publish, subscribe, presence, history` on resource `switcher:*`.
2. **Worker** (`worker/`): `npx wrangler secret put ABLY_API_KEY` then
   `npx wrangler deploy`. See `worker/README.md`.
3. **Bridge:** set `config.transport.mode: "ably"` + `clientId`, export
   `ABLY_API_KEY` in the box's env, run `npm start`.
4. **Panel:** host `public/` (e.g. Cloudflare Pages) and set
   `public/runtime-config.js` to `mode:'ably'` with the `clientId` + Worker
   `ablyTokenUrl`.

The key is server-side only (bridge + Worker). One key + per-client scoped
tokens — no per-client keys.

## Files

- `bridge/server.js` — orchestrator: OBS ↔ transport, heartbeat, snapshot.
- `bridge/obs.js` — OBS connect, snapshot, event mirroring, command dispatch.
- `bridge/transport.js` — local HTTP + WebSocket relay.
- `bridge/transport-ably.js` — Ably control plane (cloud).
- `public/` — the panel; `transport.js` picks local/ably from `runtime-config.js`.
- `worker/` — Cloudflare Worker that mints scoped Ably tokens.
- `scripts/seed-demo.js` — throwaway demo content.
