import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { openStore } from './lib/store.mjs';
import { createApp } from './lib/app.mjs';

process.umask(0o077);
const mode = process.env.MODE || 'demo';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
const config = { ...process.env, MODE: mode, BASE_URL: process.env.BASE_URL || `http://localhost:${port}` };
const store = openStore(resolve(process.env.DATA_PATH || `.data/${mode}.sqlite`));
if (!store.get('SELECT id FROM accounts LIMIT 1')) {
  store.close(); throw new Error('Run npm run setup to create local accounts first.');
}
const app = createApp(config, store);
const server = createServer({ maxHeaderSize: 16384, requestTimeout: 20000, headersTimeout: 15000 }, app.handler);
server.listen(port, '127.0.0.1', () => console.log(`Service App provider sample: ${config.BASE_URL} (${mode} mode)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { app.close(); store.close(); process.exit(0); });
  server.closeIdleConnections();
});
