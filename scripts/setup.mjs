import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { openStore, seedTenants } from '../lib/store.mjs';

process.umask(0o077);
let hidden = false;
const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
const terminal = !!process.stdin.isTTY;
const rl = createInterface({ input: process.stdin, output, terminal });
async function ask(prompt, fallback, password = false) {
  process.stdout.write(`${prompt}${fallback ? ` [${fallback}]` : ''}: `);
  hidden = password;
  const answer = await rl.question('');
  const value = password ? answer : answer.trim();
  hidden = false;
  if (password) process.stdout.write('\n');
  return value || fallback;
}
let store;
try {
  const saved = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
  const mode = await ask('Mode: demo or live', saved.MODE || 'demo');
  if (!['demo', 'live'].includes(mode)) throw new Error('Choose demo or live.');
  const config = { ...parseEnv(readFileSync('.env.example', 'utf8')), ...saved, MODE: mode };
  config.ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
  config.WEBHOOK_SECRET ||= randomBytes(32).toString('hex');
  store = openStore(resolve(process.env.DATA_PATH || `.data/${mode}.sqlite`));
  if (store.get('SELECT id FROM accounts LIMIT 1')) throw new Error('Accounts already exist for this mode. Setup will not overwrite them.');
  const users = [];
  for (const [label, email, role, tenant] of [
    ['Provider administrator', 'provider@example.test', 'provider', null],
    ['Summit administrator', 'summit@example.test', 'customer', 'summit'],
    ['Northstar administrator', 'northstar@example.test', 'customer', 'northstar'],
  ]) {
    const password = await ask(`${label} password (12–256 characters)`, null, true);
    if (!password || password.length < 12 || password.length > 256) throw new Error('Passwords must be 12–256 characters. No accounts created.');
    users.push([email, label, password, role, tenant]);
  }
  // Persist the key before creating accounts, so an interrupted setup can be retried safely.
  writeFileSync('.env', Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync('.env', 0o600);
  seedTenants(store);
  store.db.exec('BEGIN');
  try {
    for (const user of users) store.addAccount(...user);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  console.log(`\nCreated ${mode} accounts: ${users.map(user => user[0]).join(', ')}.`);
  console.log('Passwords were hashed; Webex secrets belong in the ignored .env file.');
  console.log('Run npm start and sign in with the passwords you chose.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { rl.close(); store?.close(); }
