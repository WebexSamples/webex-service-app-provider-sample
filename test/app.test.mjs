import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { openStore, seedTenants } from '../lib/store.mjs';
import { random, vault, AppError } from '../lib/security.mjs';
import { createApp } from '../lib/app.mjs';

async function fixture(t, mode = 'demo', webex, options = {}) {
  const store = openStore(':memory:'); seedTenants(store);
  const password = random();
  if (!options.empty) {
    store.addAccount('provider@example.test', 'Provider', password, 'provider');
    store.addAccount('summit@example.test', 'Summit admin', password, 'customer', 'summit');
    store.addAccount('northstar@example.test', 'Northstar admin', password, 'customer', 'northstar');
  }
  let app;
  const server = createServer((req, res) => app.handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { MODE: mode, BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'), PROVIDER_WEBEX_PERSON_ID: 'developer-person',
    PROVIDER_INTEGRATION_CLIENT_ID: random(), PROVIDER_INTEGRATION_CLIENT_SECRET: random(),
    CUSTOMER_INTEGRATION_CLIENT_ID: random(), CUSTOMER_INTEGRATION_CLIENT_SECRET: random(),
    SERVICE_APP_ID: 'expected-app', SERVICE_APP_CLIENT_ID: random(), SERVICE_APP_CLIENT_SECRET: random(), WEBHOOK_SECRET: random(), ...options.config };
  app = createApp(config, store, { ...options, webex });
  t.after(async () => { app.close(); await new Promise(resolve => server.close(resolve)); store.close(); });
  function client() {
    let cookie = '', csrf = '';
    return {
      async request(path, body, overrides = {}) {
        const response = await fetch(`${config.BASE_URL}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
          headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: config.BASE_URL,
            'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...overrides }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        if (path === '/api/session' && data?.csrf) csrf = data.csrf;
        return { status: response.status, data, headers: response.headers };
      },
      async login(email) {
        await this.request('/api/session');
        assert.equal((await this.request('/api/login', { email, password })).status, 200);
        await this.request('/api/session');
      },
    };
  }
  const provider = client(), summit = client(), northstar = client();
  if (!options.empty) {
    await provider.login('provider@example.test'); await summit.login('summit@example.test'); await northstar.login('northstar@example.test');
  }
  return { store, config, provider, summit, northstar, client };
}
async function approve(f, org = 'demo-summit') {
  assert.equal((await f.provider.request('/api/demo/provider', {})).status, 200);
  assert.equal((await f.provider.request('/api/demo/authorization', { orgId: org, authorized: true })).status, 200);
}
async function connect(client, orgId = 'demo-summit') {
  assert.equal((await client.request('/api/demo/verify', { orgId, authority: 'admin' })).status, 200);
  return client.request('/api/connect', { orgId, confirm: true });
}
test('Momentum assets are served locally without exposing package files or relaxing CSP', async t => {
  const f = await fixture(t);
  for (const [path, type] of [['/vendor/momentum.js', 'text/javascript'], ['/vendor/theme.css', 'text/css'],
    ['/vendor/typography.css', 'text/css'], ['/vendor/fonts/css/fonts.css', 'text/css'], ['/vendor/fonts/inter/Inter.var.woff2', 'font/woff2']]) {
    const response = await fetch(`${f.config.BASE_URL}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'; style-src 'self';/);
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
  for (const path of ['/vendor/package.json', '/node_modules/@momentum-design/components/package.json', '/vendor/%2e%2e/.env',
    '/.env', '/.data/master.key', '/.data/live.sqlite']) {
    assert.equal((await f.provider.request(path)).status, 404);
  }
});
test('approval alone never links; confirmed machine access paginates and survives customer re-login', async t => {
  const f = await fixture(t); await approve(f);
  assert.equal(f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials, null);
  assert.equal((await connect(f.summit)).status, 200);
  const saved = f.store.get("SELECT * FROM tenants WHERE id='summit'");
  assert.equal(saved.status, 'Connected');
  assert.ok(!saved.credentials.includes('access_token'));
  const first = await f.summit.request('/api/directory', {});
  assert.equal(first.status, 200); assert.equal(first.data.people.length, 3); assert.equal(first.data.hasMore, true);
  const second = await f.summit.request('/api/directory', { more: true });
  assert.equal(second.data.people.length, 3); assert.equal(second.data.hasMore, false);
  assert.notEqual(first.data.people[0].name, second.data.people[0].name);
  await f.summit.request('/api/logout', {}); await f.summit.login('summit@example.test');
  assert.equal((await f.summit.request('/api/directory', {})).status, 200);
  const state = (await f.provider.request('/api/state')).data;
  assert.ok(!JSON.stringify(state).includes('access_token'));
  assert.equal(state.tenants[0].credentials, undefined);
});
test('reject member authority, missing authorization, unconfirmed links, and cross-tenant claims', async t => {
  const f = await fixture(t);
  assert.equal((await f.summit.request('/api/demo/verify', { orgId: 'demo-summit', authority: 'member' })).status, 403);
  assert.equal((await f.summit.request('/api/connect', { orgId: 'demo-summit', confirm: true })).status, 409);
  await f.summit.request('/api/demo/verify', { orgId: 'demo-summit', authority: 'admin' });
  assert.equal((await f.summit.request('/api/connect', { orgId: 'demo-northstar', confirm: true })).status, 400);
  assert.equal((await f.summit.request('/api/connect', { orgId: 'demo-summit', confirm: false })).status, 400);
  await f.provider.request('/api/demo/provider', {});
  assert.equal((await connect(f.summit)).data.code, 'not_authorized');
  await approve(f); assert.equal((await connect(f.summit)).status, 200);
  assert.equal((await connect(f.northstar)).data.code, 'claim_conflict');
  assert.equal((await f.northstar.request('/api/directory', {})).status, 409);
  assert.equal((await f.northstar.request('/api/state')).data.tenants.length, 1);
});
test('deauthorization deletes credentials; reauthorization does not automatically reconnect', async t => {
  const f = await fixture(t); await approve(f); await connect(f.summit);
  await f.provider.request('/api/demo/authorization', { orgId: 'demo-summit', authorized: false });
  let row = f.store.get("SELECT * FROM tenants WHERE id='summit'");
  assert.equal(row.credentials, null); assert.equal(row.status, 'Disconnected');
  assert.equal((await f.summit.request('/api/directory', {})).status, 409);
  await approve(f);
  assert.equal((await f.summit.request('/api/directory', {})).status, 409);
  assert.equal((await connect(f.summit)).status, 200);
});
test('disconnect invalidates pending proofs and pagination, and releases the organization claim', async t => {
  const f = await fixture(t); await approve(f); await connect(f.summit);
  const other = f.client(); await other.login('summit@example.test');
  await other.request('/api/demo/verify', { orgId: 'demo-summit', authority: 'admin' });
  await f.summit.request('/api/directory', {});
  assert.equal((await f.summit.request('/api/disconnect', { confirm: true })).status, 200);
  assert.equal((await other.request('/api/connect', { orgId: 'demo-summit', confirm: true })).status, 409);
  assert.equal((await f.summit.request('/api/directory', { more: true })).status, 409);
  assert.equal(f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials, null);
  assert.equal((await connect(f.northstar)).status, 200);
});
test('sessions, CSRF, role restrictions, host validation, and frontend headers are enforced', async t => {
  const f = await fixture(t);
  assert.equal((await f.summit.request('/api/demo/provider', {})).status, 403);
  assert.equal((await f.provider.request('/api/directory', {})).status, 403);
  assert.equal((await f.summit.request('/api/logout', {}, { 'X-CSRF-Token': 'invalid' })).status, 403);
  assert.equal((await f.summit.request('/api/logout', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.provider.request('/api/demo/authorization', { orgId: {} })).status, 400);
  assert.equal((await f.summit.request('/api/demo/verify', {})).status, 400);
  assert.equal((await f.summit.request('/api/directory', { more: 'yes' })).status, 400);
  const hostStatus = await new Promise(resolve => {
    const request = httpRequest(`${f.config.BASE_URL}/api/state`, { headers: { Host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }); request.end();
  });
  assert.equal(hostStatus, 400);
  const page = await f.summit.request('/');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const anon = f.client();
  assert.equal((await anon.request('/api/state')).status, 401);
  const initial = await anon.request('/api/session');
  assert.ok(initial.headers.get('set-cookie').includes('HttpOnly'));
});
test('live OAuth is session-bound, single-use, and persists no customer tokens', async t => {
  const access = random(), refresh = random();
  let tokenCalls = 0;
  const fake = {
    exchange: async () => ({ access_token: access, refresh_token: refresh, obtained_at: Date.now(), expires_in: 3600 }),
    identity: async (token, admin) => ({ personId: admin ? 'customer-person' : 'developer-person', orgId: 'customer-org', name: 'Customer admin' }),
    serviceTokens: async org => { tokenCalls++; assert.equal(org, 'customer-org'); return { access_token: random(), refresh_token: random(), obtained_at: Date.now(), expires_in: 3600 }; },
    organization: async id => ({ id, name: 'Live test org' }),
    directory: async () => ({ people: [{ name: 'Live directory user', email: 'member@example.test' }], next: null }),
  };
  const f = await fixture(t, 'live', fake);
  assert.equal((await f.provider.request('/api/demo/provider', {})).status, 404);
  async function oauth(client, kind) {
    const started = await client.request(`/api/oauth/${kind}`, {});
    const state = new URL(started.data.url).searchParams.get('state');
    return `/oauth/${kind}/callback?state=${encodeURIComponent(state)}&code=opaque-test-code`;
  }
  const stolen = await oauth(f.summit, 'customer');
  assert.equal((await f.northstar.request(stolen)).status, 403);
  const providerCallback = await oauth(f.provider, 'provider');
  assert.equal((await f.provider.request(providerCallback)).status, 303);
  const customerCallback = await oauth(f.summit, 'customer');
  assert.equal((await f.summit.request(customerCallback)).status, 303);
  assert.equal((await f.summit.request(customerCallback)).status, 403);
  assert.equal(tokenCalls, 0);
  assert.equal((await f.summit.request('/api/connect', { orgId: 'customer-org', confirm: true })).status, 200);
  assert.equal(tokenCalls, 1);
  assert.equal((await f.summit.request('/api/directory', {})).status, 200);
  const customerRow = f.store.get("SELECT * FROM tenants WHERE id='summit'");
  const decrypted = vault(f.config.ENCRYPTION_KEY).open(customerRow.credentials, 'summit');
  assert.notEqual(decrypted.access_token, access);
  assert.ok(!JSON.stringify((await f.summit.request('/api/state')).data).includes(refresh));
});
test('a live API denial disables access and deletes the saved Service App tokens', async t => {
  const f = await fixture(t, 'live', { directory: async () => { throw new AppError(502, 'Denied', 'webex_denied'); } });
  f.store.run("UPDATE tenants SET org_id=?,webex_org_id=?,status='Connected',credentials=? WHERE id='summit'",
    'org', 'org', vault(f.config.ENCRYPTION_KEY).seal({ access_token: random(), expires_in: 3600, obtained_at: Date.now() }, 'summit'));
  assert.equal((await f.summit.request('/api/directory', {})).status, 502);
  const row = f.store.get("SELECT * FROM tenants WHERE id='summit'");
  assert.equal(row.status, 'Disconnected'); assert.equal(row.credentials, null);
});
test('signed lifecycle events use authorizerOrgId and recheck access instead of guessing event order', async t => {
  let revoked = false;
  const f = await fixture(t, 'live', { organization: async id => {
    if (revoked) throw new AppError(502, 'Revoked', 'webex_denied');
    return { id, name: 'Current organization' };
  } });
  const encodedOrg = Buffer.from('ciscospark://us/ORGANIZATION/customer-org').toString('base64url');
  const connectedAt = Date.now();
  f.store.run("UPDATE tenants SET org_id=?,webex_org_id=?,status='Connected',credentials=?,connected_at=? WHERE id='summit'",
    'customer-org', encodedOrg, vault(f.config.ENCRYPTION_KEY).seal({ access_token: random() }, 'summit'), connectedAt);
  const event = { resource: 'serviceApp', event: 'deauthorized', orgId: 'provider-org',
    data: { id: f.config.SERVICE_APP_ID, authorizerOrgId: encodedOrg }, created: new Date(connectedAt - 10000).toISOString() };
  const send = () => f.provider.request('/api/webhooks/service-app', event, {
    'x-spark-signature': createHmac('sha1', f.config.WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex'),
  });
  assert.equal((await f.provider.request('/api/webhooks/service-app', event, { 'x-spark-signature': '0'.repeat(40) })).status, 403);
  assert.equal((await send()).status, 200);
  assert.equal(f.store.get("SELECT status FROM tenants WHERE id='summit'").status, 'Connected');
  revoked = true;
  assert.equal((await send()).status, 200);
  assert.equal(f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials, null);
  event.event = 'authorized';
  assert.equal((await send()).status, 200);
  assert.equal(f.store.get("SELECT status FROM tenants WHERE id='summit'").status, 'Disconnected');
});
test('a failed old directory request cannot erase credentials from a newer connection', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const fresh = () => ({ access_token: random(), refresh_token: random(), obtained_at: Date.now(), expires_in: 3600 });
  const fake = {
    directory: async () => { entered.resolve(); await release.promise; throw new AppError(502, 'Old access denied', 'webex_denied'); },
    exchange: async () => fresh(),
    identity: async () => ({ personId: 'admin', orgId: 'org-one', name: 'Administrator' }),
    serviceTokens: async () => fresh(),
    organization: async () => ({ id: 'org-one', name: 'Organization one' }),
  };
  const f = await fixture(t, 'live', fake);
  const box = vault(f.config.ENCRYPTION_KEY);
  f.store.setting('provider_tokens', box.seal(fresh(), 'provider'));
  f.store.run("UPDATE tenants SET org_id=?,webex_org_id=?,status='Connected',credentials=? WHERE id='summit'",
    'org-one', 'org-one', box.seal(fresh(), 'summit'));
  const oldRequest = f.summit.request('/api/directory', {});
  await entered.promise;
  await f.summit.request('/api/disconnect', { confirm: true });
  const start = await f.summit.request('/api/oauth/customer', {});
  const state = new URL(start.data.url).searchParams.get('state');
  assert.equal((await f.summit.request(`/oauth/customer/callback?state=${state}&code=opaque-test-code`)).status, 303);
  assert.equal((await f.summit.request('/api/connect', { orgId: 'org-one', confirm: true })).status, 200);
  const newer = f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials;
  release.resolve();
  assert.equal((await oldRequest).status, 502);
  const row = f.store.get("SELECT * FROM tenants WHERE id='summit'");
  assert.equal(row.status, 'Connected'); assert.equal(row.credentials, newer);
});

test('first-run provider setup requires the terminal code, rotates the session, and cannot be repeated', async t => {
  const setupToken = random(), password = random();
  const f = await fixture(t, 'live', undefined, { empty: true, managedConfiguration: true, setupToken });
  const initial = (await f.provider.request('/api/session')).data;
  assert.equal(initial.setupRequired, true);
  assert.equal((await f.provider.request('/api/setup', { setupToken: random(), email: 'owner@example.test', password })).status, 403);
  const created = await f.provider.request('/api/setup', { setupToken, email: 'owner@example.test', password });
  assert.equal(created.status, 201);
  const session = await f.provider.request('/api/session');
  assert.notEqual(session.data.csrf, initial.csrf);
  assert.equal(session.data.setupRequired, false);
  assert.equal(session.data.account.role, 'provider');
  assert.equal((await f.provider.request('/api/setup', { setupToken, email: 'other@example.test', password })).status, 409);
  assert.equal((await f.provider.request('/api/provider/customer', { tenantId: 'summit', email: 'customer@example.test', password })).status, 201);
  const customer = f.client(); await customer.request('/api/session');
  assert.equal((await customer.request('/api/login', { email: 'customer@example.test', password })).status, 200);
  await customer.request('/api/session');
  assert.equal((await customer.request('/api/provider/settings', {})).status, 403);
  assert.equal((await customer.request('/api/state')).data.providerSetup, undefined);
});

test('provider credentials are encrypted, write-only, validated, and cannot change under a connected customer', async t => {
  const f = await fixture(t, 'demo', undefined, { managedConfiguration: true });
  const secret = random();
  const body = { SERVICE_APP_ID: 'replacement-app', SERVICE_APP_CLIENT_ID: 'replacement-client', SERVICE_APP_CLIENT_SECRET: secret };
  assert.equal((await f.summit.request('/api/provider/settings', body)).status, 403);
  assert.equal((await f.provider.request('/api/provider/settings', { ...body, BASE_URL: 'https://evil.example' })).status, 400);
  assert.equal((await f.provider.request('/api/provider/settings', body)).status, 200);
  const sealed = f.store.setting('provider_configuration');
  assert.ok(!sealed.includes(secret));
  assert.equal(vault(f.config.ENCRYPTION_KEY).open(sealed, 'provider-configuration').SERVICE_APP_CLIENT_SECRET, secret);
  assert.ok(!JSON.stringify((await f.provider.request('/api/state')).data).includes(secret));
  assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_CLIENT_SECRET: '' })).status, 200);
  assert.equal(f.config.SERVICE_APP_CLIENT_SECRET, secret);
  await approve(f); await connect(f.summit);
  assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_CLIENT_SECRET: random() })).status, 409);
  assert.equal(f.config.SERVICE_APP_CLIENT_SECRET, secret);
});

