import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from './lib/store.mjs';
import { createApp } from './lib/app.mjs';
import { localKey } from './lib/config.mjs';

process.umask(0o077);
const { values } = parseArgs({ options: { demo: { type: 'boolean' }, live: { type: 'boolean' }, port: { type: 'string' },
  origin: { type: 'string' }, 'data-dir': { type: 'string' } } });
if (values.demo && values.live) throw new Error('Choose either --demo or --live.');
const mode = values.demo ? 'demo' : values.live ? 'live' : process.env.MODE || 'live';
if (!['demo', 'live'].includes(mode)) throw new Error('Choose demo or live mode.');
const port = Number(values.port || process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const directory = resolve(values['data-dir'] || '.data');
const config = { ...process.env, MODE: mode, BASE_URL: values.origin || process.env.BASE_URL || `http://localhost:${port}`,
  ENCRYPTION_KEY: localKey(directory, process.env.ENCRYPTION_KEY) };
const store = openStore(resolve(process.env.DATA_PATH || `${directory}/${mode}.sqlite`));
const app = createApp(config, store);
const server = createServer({ maxHeaderSize: 16384, requestTimeout: 20000, headersTimeout: 15000 }, app.handler);
server.listen(port, '127.0.0.1', () => {
  console.log(`Service App provider sample: ${config.BASE_URL} (${mode} mode)`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.close();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => server.closeAllConnections(), 1000).unref();
  server.closeIdleConnections();
});
