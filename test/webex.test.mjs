import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createWebex } from '../lib/webex.mjs';
import { orgKey, vault, random, hashPassword, verifyPassword } from '../lib/security.mjs';
import { dataSourceSettings } from '../lib/config.mjs';

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

test('Data Source calls follow the write contract, handle 204/404 removal, and sanitize scope denials', async () => {
  const calls = [], token = random();
  const payload = { schemaId: 'schema', url: 'https://provider.example/customers/summit', audience: 'ServiceAppStudio',
    subject: 'callAudioData', nonce: random(), tokenLifetimeMinutes: 60 };
  const api = createWebex({}, async (url, options) => {
    calls.push({ path: url.pathname, method: options.method, body: options.body });
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : response({ id: 'source-id', ...payload });
  });
  await api.dataSource('register', null, payload, token);
  await api.dataSource('read', 'source-id', undefined, token);
  await api.dataSource('renew', 'source-id', { ...payload, status: 'active' }, token);
  assert.equal(await api.dataSource('remove', 'source-id', undefined, token), null);
  assert.deepEqual(calls.map(c => [c.path, c.method]), [['/v1/dataSources', 'POST'], ['/v1/dataSources/source-id', 'GET'],
    ['/v1/dataSources/source-id', 'PUT'], ['/v1/dataSources/source-id', 'DELETE']]);
  assert.deepEqual(JSON.parse(calls[0].body), payload);
  assert.equal(JSON.parse(calls[2].body).status, 'active');
  const missing = createWebex({}, async () => response({}, 404));
  assert.equal(await missing.dataSource('remove', 'source-id', undefined, token), null);
  const denied = createWebex({}, async () => response({ jwsToken: token }, 403));
  await assert.rejects(denied.dataSource('register', null, payload, token), e => e.code === 'datasource_denied' && !e.message.includes(token));
  await assert.rejects(api.dataSource('remove', '../people', undefined, token));
  assert.equal(calls.length, 4);
  let attempts = 0;
  const uncertain = createWebex({}, async () => { attempts++; throw new Error('Lost response'); });
  await assert.rejects(uncertain.dataSource('register', null, payload, token), e => e.code === 'datasource_uncertain');
  assert.equal(attempts, 1);
});

test('Data Source setup accepts only a complete schema and credential-free public HTTPS base URL', () => {
  const schema = '5397013b-7920-4ffc-807c-e8a3e0a18f43';
  assert.equal(dataSourceSettings({ MODE: 'live' }), null);
  assert.equal(dataSourceSettings({ MODE: 'demo' }).baseUrl, 'https://provider.example');
  for (const base of ['http://provider.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://provider.example/?token=private', 'https://user:secret@provider.example', 'https://provider.example/#private',
    'https://provider.local', 'https://provider.example:8443']) {
    assert.throws(() => dataSourceSettings({ DATASOURCE_SCHEMA_ID: schema, DATASOURCE_BASE_URL: base }));
  }
  assert.throws(() => dataSourceSettings({ DATASOURCE_SCHEMA_ID: schema }));
  assert.deepEqual(dataSourceSettings({ DATASOURCE_SCHEMA_ID: schema, DATASOURCE_BASE_URL: 'https://provider.example/api/' }),
    { schemaId: schema, baseUrl: 'https://provider.example/api' });
});