test('the first provider OAuth pins the developer; stale callbacks and later identities cannot replace it', async t => {
  let person = 'first-developer';
  const fake = {
    exchange: async () => ({ access_token: random(), refresh_token: random(), expires_in: 3600, obtained_at: Date.now() }),
    identity: async () => ({ personId: person, orgId: 'developer-org', name: 'Developer' }),
  };
  const f = await fixture(t, 'live', fake, { managedConfiguration: true, config: { PROVIDER_WEBEX_PERSON_ID: '' } });
  async function begin() {
    const started = await f.provider.request('/api/oauth/provider', {});
    assert.equal(started.status, 200);
    return `/oauth/provider/callback?state=${new URL(started.data.url).searchParams.get('state')}&code=test-code`;
  }
  assert.equal((await f.provider.request(await begin())).status, 303);
  assert.equal(f.config.PROVIDER_WEBEX_PERSON_ID, 'first-developer');
  person = 'different-developer';
  assert.equal((await f.provider.request(await begin())).status, 403);
  assert.equal(f.config.PROVIDER_WEBEX_PERSON_ID, 'first-developer');
  const stale = await begin();
  assert.equal((await f.provider.request('/api/provider/settings', { PROVIDER_INTEGRATION_CLIENT_SECRET: random() })).status, 200);
  assert.equal((await f.provider.request(stale)).status, 403);
  assert.equal(f.store.setting('provider_tokens'), undefined);
  const restoredConfig = { MODE: 'live', BASE_URL: f.config.BASE_URL, ENCRYPTION_KEY: f.config.ENCRYPTION_KEY };
  const restored = createApp(restoredConfig, f.store, { managedConfiguration: true });
  assert.equal(restoredConfig.SERVICE_APP_CLIENT_SECRET, f.config.SERVICE_APP_CLIENT_SECRET);
  assert.equal(restoredConfig.PROVIDER_INTEGRATION_CLIENT_SECRET, f.config.PROVIDER_INTEGRATION_CLIENT_SECRET);
  restored.close();
});

