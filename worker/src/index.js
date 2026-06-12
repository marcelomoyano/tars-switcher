// TARS-Switcher token Worker.
//
// Mints a SCOPED Ably token for a browser panel: capability limited to that one
// show's channel (`switcher:{show}`). The Ably API key lives here as a secret
// (ABLY_API_KEY) and is never sent to the browser. The panel points its Ably
// client's authUrl at GET /token?show=<id>&op=<operatorId>.
//
// Deploy:
//   cd worker
//   npx wrangler secret put ABLY_API_KEY    # paste the tars-switcher key
//   npx wrangler deploy

const TTL_MS = 60 * 60 * 1000; // 1-hour tokens; Ably client auto-renews
const OPS = ['presence', 'publish', 'subscribe']; // sorted (Ably capability ops)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    const url = new URL(request.url);
    if (url.pathname !== '/token') return cors(text('not found', 404));

    const show = (url.searchParams.get('show') || '').trim();
    const op = (url.searchParams.get('op') || '').trim();
    // show ids are channel names — keep them tight.
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(show)) return cors(json({ error: 'invalid show' }, 400));

    const apiKey = env.ABLY_API_KEY;
    if (!apiKey || !apiKey.includes(':')) return cors(json({ error: 'token service not configured' }, 500));

    const sep = apiKey.indexOf(':');
    const keyName = apiKey.slice(0, sep); // appId.keyId
    const keySecret = apiKey.slice(sep + 1);
    const capability = JSON.stringify({ [`switcher:${show}`]: OPS });

    const tokenRequest = await signTokenRequest({ keyName, keySecret, capability, clientId: op, ttl: TTL_MS });
    return cors(json(tokenRequest));
  },
};

// Build + HMAC-sign an Ably TokenRequest. The signed text is the fixed field
// order, each followed by '\n'; the MAC is base64(HMAC-SHA256(secret, text)).
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

// CORS is wide-open here for first bring-up. For production, replace '*' with
// your panel's Pages origin.
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const text = (body, status = 200) => new Response(body, { status });
