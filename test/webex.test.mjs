import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebex } from '../lib/webex.mjs';
const config = { SERVICE_APP_ID: 'app-one', SERVICE_APP_CLIENT_ID: 'client-one', SERVICE_APP_CLIENT_SECRET: 'private-secret' };
const application = () => ({ id: 'app-one', type: 'authorizedApp', createdBy: 'person-one', name: 'My app', authorizationsCount: 1,
  authorizationsList: [{ orgId: Buffer.from('ciscospark://us/ORGANIZATION/ABC-123').toString('base64'), orgName: 'Sandbox', authorizationDate: '2026-11-02' }], privateField: 'must-not-return' });
function client(data = application(), opts = {}) {
  const calls = [];
  const webex = createWebex(config, async (url, options) => {
    calls.push({ url: String(url), ...options });
    return new Response(JSON.stringify(String(url).endsWith('/people/me') ? { id: 'person-one', type: 'person' } : data), opts);
  });
  return { webex, calls };
}
test('internal read verifies creator/type, normalizes identities, strips unrelated fields and fixes origin', async () => {
  const { webex, calls } = client();
  const result = await webex.application('app-one', 'private-pat');
  assert.equal(result.organizations[0].id, 'abc-123');
  assert.equal(result.name, 'My app'); assert.equal(result.privateField, undefined);
  assert.deepEqual(calls.map(c => c.url), ['https://webexapis.com/v1/people/me', 'https://webexapis.com/v1/applications/app-one']);
  assert.equal(calls[0].headers.Authorization, 'Bearer private-pat'); assert.equal(calls[1].redirect, 'error');
});
test('rejects non-owner, wrong app/type, invalid identities, duplicate and incomplete lists', async () => {
  for (const patch of [{ createdBy: 'other' }, { id: 'wrong' }, { type: 'integration' }, { authorizationsCount: 2 },
    { authorizationsList: {} }, { authorizationsList: [null] }, { authorizationsList: [{ orgId: 'bad/id' }] },
    { authorizationsCount: 2, authorizationsList: [...application().authorizationsList, ...application().authorizationsList] }]) {
    await assert.rejects(client({ ...application(), ...patch }).webex.application('app-one', 'pat'));
  }
  await assert.rejects(client(application(), { headers: { Link: '<https://example.test>; rel="next"' } }).webex.application('app-one', 'pat'), /incomplete/);
  const empty = await client({ ...application(), authorizationsList: [], authorizationsCount: 0 }).webex.application('app-one', 'pat');
  assert.equal(empty.organizations.length, 0);
});
test('documented token retrieval sends selected org and service credentials; refresh retains an unrotated refresh token', async () => {
  const calls = [];
  const webex = createWebex(config, async (url, options) => {
    calls.push({ url: String(url), ...options });
    return new Response(JSON.stringify({ access_token: 'new-access', ...(calls.length === 1 ? { refresh_token: 'original-refresh', refresh_token_expires_in: 7200 } : {}), expires_in: 3600 }));
  });
  const tokens = await webex.serviceTokens('target-org', 'pat');
  assert.deepEqual(JSON.parse(calls[0].body), { clientId: 'client-one', clientSecret: 'private-secret', targetOrgId: 'target-org' });
  assert.equal(calls[0].url, 'https://webexapis.com/v1/applications/app-one/token');
  const fresh = await webex.refresh(tokens);
  assert.equal(fresh.refresh_token, 'original-refresh');
  assert.ok(fresh.refresh_token_expires_in <= 7200 && fresh.refresh_token_expires_in > 7190);
  const body = new URLSearchParams(calls[1].body);
  assert.equal(body.get('client_id'), 'client-one'); assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].headers.Authorization, undefined);
});
test('Webex errors and malformed tokens never expose upstream secrets', async () => {
  for (const status of [401, 403, 429, 500]) {
    const webex = createWebex(config, async () => new Response('private-server-body', { status }));
    await assert.rejects(webex.serviceTokens('org', 'private-pat'), error => !error.message.includes('private-') && error.upstreamStatus === status);
  }
  for (const body of [{}, { access_token: 'access', refresh_token: 'refresh', expires_in: -1 }, { access_token: 'a\nb', refresh_token: 'r', expires_in: 20 }]) {
    await assert.rejects(createWebex(config, async () => new Response(JSON.stringify(body))).serviceTokens('org', 'pat'));
  }
});

test('rotated refresh token without a lifetime does not inherit the previous token expiry', async () => {
  const webex = createWebex(config, async () => new Response(JSON.stringify({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 })));
  const tokens = await webex.refresh({ refresh_token: 'previous', obtained_at: Date.now(), refresh_token_expires_in: 100 });
  assert.equal(tokens.refresh_token, 'rotated');
  assert.equal(tokens.refresh_token_expires_in, undefined);
});
