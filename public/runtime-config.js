// Panel transport config, read before app.js boots.
//
// Auto-selects by host so ONE file works everywhere:
//   • served from the bridge on localhost  → local WS (desk demo, no key)
//   • served from Cloudflare Pages (or any other host) → Ably (cloud)
//
// Fill WORKER_URL with your deployed token Worker before deploying to Pages.
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const WORKER_URL = 'https://tars-switcher-token.marcelo-abd.workers.dev/token';

window.TARS_CONFIG = LOCAL
  ? { mode: 'local' }
  : {
      mode: 'ably',
      clientId: 'capital-flows', // = channel switcher:capital-flows
      ablyTokenUrl: WORKER_URL,
    };
