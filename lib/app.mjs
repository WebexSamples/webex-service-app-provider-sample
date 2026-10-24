import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, requireThat, random, vault, verifyPassword, hashPassword, orgKey } from './security.mjs';
import { createWebex, authorizationUrl } from './webex.mjs';

const FIVE_MINUTES = 5 * 60 * 1000;
const safeTenant = t => ({ id: t.id, name: t.name, orgId: t.webex_org_id, orgName: t.org_name,
  status: t.status, verifiedBy: t.verified_by, connectedAt: t.connected_at, lastChecked: t.last_checked });
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
].map(([route, [file, type]]) => [route, { type, body: readFileSync(fileURLToPath(new URL(`../public/${file}`, import.meta.url))) }]));

export function createApp(config, store, options = {}) {
  requireThat(['demo', 'live'].includes(config.MODE), 500, 'MODE must be demo or live.');
  const origin = new URL(config.BASE_URL);
  requireThat(origin.href === `${origin.origin}/` && !origin.username && !origin.password,
    500, 'BASE_URL must be an origin without a path.');
  requireThat(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)),
    500, 'Use HTTPS, except on loopback.');
  const existingMode = store.setting('mode');
  requireThat(!existingMode || existingMode === config.MODE, 500, 'Use separate databases for live and demo modes.');
  store.setting('mode', config.MODE);
  const secretBox = vault(config.ENCRYPTION_KEY);
  const webex = options.webex || createWebex(config);
  const sessions = new Map(), oauth = new Map(), loginAttempts = new Map(), flights = new Map(), linking = new Set();
  const dummyHash = hashPassword(random());
  const tenant = id => store.get('SELECT * FROM tenants WHERE id=?', id);
  const audit = (s, action, detail = '') => store.audit(s.account.id, s.account.tenant_id, action, detail);

  function freshSession(res, previous) {
    if (previous) sessions.delete(previous.id);
    const s = { id: random(), csrf: random(), created: Date.now(), seen: Date.now(), account: null };
    sessions.set(s.id, s);
    res.setHeader('Set-Cookie', `id=${s.id}; HttpOnly; SameSite=Lax; Path=/${origin.protocol === 'https:' ? '; Secure' : ''}`);
    return s;
  }
  function getSession(req) {
    const id = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('id='))?.slice(3);
    const s = sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.seen > 30 * 60 * 1000 || Date.now() - s.created > 8 * 60 * 60 * 1000) {
      sessions.delete(id); return null;
    }
    s.seen = Date.now(); return s;
  }
  function role(s, expected) {
    requireThat(s?.account, 401, 'Sign in to continue.');
    requireThat(s.account.role === expected, 403, 'This account cannot perform that action.');
  }
  function proof(s, identity, revision) {
    const t = tenant(s.account.tenant_id);
    requireThat(t.revision === revision, 409, 'The connection changed. Verify with Webex again.');
    s.proof = { ...identity, key: orgKey(identity.orgId), revision, expires: Date.now() + FIVE_MINUTES };
    if (!t.credentials) store.run("UPDATE tenants SET status='Awaiting authorization' WHERE id=?", t.id);
    audit(s, 'identity_verified', identity.orgId);
  }
  async function singleFlight(key, action) {
    if (!flights.has(key)) flights.set(key, action().finally(() => flights.delete(key)));
    return flights.get(key);
  }
  async function providerTokens() {
    return singleFlight('provider-token', async () => {
      const sealed = store.setting('provider_tokens');
      requireThat(sealed, 409, 'The provider must connect its token-management Integration first.');
      let tokens = secretBox.open(sealed, 'provider');
      if (Date.now() >= tokens.obtained_at + (tokens.expires_in - 60) * 1000) {
        tokens = await webex.refresh(tokens, 'provider');
        requireThat(store.setting('provider_tokens') === sealed, 409, 'Provider credentials changed. Retry.');
        store.setting('provider_tokens', secretBox.seal(tokens, 'provider'));
      }
      return tokens;
    });
  }
  function invalidate(t, actor, reason) {
    const result = store.run("UPDATE tenants SET status='Disconnected',credentials=NULL,revision=revision+1 WHERE id=? AND revision=? AND status='Connected'", t.id, t.revision);
    if (result.changes) store.audit(actor, t.id, reason);
  }
  async function rawBody(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      requireThat(length <= 32768, 413, 'Request too large.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  function redirect(res, status) {
    res.writeHead(303, { Location: `/?notice=${encodeURIComponent(status)}` }); res.end();
  }
  async function webhook(req, res) {
    requireThat(config.MODE === 'live' && config.WEBHOOK_SECRET, 404, 'Not found.');
    const body = await rawBody(req);
    const signature = req.headers['x-spark-signature'];
    requireThat(typeof signature === 'string' && /^[a-f0-9]{40}$/i.test(signature), 403, 'Invalid webhook signature.');
    const expected = createHmac('sha1', config.WEBHOOK_SECRET).update(body).digest();
    requireThat(timingSafeEqual(expected, Buffer.from(signature, 'hex')), 403, 'Invalid webhook signature.');
    let event;
    try { event = JSON.parse(body); } catch { throw new AppError(400, 'Invalid JSON.'); }
    requireThat(event?.resource === 'serviceApp' && ['authorized', 'deauthorized'].includes(event.event)
      && event.data?.id === config.SERVICE_APP_ID && event.data.authorizerOrgId,
    400, 'Unexpected Service App event.');
    const key = orgKey(event.data.authorizerOrgId);
    const t = store.get('SELECT * FROM tenants WHERE org_id=?', key);
    if (t?.credentials && event.event === 'deauthorized' && t.status === 'Connected') {
      // The envelope is not an ordered event log. Check existing access before
      // allowing a delayed notification to discard a newer connection's tokens.
      await singleFlight(`lifecycle:${t.id}`, async () => {
        const saved = secretBox.open(t.credentials, t.id);
        try { await webex.organization(t.webex_org_id, saved.access_token); }
        catch (error) {
          if (error.code !== 'webex_denied') throw error;
          if (tenant(t.id).revision === t.revision) invalidate(t, 'webex', 'service_app_deauthorized');
        }
      });
    }
    // Authorization notifications never claim a tenant or retrieve credentials.
    json(res, 200, { received: true });
  }

  async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    if (origin.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let s;
    try {
      // Prevent DNS rebinding and do not derive redirects from untrusted Host headers.
      requireThat(req.headers.host === origin.host, 400, 'Unexpected host. Use the configured BASE_URL.');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); res.end(asset.body); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/webhooks/service-app') return await webhook(req, res);
      s = getSession(req);
      if (req.method === 'GET' && url.pathname === '/api/session') {
        // Bound anonymous state and expire old OAuth attempts without a background worker.
        for (const [key, value] of oauth) if (value.expires < Date.now()) oauth.delete(key);
        for (const [key, value] of sessions) if (Date.now() - value.seen > 30 * 60 * 1000) sessions.delete(key);
        requireThat(s || sessions.size < 1000, 429, 'Too many active sessions. Retry later.');
        s ||= freshSession(res);
        return json(res, 200, { csrf: s.csrf, mode: config.MODE, account: s.account && {
          name: s.account.name, email: s.account.email, role: s.account.role }, baseUrl: config.BASE_URL });
      }
      if (req.method === 'GET' && /^\/oauth\/(customer|provider)\/callback$/.test(url.pathname)) {
        const state = url.searchParams.get('state'), attempt = oauth.get(state);
        oauth.delete(state);
        const kind = url.pathname.split('/')[2];
        requireThat(attempt && s?.account && attempt.session === s.id && attempt.kind === kind
          && attempt.expires > Date.now(), 403, 'OAuth state expired, was already used, or belongs to another session.');
        role(s, kind);
        requireThat(!url.searchParams.has('error') && url.searchParams.get('code'), 400, 'Webex authorization was cancelled or denied.');
        const tokens = await webex.exchange(kind, url.searchParams.get('code'));
        const identity = await webex.identity(tokens.access_token, kind === 'customer');
        requireThat(sessions.get(s.id) === s, 401, 'Your session ended. Sign in and retry.');
        if (kind === 'provider') {
          requireThat(config.PROVIDER_WEBEX_PERSON_ID && identity.personId === config.PROVIDER_WEBEX_PERSON_ID,
            403, 'Use the configured Webex developer account that owns the Service App.');
          requireThat(tokens.refresh_token, 502, 'Webex did not return a provider refresh token.');
          store.setting('provider_tokens', secretBox.seal(tokens, 'provider'));
          audit(s, 'provider_oauth_connected');
        } else {
          proof(s, identity, attempt.revision);
          // Customer OAuth tokens are intentionally discarded after identity and role verification.
        }
        return redirect(res, kind === 'provider' ? 'Provider Integration connected.' : 'Webex identity verified. Review and confirm the organization link.');
      }
      requireThat(s, 401, 'Open the app and sign in.');
      let body;
      if (req.method === 'POST') {
        requireThat(req.headers.origin === origin.origin && req.headers['x-csrf-token'] === s.csrf,
          403, 'Request verification failed. Reload the page.');
        requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Send application/json.');
        try { body = JSON.parse(await rawBody(req)); } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, 'Invalid JSON.');
        }
        requireThat(body && typeof body === 'object' && !Array.isArray(body), 400, 'Send a JSON object.');
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress;
        const attempts = loginAttempts.get(ip) || { count: 0, until: Date.now() + 60 * 1000 };
        if (attempts.until <= Date.now()) { attempts.count = 0; attempts.until = Date.now() + 60 * 1000; }
        attempts.count++; loginAttempts.set(ip, attempts);
        requireThat(attempts.count <= 10, 429, 'Too many sign-in attempts. Wait one minute.');
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const account = store.get('SELECT * FROM accounts WHERE email=?', email);
        const valid = verifyPassword(body.password, account?.password_hash || dummyHash);
        requireThat(account && valid, 401, 'Email or password is incorrect.');
        s = freshSession(res, s); s.account = account;
        audit(s, 'signed_in'); return json(res, 200, { ok: true });
      }
      requireThat(s.account, 401, 'Sign in to continue.');
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        audit(s, 'signed_out'); sessions.delete(s.id);
        res.setHeader('Set-Cookie', `id=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${origin.protocol === 'https:' ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const isProvider = s.account.role === 'provider';
        const tenants = isProvider ? store.all('SELECT * FROM tenants ORDER BY name') : [tenant(s.account.tenant_id)];
        const events = isProvider
          ? store.all('SELECT at,tenant_id,action,detail FROM audit ORDER BY id DESC LIMIT 30')
          : store.all('SELECT at,tenant_id,action,detail FROM audit WHERE tenant_id=? ORDER BY id DESC LIMIT 12', s.account.tenant_id);
        const p = s.proof?.expires > Date.now() && s.proof.revision === tenants[0].revision ? s.proof : null;
        return json(res, 200, { tenants: tenants.map(t => {
          const saved = t.credentials ? secretBox.open(t.credentials, t.id) : null;
          return { ...safeTenant(t), credentialExpiresAt: saved?.expires_in ? saved.obtained_at + saved.expires_in * 1000 : null };
        }), events, providerConnected: config.MODE === 'demo'
          ? store.setting('demo_provider') === 'connected' : !!store.setting('provider_tokens'),
        configuration: isProvider ? { serviceApp: !!(config.SERVICE_APP_ID && config.SERVICE_APP_CLIENT_SECRET && config.SERVICE_APP_CLIENT_ID),
          providerOAuth: !!(config.PROVIDER_INTEGRATION_CLIENT_ID && config.PROVIDER_INTEGRATION_CLIENT_SECRET && config.PROVIDER_WEBEX_PERSON_ID),
          customerOAuth: !!(config.CUSTOMER_INTEGRATION_CLIENT_ID && config.CUSTOMER_INTEGRATION_CLIENT_SECRET),
          webhook: !!config.WEBHOOK_SECRET } : undefined,
        proof: !isProvider && p ? { orgId: p.orgId, name: p.name, expires: p.expires } : null,
        demoOrgs: config.MODE === 'demo' ? store.all('SELECT * FROM demo_orgs ORDER BY name') : undefined });
      }
      if (req.method === 'POST' && /^\/api\/oauth\/(customer|provider)$/.test(url.pathname)) {
        const kind = url.pathname.split('/')[3]; role(s, kind);
        requireThat(config.MODE === 'live', 409, 'Use the labeled demo verification controls in demo mode.');
        requireThat(oauth.size < 1000, 429, 'Too many pending connections. Retry later.');
        if (kind === 'provider') requireThat(config.PROVIDER_WEBEX_PERSON_ID, 409, 'Configure PROVIDER_WEBEX_PERSON_ID first.');
        const state = random(), link = authorizationUrl(config, kind, state);
        delete s.proof;
        oauth.set(state, { session: s.id, kind, expires: Date.now() + 2 * FIVE_MINUTES,
          revision: s.account.tenant_id ? tenant(s.account.tenant_id).revision : null });
        return json(res, 200, { url: link });
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/provider') {
        role(s, 'provider'); requireThat(config.MODE === 'demo', 404, 'Not found.');
        store.setting('demo_provider', 'connected'); audit(s, 'demo_provider_connected');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/authorization') {
        role(s, 'provider'); requireThat(config.MODE === 'demo', 404, 'Not found.');
        requireThat(typeof body.orgId === 'string' && store.get('SELECT id FROM demo_orgs WHERE id=?', body.orgId) && typeof body.authorized === 'boolean',
          400, 'Select a demo organization and authorization state.');
        store.run('UPDATE demo_orgs SET authorized=? WHERE id=?', Number(body.authorized), body.orgId);
        const t = store.get('SELECT * FROM tenants WHERE org_id=?', body.orgId);
        if (t && !body.authorized) invalidate(t, s.account.id, 'demo_service_app_deauthorized');
        store.audit(s.account.id, t?.id || null, 'demo_authorization_changed', `${body.orgId}: ${body.authorized}`);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/verify') {
        role(s, 'customer'); requireThat(config.MODE === 'demo', 404, 'Not found.');
        delete s.proof;
        requireThat(typeof body.orgId === 'string', 400, 'Select a fixture organization.');
        const org = store.get('SELECT * FROM demo_orgs WHERE id=?', body.orgId);
        requireThat(org, 400, 'Select a fixture organization.');
        requireThat(body.authority === 'admin', 403, 'A Webex Full Administrator must connect this organization.', 'admin_required');
        proof(s, { personId: `fixture-admin-${org.id}`, orgId: org.id, name: `${org.name} administrator` }, tenant(s.account.tenant_id).revision);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/connect') {
        role(s, 'customer');
        const p = s.proof;
        requireThat(p && p.expires > Date.now(), 409, 'Verify your Webex administrator account first.');
        requireThat(body.orgId === p.orgId && body.confirm === true, 400, 'Confirm the verified organization.');
        const t = tenant(s.account.tenant_id);
        requireThat(t.revision === p.revision, 409, 'Connection changed. Verify with Webex again.');
        requireThat(!t.org_id || t.org_id === p.key, 409, 'Disconnect the existing organization before connecting a different one.');
        requireThat(!store.get('SELECT id FROM tenants WHERE org_id=? AND id<>?', p.key, t.id),
          409, 'This Webex organization is already linked to another provider account.', 'claim_conflict');
        requireThat(!linking.has(p.key) && !linking.has(t.id), 409, 'A connection is already in progress. Retry.');
        linking.add(p.key); linking.add(t.id); delete s.proof;
        try {
          let tokens, organization;
          if (config.MODE === 'demo') {
            requireThat(store.setting('demo_provider') === 'connected', 409, 'Connect the provider Integration in the provider console first.');
            const org = store.get('SELECT * FROM demo_orgs WHERE id=?', p.key);
            requireThat(org?.authorized, 409, 'The Service App is not authorized for this organization.', 'not_authorized');
            tokens = { access_token: random(), refresh_token: random(), expires_in: 3600, obtained_at: Date.now() };
            organization = { name: org.name };
          } else {
            // The documented endpoint enforces current authorization of this exact Service App.
            tokens = await webex.serviceTokens(p.orgId, (await providerTokens()).access_token);
            organization = await webex.organization(p.orgId, tokens.access_token);
          }
          requireThat(sessions.get(s.id) === s && p.expires > Date.now() && tenant(t.id).revision === p.revision,
            409, 'Session or connection changed during setup. Verify again.');
          store.run(`UPDATE tenants SET org_id=?,webex_org_id=?,org_name=?,status='Connected',credentials=?,verified_by=?,
            connected_at=?,last_checked=NULL,revision=revision+1 WHERE id=? AND revision=?`,
          p.key, p.orgId, organization.name, secretBox.seal(tokens, t.id), p.personId, Date.now(), t.id, p.revision);
          audit(s, 'organization_connected', p.orgId);
          delete s.directory;
          return json(res, 200, { ok: true });
        } finally { linking.delete(p.key); linking.delete(t.id); }
      }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        role(s, 'customer');
        const t = tenant(s.account.tenant_id);
        requireThat(body.confirm === true, 400, 'Confirm disconnect.');
        store.run(`UPDATE tenants SET org_id=NULL,webex_org_id=NULL,org_name=NULL,status='Disconnected',credentials=NULL,
          verified_by=NULL,connected_at=NULL,last_checked=NULL,revision=revision+1 WHERE id=?`, t.id);
        delete s.proof; delete s.directory; audit(s, 'organization_disconnected', t.org_id || '');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/directory') {
        role(s, 'customer');
        requireThat(body.more === undefined || typeof body.more === 'boolean', 400, 'The more flag must be a boolean.');
        const t = tenant(s.account.tenant_id);
        requireThat(t.status === 'Connected' && t.credentials, 409, 'Connect your Webex organization first.');
        if (body.more) requireThat(s.directory?.revision === t.revision && s.directory.next,
          409, 'Refresh the directory before loading another page.');
        requireThat(!flights.has(`directory:${t.id}`), 409, 'A directory request is already running. Retry shortly.');
        const page = await singleFlight(`directory:${t.id}`, async () => {
          let tokens = secretBox.open(t.credentials, t.id);
          try {
            if (config.MODE === 'live' && Date.now() >= tokens.obtained_at + (tokens.expires_in - 60) * 1000) {
              tokens = await webex.refresh(tokens, 'service');
              requireThat(tenant(t.id).revision === t.revision, 409, 'The connection changed. Refresh the page.');
              store.run('UPDATE tenants SET credentials=? WHERE id=? AND revision=?', secretBox.seal(tokens, t.id), t.id, t.revision);
            }
            let result;
            if (config.MODE === 'demo') {
              requireThat(store.get('SELECT authorized FROM demo_orgs WHERE id=?', t.org_id)?.authorized,
                403, 'The Service App is no longer authorized.', 'webex_denied');
              const offset = body.more ? s.directory.next : 0;
              const names = ['Alex Morgan', 'Casey Chen', 'Jordan Patel', 'Sam Rivera', 'Taylor Brooks', 'Riley Davis'];
              result = { people: names.slice(offset, offset + 3).map(name => ({ name,
                email: `${name.toLowerCase().replace(' ', '.')}@${t.id}.example` })), next: offset === 0 ? 3 : null };
            } else result = await webex.directory(t.webex_org_id, tokens.access_token, body.more ? s.directory.next : null);
            requireThat(tenant(t.id).revision === t.revision && sessions.get(s.id) === s,
              409, 'Connection or session changed. Refresh the page.');
            store.run('UPDATE tenants SET last_checked=? WHERE id=? AND revision=?', Date.now(), t.id, t.revision);
            return result;
          } catch (error) {
            if (error.code === 'webex_denied') invalidate(t, s.account.id, 'webex_access_denied');
            throw error;
          }
        });
        s.directory = { next: page.next, revision: t.revision };
        audit(s, 'directory_read', `${page.people.length} members on page`);
        return json(res, 200, { people: page.people, hasMore: !!page.next });
      }
      throw new AppError(404, 'Not found.');
    } catch (error) {
      if (s?.account && error instanceof AppError && [401, 403, 409].includes(error.status)) audit(s, 'action_denied', error.code);
      // Do not log requests, OAuth codes, raw API responses, passwords, or tokens.
      if (!(error instanceof AppError)) console.error('Request failed unexpectedly; sensitive details omitted.');
      if (!res.headersSent) json(res, error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'Unexpected server error.', code: error.code || 'internal_error' });
      else res.end();
    }
  }
  return { handler, close() { sessions.clear(); oauth.clear(); } };
}
