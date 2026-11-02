// Isolated browser-test launcher; never reads .env or connects to Webex.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openStore } from '../lib/store.mjs';
import { createApp } from '../lib/app.mjs';

if (!process.env.DATA_PATH) throw new Error('Use scripts/browser_smoke.py.');
process.umask(0o077);
const store = openStore(process.env.DATA_PATH);
let app;
const server = createServer((req, res) => app.handler(req, res));
server.listen(0, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  app = createApp({ MODE: 'demo', BASE_URL: baseUrl, ENCRYPTION_KEY: randomBytes(32).toString('base64') }, store, { localAccess: true });
  console.log(baseUrl);
});
process.on('SIGTERM', () => { server.close(() => { app.close(); store.close(); process.exit(0); }); server.closeIdleConnections(); });
