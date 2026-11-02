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
test('local workspaces need no account and switch with session rotation and tenant isolation', async t => {
  const f = await fixture(t, 'demo', undefined, { empty: true, localAccess: true, managedConfiguration: true });
  const client = f.client();
  let session = (await client.request('/api/session')).data;
  assert.equal(session.setupRequired, false);
  assert.equal(session.account.role, 'provider');
  assert.deepEqual(session.perspectives.map(p => p.id), ['provider', 'northstar', 'summit']);
  assert.equal(f.store.get('SELECT count(*) AS n FROM accounts').n, 0);
  await client.request('/api/demo/provider', {});
  await client.request('/api/demo/authorization', { orgId: 'demo-summit', authorized: true });
  assert.equal((await client.request('/api/local/perspective', { perspective: 'summit' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await client.request('/api/local/perspective', { perspective: 'unknown' })).status, 400);
  assert.equal((await client.request('/api/local/perspective', { perspective: 'summit', role: 'provider' })).status, 400);
  const previous = session.csrf;
  const switched = await client.request('/api/local/perspective', { perspective: 'summit' });
  assert.equal(switched.status, 200);
  assert.ok(switched.headers.get('set-cookie'));
  assert.equal((await client.request('/api/state')).data.tenants[0].id, 'summit');
  assert.equal((await client.request('/api/demo/provider', {})).status, 403, 'Old CSRF token must fail');
  session = (await client.request('/api/session')).data;
  assert.notEqual(session.csrf, previous);
  assert.equal((await client.request('/api/provider/settings', {})).status, 403);
  assert.equal((await client.request('/api/connect', { orgId: 'demo-summit', confirm: true })).status, 409, 'Perspective selection is not Webex proof');
  assert.equal((await connect(client)).status, 200);
  await client.request('/api/demo/verify', { orgId: 'demo-summit', authority: 'admin' });
  await client.request('/api/local/perspective', { perspective: 'northstar' });
  await client.request('/api/session');
  const northstar = (await client.request('/api/state')).data;
  assert.equal(northstar.tenants.length, 1);
  assert.equal(northstar.tenants[0].id, 'northstar');
  assert.equal(northstar.proof, null);
  assert.equal((await client.request('/api/directory', {})).status, 409);
  assert.equal((await connect(client)).data.code, 'claim_conflict');
  await client.request('/api/local/perspective', { perspective: 'summit' });
  await client.request('/api/session');
  assert.equal((await client.request('/api/state')).data.proof, null);
  assert.equal((await client.request('/api/directory', {})).status, 200);
  for (const path of ['/api/login', '/api/setup', '/api/logout', '/api/provider/customer']) {
    assert.equal((await client.request(path, {})).status, 404);
  }
});
test('public origins cannot enable local access and authenticated mode has no perspective switch', async t => {
  const f = await fixture(t);
  assert.equal((await f.provider.request('/api/session')).data.localAccess, false);
  assert.equal((await f.provider.request('/api/local/perspective', { perspective: 'summit' })).status, 404);
  assert.throws(() => createApp({ ...f.config, BASE_URL: 'https://sample.example' }, f.store, { localAccess: true }), /loopback origin/);
});
test('switching local perspectives invalidates pending Webex OAuth', async t => {
  const f = await fixture(t, 'live', { exchange() { throw new Error('Must not exchange stale OAuth'); } },
    { empty: true, localAccess: true, managedConfiguration: true });
  const client = f.client(); await client.request('/api/session');
  await client.request('/api/local/perspective', { perspective: 'summit' });
  await client.request('/api/session');
  const started = await client.request('/api/oauth/customer', {});
  const state = new URL(started.data.url).searchParams.get('state');
  await client.request('/api/local/perspective', { perspective: 'northstar' });
  await client.request('/api/session');
  assert.equal((await client.request(`/oauth/customer/callback?state=${encodeURIComponent(state)}&code=fixture`)).status, 403);
});
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

test('Service App display details persist without replacing credentials or exposing them to customers', async t => {
  const f = await fixture(t, 'demo', undefined, { managedConfiguration: true });
  const details = { SERVICE_APP_NAME: 'Sample Directory Service App',
    SERVICE_APP_MANAGE_URL: 'https://developer.webex.com/my-apps/sample-directory-service-app' };
  const providerTokens = vault(f.config.ENCRYPTION_KEY).seal({ access_token: random() }, 'provider');
  f.store.setting('provider_tokens', providerTokens);
  await approve(f); await connect(f.summit);
  const credentials = f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials;
  assert.equal((await f.summit.request('/api/provider/settings', details)).status, 403);
  assert.equal((await f.provider.request('/api/provider/settings', details)).status, 200);
  assert.equal(f.store.setting('provider_tokens'), providerTokens);
  assert.equal(f.config.PROVIDER_WEBEX_PERSON_ID, 'developer-person');
  assert.equal(f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials, credentials);
  assert.deepEqual((await f.provider.request('/api/state')).data.providerSetup.serviceApp,
    { name: details.SERVICE_APP_NAME, manageUrl: details.SERVICE_APP_MANAGE_URL });
  assert.equal((await f.summit.request('/api/state')).data.providerSetup, undefined);
  for (const link of ['javascript:alert(1)', 'https://evil.example/my-apps/sample',
    'https://developer.webex.com.evil.example/my-apps/sample', 'https://developer.webex.com/my-apps/sample?token=private',
    'https://user@developer.webex.com/my-apps/sample', 'https://developer.webex.com/my-apps/../sample']) {
    assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_MANAGE_URL: link })).status, 400);
  }
  assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_NAME: 'x'.repeat(201) })).status, 400);
  const restoredConfig = { MODE: 'demo', BASE_URL: f.config.BASE_URL, ENCRYPTION_KEY: f.config.ENCRYPTION_KEY };
  const restored = createApp(restoredConfig, f.store, { managedConfiguration: true });
  assert.equal(restoredConfig.SERVICE_APP_NAME, details.SERVICE_APP_NAME);
  restored.close();
  await f.summit.request('/api/disconnect', { confirm: true });
  assert.equal((await f.provider.request('/api/provider/settings', { SERVICE_APP_ID: 'new-app',
    SERVICE_APP_CLIENT_ID: 'new-client', SERVICE_APP_CLIENT_SECRET: random() })).status, 200);
  assert.equal(f.config.SERVICE_APP_NAME, '');
  assert.equal(f.config.SERVICE_APP_MANAGE_URL, '');
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

