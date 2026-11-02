import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApp } from '../lib/app.mjs';
import { openStore } from '../lib/store.mjs';
import { vault, AppError } from '../lib/security.mjs';
const key = () => randomBytes(32).toString('base64');
const appInfo = { id: 'app-one', name: 'Test Service App', checkedAt: Date.now(),
  organizations: [{ id: 'org-one', webexOrgId: 'org-one', name: 'Test Organization' }] };
const pair = () => ({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, obtained_at: Date.now() });
async function fixture(t, overrides = {}) {
  const store = openStore(':memory:');
  const config = { MODE: 'live', ENCRYPTION_KEY: key(), SERVICE_APP_ID: 'app-one', SERVICE_APP_CLIENT_ID: 'client-one', SERVICE_APP_CLIENT_SECRET: 'private-client-secret', ...overrides.config };
  const webex = { application: async () => structuredClone(appInfo), serviceTokens: async () => pair(), refresh: async () => pair(), ...overrides.webex };
  let app;
  const server = createServer((req, res) => app.handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.BASE_URL = `http://127.0.0.1:${server.address().port}`;
  app = createApp(config, store, { webex });
  t.after(async () => { app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const res = await fetch(`${config.BASE_URL}/api/session`), session = await res.json(), cookie = res.headers.get('set-cookie').split(';')[0];
  async function request(path, body, headers = {}) {
    const response = await fetch(config.BASE_URL + path, { method: body === undefined ? 'GET' : 'POST', headers: {
      Cookie: cookie, ...(body === undefined ? {} : { Origin: config.BASE_URL, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { app, config, store, webex, request, session, connect: () => request('/api/developer', { action: 'connect', pat: 'temporary-private-pat' }) };
}
test('local console has no login; PAT is session-only and ordinary state never returns secrets', async t => {
  const f = await fixture(t);
  assert.equal(f.session.mode, 'live');
  assert.equal((await f.request('/api/state')).data.configured, true);
  assert.equal((await f.connect()).status, 200);
  const state = await f.request('/api/state');
  assert.equal(state.data.organizations.length, 1);
  assert.equal(state.data.serviceApp.name, 'Test Service App');
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(state.data), /temporary-private-pat|private-client-secret/);
  assert.doesNotMatch(JSON.stringify(f.store.all('SELECT * FROM settings')), /temporary-private-pat|private-client-secret/);
  assert.equal((await f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one' })).status, 400);
  assert.equal((await f.request('/api/tokens', { action: 'retrieve', orgId: 'other-org', confirm: true })).status, 403);
  const result = await f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one', confirm: true });
  assert.equal(result.data.tokens.access_token, 'private-access-token');
  const row = f.store.get('SELECT * FROM managed_service_tokens');
  assert.doesNotMatch(JSON.stringify(row), /private-access|private-refresh/);
  assert.equal(vault(f.config.ENCRYPTION_KEY).open(row.credentials, JSON.stringify(['service-app', 'app-one', 'client-one', 'org-one'])).refresh_token, 'private-refresh-token');
  assert.throws(() => vault(f.config.ENCRYPTION_KEY).open(row.credentials, JSON.stringify(['service-app', 'app-two', 'client-one', 'org-one'])));
  assert.doesNotMatch(JSON.stringify((await f.request('/api/state')).data), /private-access|private-refresh/);
  assert.equal((await f.request('/api/tokens', { action: 'show', orgId: 'org-one', confirm: true })).status, 200);
  await f.request('/api/developer', { action: 'disconnect' });
  assert.equal((await f.request('/api/tokens', { action: 'show', orgId: 'org-one', confirm: true })).status, 409);
  f.app.close();
  assert.equal((await f.request('/api/state')).status, 401);
});
test('origin, CSRF and DNS rebinding checks protect all local actions; removed routes are absent', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/developer', { action: 'connect', pat: 'pat' }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('/api/developer', { action: 'connect', pat: 'pat' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  const badHost = await new Promise(resolve => {
    const req = httpRequest(f.config.BASE_URL + '/api/state', { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  assert.equal(badHost, 400);
  for (const route of ['/api/directory', '/api/data-source', '/api/connect', '/api/oauth/provider', '/api/local/perspective']) assert.equal((await f.request(route, {})).status, 404);
  assert.throws(() => createApp({ ...f.config, BASE_URL: 'https://sample.example' }, f.store), /loopback/);
});
test('settings preserve legacy encrypted registrations, isolate token pairs and clear PAT access', async t => {
  const f = await fixture(t);
  await f.connect();
  await f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one', confirm: true });
  assert.equal((await f.request('/api/settings', { SERVICE_APP_ID: 'app-two' })).status, 400);
  assert.equal((await f.request('/api/settings', { SERVICE_APP_MANAGE_URL: 'https://evil.test' })).status, 400);
  assert.equal((await f.request('/api/settings', { SERVICE_APP_ID: 'app-two', SERVICE_APP_CLIENT_SECRET: 'new-secret' })).status, 200);
  const state = (await f.request('/api/state')).data;
  assert.equal(state.developerConnected, false); assert.equal(state.organizations.length, 0);
  assert.equal(f.store.all('SELECT * FROM managed_service_tokens').length, 1);
});
test('rechecks current approval before reveal and refresh, preserving encrypted pair on failures', async t => {
  const f = await fixture(t);
  await f.connect();
  await f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one', confirm: true });
  const old = f.store.get('SELECT credentials FROM managed_service_tokens').credentials;
  f.webex.application = async () => ({ ...appInfo, organizations: [] });
  assert.equal((await f.request('/api/tokens', { action: 'show', orgId: 'org-one', confirm: true })).status, 403);
  f.webex.application = async () => appInfo;
  f.webex.refresh = async () => { throw new AppError(502, 'Refresh denied'); };
  assert.equal((await f.request('/api/tokens', { action: 'refresh', orgId: 'org-one', confirm: true })).status, 502);
  assert.equal(f.store.get('SELECT credentials FROM managed_service_tokens').credentials, old);
  f.webex.application = async () => { const e = new AppError(502, 'Expired PAT'); e.upstreamStatus = 401; throw e; };
  assert.equal((await f.request('/api/organizations', {})).status, 502);
  assert.equal((await f.request('/api/state')).data.developerConnected, false);
});
test('concurrent token mutations and setup changes are rejected; disconnect prevents delayed persistence', async t => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { webex: { serviceTokens: async () => { started(); await gate; return pair(); } } });
  await f.connect();
  const pending = f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one', confirm: true });
  await began;
  assert.equal((await f.request('/api/tokens', { action: 'retrieve', orgId: 'org-one', confirm: true })).status, 409);
  assert.equal((await f.request('/api/settings', { SERVICE_APP_NAME: 'Other' })).status, 409);
  await f.request('/api/developer', { action: 'disconnect' });
  release();
  assert.equal((await pending).status, 409);
  assert.equal(f.store.all('SELECT * FROM managed_service_tokens').length, 0);
});
test('demo exercises approval/revocation without calling Webex', async t => {
  const f = await fixture(t, { config: { MODE: 'demo' }, webex: { application: () => { throw Error('Network forbidden'); } } });
  await f.connect();
  let state = (await f.request('/api/state')).data;
  assert.equal(state.organizations[0].id, 'demo-summit');
  const result = await f.request('/api/tokens', { action: 'retrieve', orgId: 'demo-summit', confirm: true });
  assert.match(result.data.tokens.access_token, /^demo-access-/);
  await f.request('/api/demo/authorization', { orgId: 'demo-summit', authorized: false });
  assert.equal((await f.request('/api/tokens', { action: 'show', orgId: 'demo-summit', confirm: true })).status, 403);
  state = (await f.request('/api/state')).data;
  assert.equal(state.organizations.length, 0);
});
test('upgrade keeps old settings and tables without activating old integrations', t => {
  const store = openStore(':memory:'), encryptionKey = key(), box = vault(encryptionKey);
  t.after(() => store.close());
  store.setting('provider_configuration', box.seal({ SERVICE_APP_ID: 'app-one', SERVICE_APP_CLIENT_ID: 'client-one',
    SERVICE_APP_CLIENT_SECRET: 'saved-secret', PROVIDER_INTEGRATION_CLIENT_SECRET: 'legacy-secret' }, 'provider-configuration'));
  store.setting('provider_tokens', 'legacy-encrypted-tokens');
  store.run('CREATE TABLE tenants (id TEXT)'); store.run("INSERT INTO tenants VALUES ('legacy')");
  const app = createApp({ MODE: 'live', BASE_URL: 'http://localhost:3000', ENCRYPTION_KEY: encryptionKey }, store);
  app.close();
  assert.equal(store.get('SELECT id FROM tenants').id, 'legacy');
  assert.equal(store.setting('provider_tokens'), 'legacy-encrypted-tokens');
  assert.equal(box.open(store.setting('provider_configuration'), 'provider-configuration').PROVIDER_INTEGRATION_CLIENT_SECRET, 'legacy-secret');
});
