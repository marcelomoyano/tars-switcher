// Verifies the Worker's token-signing algorithm end-to-end WITHOUT deploying it:
// signs an Ably TokenRequest with the exact same steps as worker/src/index.js
// (HMAC-SHA256, same field order — using the same crypto.subtle/btoa primitives
// the Worker runtime has), then connects to Ably as a browser panel would via
// authCallback. If Ably accepts the MAC, the deployed Worker will too. Then it
// drives the live bridge over the scoped token to prove the operator path.
//
//   ABLY_API_KEY=… node scripts/token-verify.js
import Ably from 'ably';

const apiKey = process.env.ABLY_API_KEY;
if (!apiKey) throw new Error('set ABLY_API_KEY');
const show = 'capital-flows';
const OPS = ['presence', 'publish', 'subscribe'];

const sep = apiKey.indexOf(':');
const keyName = apiKey.slice(0, sep);
const keySecret = apiKey.slice(sep + 1);

// ── identical to the Worker ──────────────────────────────────────────────────
async function signTokenRequest({ keyName, keySecret, capability, clientId, ttl }) {
  const timestamp = Date.now();
  const nonce = randomNonce();
  const cid = clientId || '';
  const signText = [keyName, ttl, capability, cid, timestamp, nonce].join('\n') + '\n';
  const mac = await hmacBase64(keySecret, signText);
  return { keyName, ttl, capability, clientId: cid || undefined, timestamp, nonce, mac };
}
async function hmacBase64(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
function randomNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
// ─────────────────────────────────────────────────────────────────────────────

const capability = JSON.stringify({ [`switcher:${show}`]: OPS });

// authCallback mimics the panel fetching from the Worker's /token endpoint.
const realtime = new Ably.Realtime({
  authCallback: async (_params, cb) => {
    try {
      const tr = await signTokenRequest({ keyName, keySecret, capability, clientId: 'op-token-test', ttl: 3600000 });
      cb(null, tr);
    } catch (e) {
      cb(e, null);
    }
  },
  echoMessages: false,
});

realtime.connection.on('failed', (e) => {
  console.error('✗ Ably REJECTED the token:', e?.reason?.message || e);
  process.exit(1);
});

await new Promise((res) => realtime.connection.once('connected', res));
console.log('✓ Ably ACCEPTED the signed token — Worker signing is correct');
console.log('  clientId:', realtime.auth.clientId, '· capability scoped to switcher:' + show);

// Prove the scoped token can actually drive the live bridge.
const channel = realtime.channels.get(`switcher:${show}`);
let snapshot = null;
channel.subscribe('m', (m) => {
  if (m.data.type === 'snapshot' && !snapshot) snapshot = m.data.payload;
});
await channel.attach();
await channel.presence.enter();
await channel.publish('cmd', { cmd: 'requestSnapshot' });

await new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (snapshot) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > 5000) { clearInterval(iv); rej(new Error('no snapshot — is the bridge running in ably mode?')); }
  }, 100);
});
console.log('✓ scoped-token operator drove the live bridge · scenes:', snapshot.scenes.join(', '));

// Confirm the scope actually restricts: a channel OUTSIDE switcher:* must fail.
try {
  const forbidden = realtime.channels.get('secret-other-channel');
  await forbidden.attach();
  console.error('✗ SECURITY: token attached to an out-of-scope channel — capability too broad');
  process.exit(1);
} catch {
  console.log('✓ scope enforced · token denied on a non-switcher channel');
}

console.log('\nALL GOOD — token signing + scoped operator path verified.');
realtime.close();
process.exit(0);
