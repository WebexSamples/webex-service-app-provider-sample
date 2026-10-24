import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { random, verifyPassword } from '../lib/security.mjs';
import { openStore } from '../lib/store.mjs';

function setup(directory, password) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url))], {
      cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const prompts = ['Mode: demo or live', 'Provider administrator password', 'Summit administrator password', 'Northstar administrator password'];
    const answers = ['demo', password, password, password];
    let output = '', prompt = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Setup timed out.')); }, 15000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (prompt < prompts.length && output.includes(prompts[prompt])) child.stdin.write(`${answers[prompt++]}\n`);
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', status => { clearTimeout(timer); resolve({ status, output }); });
  });
}
test('interactive bootstrap creates usable accounts, protects secrets, and refuses account overwrite', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'service-app-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync(new URL('../.env.example', import.meta.url), join(directory, '.env.example'));
  const password = random();
  const result = await setup(directory, password);
  assert.equal(result.status, 0); assert.ok(!result.output.includes(password));
  const environment = parseEnv(readFileSync(join(directory, '.env'), 'utf8'));
  assert.equal(environment.MODE, 'demo');
  assert.equal(Buffer.from(environment.ENCRYPTION_KEY, 'base64').length, 32);
  assert.equal(statSync(join(directory, '.env')).mode & 0o777, 0o600);
  const store = openStore(join(directory, '.data/demo.sqlite'));
  assert.equal(store.all('SELECT id FROM accounts').length, 3);
  assert.equal(verifyPassword(password, store.get('SELECT password_hash FROM accounts LIMIT 1').password_hash), true);
  store.close();
  const repeated = await setup(directory, random());
  assert.equal(repeated.status, 1);
  assert.equal(parseEnv(readFileSync(join(directory, '.env'), 'utf8')).ENCRYPTION_KEY, environment.ENCRYPTION_KEY);
});
