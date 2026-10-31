import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localKey } from '../lib/config.mjs';
import { randomBytes } from 'node:crypto';
import { vault } from '../lib/security.mjs';

test('local setup generates a private persistent key without environment configuration', t => {
  const directory = mkdtempSync(join(tmpdir(), 'service-app-key-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = localKey(directory);
  assert.equal(Buffer.from(key, 'base64').length, 32);
  assert.equal(localKey(directory), key);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'master.key')).mode & 0o777, 0o600);
  const sealed = vault(key).seal({ secret: 'example-test-credential' }, 'provider-configuration');
  assert.equal(vault(localKey(directory)).open(sealed, 'provider-configuration').secret, 'example-test-credential');
  writeFileSync(join(directory, 'master.key'), 'damaged');
  assert.throws(() => localKey(directory), /invalid/);
  rmSync(join(directory, 'master.key'));
  writeFileSync(join(directory, 'live.sqlite'), 'existing encrypted database');
  assert.throws(() => localKey(directory), /key is missing/);
});
test('migration preserves the existing encryption key and rejects conflicting keys or symlinks', t => {
  const directory = mkdtempSync(join(tmpdir(), 'service-app-migrate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = randomBytes(32).toString('base64');
  assert.equal(localKey(directory, key), key);
  assert.equal(readFileSync(join(directory, 'master.key'), 'utf8'), key);
  assert.throws(() => localKey(directory, randomBytes(32).toString('base64')), /differs/);
  const target = join(directory, 'linked');
  symlinkSync(join(directory, 'master.key'), target);
  rmSync(join(directory, 'master.key'));
  symlinkSync(target, join(directory, 'master.key'));
  assert.throws(() => localKey(directory));
});
