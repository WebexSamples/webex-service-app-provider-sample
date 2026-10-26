import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createWebex } from '../lib/webex.mjs';
import { orgKey, vault, random, hashPassword, verifyPassword } from '../lib/security.mjs';

const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
test('identity checks the authenticated person role, not merely an administrator-visible roles list', async () => {
  let roles;
  const api = createWebex({}, async url => url.pathname === '/v1/people/me'
    ? response({ id: 'person', orgId: 'org-one', type: 'person', roles })
    : response({ items: [{ id: 'full-admin-id', name: 'Full Administrator' }] }));
  await assert.rejects(api.identity(random()), error => error.code === 'admin_required');
  roles = ['member-id'];
  await assert.rejects(api.identity(random()), error => error.code === 'admin_required');
  roles = ['full-admin-id'];
  assert.equal((await api.identity(random())).orgId, 'org-one');
});
test('directory pagination rejects hostile URLs and cross-organization responses', async () => {
  let requests = 0, wrongOrg = false;
  const api = createWebex({}, async () => { requests++; return response({ items: [{ displayName: 'One', orgId: wrongOrg ? 'org-two' : 'org-one' }] }); });
  await assert.rejects(api.directory('org-one', random(), 'https://evil.example/v1/people?orgId=org-one'));
  await assert.rejects(api.directory('org-one', random(), 'https://webexapis.com/v1/people?orgId=org-two'));
  assert.equal(requests, 0);
  assert.equal((await api.directory('org-one', random())).people.length, 1);
  wrongOrg = true;
  await assert.rejects(api.directory('org-one', random()), /outside/);
});
test('token retrieval uses provider bearer credentials and the verified target organization', async () => {
  const provider = random(), access = random(), refresh = random();
  const config = { SERVICE_APP_ID: 'app-id', SERVICE_APP_CLIENT_ID: random(), SERVICE_APP_CLIENT_SECRET: random() };
  const api = createWebex(config, async (url, options) => {
    assert.equal(url.pathname, '/v1/applications/app-id/token');
    assert.equal(options.headers.Authorization, `Bearer ${provider}`);
    assert.deepEqual(JSON.parse(options.body), { clientId: config.SERVICE_APP_CLIENT_ID, clientSecret: config.SERVICE_APP_CLIENT_SECRET, targetOrgId: 'verified-org' });
    return response({ access_token: access, refresh_token: refresh, expires_in: 3600 });
  });
  assert.equal((await api.serviceTokens('verified-org', provider)).access_token, access);
});
test('refresh preserves refresh token when upstream does not rotate it and sanitizes failures', async () => {
  const previous = random();
  const api = createWebex({ SERVICE_APP_CLIENT_ID: random(), SERVICE_APP_CLIENT_SECRET: random() }, async () => response({ access_token: random(), expires_in: 3600 }));
  assert.equal((await api.refresh({ refresh_token: previous }, 'service')).refresh_token, previous);
  const denied = createWebex({}, async () => response({ secret: previous }, 403));
  await assert.rejects(denied.request('/people', random()), error => error.code === 'webex_denied' && !error.message.includes(previous));
});
test('encrypted token records are tenant-bound and tamper-evident; passwords are salted', () => {
  const box = vault(randomBytes(32).toString('base64')), access = random();
  const ciphertext = box.seal({ access }, 'tenant-a');
  assert.equal(box.open(ciphertext, 'tenant-a').access, access);
  assert.throws(() => box.open(ciphertext, 'tenant-b'));
  const changed = Buffer.from(ciphertext, 'base64'); changed[35] ^= 1;
  assert.throws(() => box.open(changed.toString('base64'), 'tenant-a'));
  const password = random(), hashed = hashPassword(password);
  assert.equal(verifyPassword(password, hashed), true);
  assert.equal(verifyPassword(random(), hashed), false);
  assert.notEqual(hashPassword(password), hashed);
});
test('organization comparison normalizes API IDs without guessing based on names or domains', () => {
  const id = 'ea111111-1111-1111-1111-111111111111';
  assert.equal(orgKey(Buffer.from(`ciscospark://us/ORGANIZATION/${id}`).toString('base64')), id);
  assert.equal(orgKey(id), id);
  assert.throws(() => orgKey('https://evil.example'));
});
