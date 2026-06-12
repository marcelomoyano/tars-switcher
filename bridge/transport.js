// Transport = the control plane between the bridge and the browser panels.
//
// This is the LOCAL implementation: the bridge serves the panel over HTTP and
// relays messages over a local WebSocket. It deliberately exposes the same tiny
// surface an Ably-backed transport would (broadcast / onCommand / onConnect /
// presence), so swapping in Ably for the cloud / 2-host production setup is a
// drop-in replacement and nothing in server.js or the panel has to change.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function createTransport({ port, onCommand, onConnect, onPresence }) {
  const server = http.createServer(async (req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const filePath = path.join(STATIC_DIR, path.normalize(rel));
    // Don't serve anything outside public/.
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  const wss = new WebSocketServer({ server });

  const operatorCount = () => [...wss.clients].filter((c) => c.readyState === 1).length;

  wss.on('connection', async (ws) => {
    const send = (msg) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    };
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      onCommand?.(msg, send);
    });
    ws.on('close', () => onPresence?.(operatorCount()));
    onPresence?.(operatorCount());
    await onConnect?.(send);
  });

  function broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(s);
  }

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ broadcast, operatorCount, server }));
  });
}