test('Data Source lifecycle is confirmed, persistent, encrypted, and isolated to each customer', async t => {
  const f = await fixture(t);
  assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true })).status, 409);
  assert.equal((await f.provider.request('/api/data-source', { action: 'register', confirm: true })).status, 403);
  await approve(f); await approve(f, 'demo-northstar'); await connect(f.summit); await connect(f.northstar, 'demo-northstar');
  assert.equal((await f.summit.request('/api/data-source', { action: 'register' })).status, 400);
  assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true, orgId: 'demo-northstar' })).status, 400);
  const first = await f.summit.request('/api/data-source', { action: 'register', confirm: true });
  assert.equal(first.status, 200); assert.equal(first.data.dataSource.url, 'https://provider.example/customers/summit');
  assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true })).status, 409);
  assert.equal((await f.northstar.request('/api/state')).data.dataSource, null);
  const second = await f.northstar.request('/api/data-source', { action: 'register', confirm: true });
  assert.notEqual(first.data.dataSource.id, second.data.dataSource.id);
  assert.equal(second.data.dataSource.url, 'https://provider.example/customers/northstar');
  const row = f.store.get("SELECT record FROM data_sources WHERE tenant_id='summit'");
  assert.ok(!row.record.includes('provider.example'));
  assert.throws(() => vault(f.config.ENCRYPTION_KEY).open(row.record, 'datasource:northstar'));
  const before = vault(f.config.ENCRYPTION_KEY).open(row.record, 'datasource:summit');
  assert.equal((await f.summit.request('/api/data-source', { action: 'renew' })).status, 200);
  const after = vault(f.config.ENCRYPTION_KEY).open(f.store.get("SELECT record FROM data_sources WHERE tenant_id='summit'").record, 'datasource:summit');
  assert.notEqual(after.nonce, before.nonce);
  const state = (await f.summit.request('/api/state')).data;
  assert.equal(state.dataSource.matchesConnection, true);
  assert.ok(!JSON.stringify(state).includes(after.nonce));
  assert.equal((await f.provider.request('/api/state')).data.dataSource, null);
  await f.summit.request('/api/logout', {}); await f.summit.login('summit@example.test');
  assert.equal((await f.summit.request('/api/state')).data.dataSource.id, first.data.dataSource.id);
  assert.equal((await f.summit.request('/api/data-source', { action: 'read' })).status, 200);
  assert.equal((await f.summit.request('/api/data-source', { action: 'remove' })).status, 400);
  assert.equal((await f.summit.request('/api/data-source', { action: 'remove', confirm: true })).status, 200);
  assert.equal((await f.summit.request('/api/state')).data.dataSource, null);
  assert.equal((await f.summit.request('/api/directory', {})).status, 200);
  assert.equal((await f.northstar.request('/api/state')).data.dataSource.id, second.data.dataSource.id);
});

