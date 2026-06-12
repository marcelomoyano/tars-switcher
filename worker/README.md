# tars-switcher-token (Cloudflare Worker)

Mints scoped Ably tokens for browser panels. The Ably API key lives here as a
secret and never reaches the browser; each token is capability-limited to one
show's channel (`switcher:{show}`).

## Deploy

```sh
cd worker
npx wrangler login
npx wrangler secret put ABLY_API_KEY   # paste the Ably "tars-switcher" key (appId.keyId:keySecret)
npx wrangler deploy
```

Deploy prints a URL like `https://tars-switcher-token.<acct>.workers.dev`.
The token endpoint is that URL + `/token`.

## Use from the panel

In `public/runtime-config.js`:

```js
window.TARS_CONFIG = {
  mode: 'ably',
  clientId: 'capital-flows',
  ablyTokenUrl: 'https://tars-switcher-token.<acct>.workers.dev/token',
};
```

## Test

```sh
curl "https://tars-switcher-token.<acct>.workers.dev/token?show=capital-flows&op=op-test"
```

Returns a JSON Ably TokenRequest (`keyName`, `capability`, `mac`, …). The
`capability` should read `{"switcher:capital-flows":["presence","publish","subscribe"]}`.

## Notes

- CORS is `*` for bring-up. For production, set it to your panel's Pages origin
  in `src/index.js`.
- Tokens last 1h; the Ably client auto-renews via the same authUrl.