test('providers can save a Service App, an Integration, both, or neither without inventing missing credentials', async t => {
  const blank = Object.fromEntries(['SERVICE_APP_ID', 'SERVICE_APP_CLIENT_ID', 'SERVICE_APP_CLIENT_SECRET',
    'PROVIDER_INTEGRATION_CLIENT_ID', 'PROVIDER_INTEGRATION_CLIENT_SECRET', 'CUSTOMER_INTEGRATION_CLIENT_ID',
    'CUSTOMER_INTEGRATION_CLIENT_SECRET', 'PROVIDER_WEBEX_PERSON_ID', 'WEBHOOK_SECRET'].map(key => [key, '']));
  const service = { SERVICE_APP_ID: 'existing-app', SERVICE_APP_CLIENT_ID: 'service-client', SERVICE_APP_CLIENT_SECRET: random() };
  const integration = { PROVIDER_INTEGRATION_CLIENT_ID: 'provider-client', PROVIDER_INTEGRATION_CLIENT_SECRET: random() };
  for (const body of [{}, service, integration, { ...service, ...integration }]) {
    const f = await fixture(t, 'live', undefined, { managedConfiguration: true, config: blank });
    assert.equal((await f.provider.request('/api/provider/settings', body)).status, 200);
    const state = (await f.provider.request('/api/state')).data;
    assert.equal(state.configuration.serviceApp, !!body.SERVICE_APP_ID);
    assert.equal(state.configuration.providerOAuth, !!body.PROVIDER_INTEGRATION_CLIENT_ID);
    assert.equal(state.configuration.customerOAuth, false);
    const before = f.store.setting('provider_configuration');
    assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_ID: 'incomplete' })).status, 400);
    assert.equal(f.store.setting('provider_configuration'), before);
  }
});

test('registration changes during an OAuth exchange cannot store the old token or developer identity', async t => {
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const exchanging = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, 'live', {
    exchange: async () => { started(); await waiting; return { access_token: random(), refresh_token: random(), expires_in: 3600 }; },
    identity: async () => ({ personId: 'old-developer', orgId: 'developer-org', name: 'Developer' }),
  }, { managedConfiguration: true, config: { PROVIDER_WEBEX_PERSON_ID: '' } });
  const start = await f.provider.request('/api/oauth/provider', {});
  const state = new URL(start.data.url).searchParams.get('state');
  const callback = f.provider.request(`/oauth/provider/callback?state=${state}&code=test-code`);
  await exchanging;
  try {
    assert.equal((await f.provider.request('/api/provider/settings', { PROVIDER_INTEGRATION_CLIENT_SECRET: random() })).status, 200);
  } finally { release(); }
  assert.equal((await callback).status, 409);
  assert.equal(f.store.setting('provider_tokens'), undefined);
  assert.equal(f.config.PROVIDER_WEBEX_PERSON_ID, '');
});