test('disconnect retains the registration, and another organization cannot manage it', async t => {
  const f = await fixture(t, 'demo', undefined, { managedConfiguration: true });
  await approve(f); await approve(f, 'demo-northstar'); await connect(f.summit);
  await f.summit.request('/api/data-source', { action: 'register', confirm: true });
  await f.summit.request('/api/disconnect', { confirm: true });
  assert.equal((await f.summit.request('/api/state')).data.dataSource.matchesConnection, false);
  assert.equal((await f.provider.request('/api/provider/settings', { DATASOURCE_SCHEMA_ID: '5397013b-7920-4ffc-807c-e8a3e0a18f43', DATASOURCE_BASE_URL: 'https://replacement.example' })).status, 409);
  await connect(f.summit, 'demo-northstar');
  for (const action of ['read', 'renew', 'remove']) assert.equal((await f.summit.request('/api/data-source', { action, confirm: true })).status, 409);
  await f.summit.request('/api/disconnect', { confirm: true });
  await connect(f.summit);
  assert.equal((await f.summit.request('/api/data-source', { action: 'remove', confirm: true })).status, 200);
});

test('live Data Sources use Service App tokens, discard delivery tokens, and block disconnect during a write', async t => {
  const entering = Promise.withResolvers(), release = Promise.withResolvers(), access = random(), jws = random();
  let calls = 0;
  const f = await fixture(t, 'live', { dataSource: async (action, id, payload, token) => {
    calls++; assert.equal(action, 'register'); assert.equal(token, access); assert.equal(id, undefined);
    assert.equal(payload.url, 'https://provider.example/connector/customers/summit');
    assert.equal(payload.orgId, undefined); assert.equal(payload.tokenLifetimeMinutes, 60);
    entering.resolve(); await release.promise;
    return { id: 'live-source', orgId: 'org-one', ...payload, jwsToken: jws, status: 'active' };
  } }, { config: { DATASOURCE_SCHEMA_ID: '5397013b-7920-4ffc-807c-e8a3e0a18f43', DATASOURCE_BASE_URL: 'https://provider.example/connector' } });
  const box = vault(f.config.ENCRYPTION_KEY);
  f.store.run("UPDATE tenants SET org_id=?,webex_org_id=?,status='Connected',credentials=? WHERE id='summit'",
    'org-one', Buffer.from('ciscospark://us/ORGANIZATION/org-one').toString('base64'), box.seal({ access_token: access, obtained_at: Date.now(), expires_in: 3600 }, 'summit'));
  const pending = f.summit.request('/api/data-source', { action: 'register', confirm: true });
  await entering.promise;
  try {
    assert.equal((await f.summit.request('/api/disconnect', { confirm: true })).status, 409);
    assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true })).status, 409);
  } finally { release.resolve(); }
  const result = await pending; assert.equal(result.status, 200); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result.data).includes(jws));
  const state = (await f.summit.request('/api/state')).data;
  assert.equal(state.dataSource.matchesConnection, true);
  assert.ok(!JSON.stringify(state).includes(access));
  assert.ok(!JSON.stringify(box.open(f.store.get("SELECT record FROM data_sources WHERE tenant_id='summit'").record, 'datasource:summit')).includes(jws));
});

test('missing Data Source scope keeps the working organization link and directory credentials', async t => {
  const f = await fixture(t, 'live', { dataSource: async () => { throw new AppError(502, 'Data Source scope required', 'datasource_denied'); } },
    { config: { DATASOURCE_SCHEMA_ID: '5397013b-7920-4ffc-807c-e8a3e0a18f43', DATASOURCE_BASE_URL: 'https://provider.example' } });
  const sealed = vault(f.config.ENCRYPTION_KEY).seal({ access_token: random(), obtained_at: Date.now(), expires_in: 3600 }, 'summit');
  f.store.run("UPDATE tenants SET org_id='org-one',webex_org_id='org-one',status='Connected',credentials=? WHERE id='summit'", sealed);
  assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true })).data.code, 'datasource_denied');
  assert.equal(f.store.get("SELECT credentials FROM tenants WHERE id='summit'").credentials, sealed);
  assert.equal(f.store.get("SELECT tenant_id FROM data_sources WHERE tenant_id='summit'"), undefined);
});

test('Data Source response checks reject a mismatched organization, endpoint, or schema', async t => {
  let altered;
  const f = await fixture(t, 'live', { dataSource: async (_action, _id, payload) => ({ id: 'source-id', ...payload, ...altered }) },
    { config: { DATASOURCE_SCHEMA_ID: '5397013b-7920-4ffc-807c-e8a3e0a18f43', DATASOURCE_BASE_URL: 'https://provider.example' } });
  const sealed = vault(f.config.ENCRYPTION_KEY).seal({ access_token: random(), obtained_at: Date.now(), expires_in: 3600 }, 'summit');
  f.store.run("UPDATE tenants SET org_id='org-one',webex_org_id='org-one',status='Connected',credentials=? WHERE id='summit'", sealed);
  for (altered of [{ orgId: 'org-two' }, { url: 'https://provider.example/customers/northstar' }, { schemaId: 'different-schema' }]) {
    assert.equal((await f.summit.request('/api/data-source', { action: 'register', confirm: true })).status, 502);
    assert.equal(f.store.get("SELECT tenant_id FROM data_sources WHERE tenant_id='summit'"), undefined);
  }
});
