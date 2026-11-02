import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppError, requireThat, random, vault } from './security.mjs';
import { createWebex } from './webex.mjs';
import { seedDemoOrganizations } from './store.mjs';
import { SERVICE_APP_FIELDS, serviceAppDetails } from './config.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html']], ['/app.js', ['public/app.js', 'text/javascript']], ['/style.css', ['public/style.css', 'text/css']],
  ['/vendor/momentum.js', ['node_modules/@momentum-design/components/dist/browser/index.js', 'text/javascript']],
  ['/vendor/theme.css', ['node_modules/@momentum-design/tokens/dist/css/theme/webex/light-stable.css', 'text/css']],
  ['/vendor/typography.css', ['node_modules/@momentum-design/tokens/dist/css/typography/complete.css', 'text/css']],
  ['/vendor/fonts/css/fonts.css', ['node_modules/@momentum-design/fonts/dist/css/fonts.css', 'text/css']],
  ['/vendor/fonts/inter/Inter.var.woff2', ['node_modules/@momentum-design/fonts/dist/inter/Inter.var.woff2', 'font/woff2']],
].map(([route, [file, type]]) => [route, { type, body: readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url))) }]));

export function createApp(config, store, options = {}) {
  requireThat(['demo', 'live'].includes(config.MODE), 500, 'MODE must be demo or live.');
  const origin = new URL(config.BASE_URL);
  requireThat(origin.href === `${origin.origin}/` && origin.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(origin.hostname), 500, 'This local console requires an HTTP loopback origin.');
  const mode = store.setting('mode');
  requireThat(!mode || mode === config.MODE, 500, 'Use separate databases for live and demo modes.');
  store.setting('mode', config.MODE);
  const box = vault(config.ENCRYPTION_KEY), sessions = new Map(), flights = new Set();
  const savedConfig = store.setting('provider_configuration');
  const preserved = savedConfig ? box.open(savedConfig, 'provider-configuration') : {};
  Object.assign(config, preserved);
  if (config.MODE === 'demo') {
    seedDemoOrganizations(store);
    for (const [key, value] of Object.entries({ SERVICE_APP_ID: 'demo-app', SERVICE_APP_CLIENT_ID: 'demo-client',
      SERVICE_APP_CLIENT_SECRET: 'demo-secret', SERVICE_APP_NAME: 'Service App Studio Demo' })) config[key] ||= value;
  }
  const webex = options.webex || createWebex(config);
  let revision = 0;
  const configured = () => SERVICE_APP_FIELDS.slice(0, 3).every(key => config[key]);
  const context = org => JSON.stringify(['service-app', config.SERVICE_APP_ID, config.SERVICE_APP_CLIENT_ID, org]);
  const snapshotContext = () => JSON.stringify(['application', config.SERVICE_APP_ID, config.SERVICE_APP_CLIENT_ID]);
  const tokenRow = org => store.get('SELECT credentials FROM managed_service_tokens WHERE app_id=? AND client_id=? AND org_id=?',
    config.SERVICE_APP_ID, config.SERVICE_APP_CLIENT_ID, org);
  const savedTokens = org => { const row = tokenRow(org); return row && box.open(row.credentials, context(org)); };
  const snapshot = () => {
    const saved = store.setting(snapshotContext());
    return saved ? box.open(saved, snapshotContext()) : null;
  };
  function remember(data) { store.setting(snapshotContext(), box.seal(data, snapshotContext())); }
  function expireSessions() {
    for (const [id, value] of sessions) if (Date.now() - value.seen > 30 * 60 * 1000 || Date.now() - value.created > 8 * 60 * 60 * 1000) {
      value.pat = null; sessions.delete(id);
    }
  }
  const expiryTimer = setInterval(expireSessions, 30000);
  expiryTimer.unref();
  function session(req, res, create = false) {
    expireSessions();
    const id = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('id='))?.slice(3);
    let s = sessions.get(id);
    if (!s && create) {
      requireThat(sessions.size < 1000, 429, 'Too many sessions. Restart the local app.');
      s = { id: random(), csrf: random(), created: Date.now(), seen: Date.now(), pat: null };
      sessions.set(s.id, s);
      res.setHeader('Set-Cookie', `id=${s.id}; HttpOnly; SameSite=Strict; Path=/`);
    }
    if (s) s.seen = Date.now();
    return s;
  }
  function stillCurrent(s, version, pat) {
    requireThat(sessions.get(s.id) === s && revision === version && s.pat === pat
      && Date.now() - s.seen <= 30 * 60 * 1000 && Date.now() - s.created <= 8 * 60 * 60 * 1000,
      409, 'The setup or developer session changed. Retry.');
  }
  async function readApplication(s, pat = s.pat) {
    requireThat(configured(), 409, 'Configure the Service App first.');
    requireThat(pat, 409, 'Connect a developer PAT first.');
    const version = revision;
    try {
      const data = config.MODE === 'demo' ? { id: config.SERVICE_APP_ID, name: config.SERVICE_APP_NAME,
        checkedAt: Date.now(), organizations: store.all('SELECT * FROM demo_orgs WHERE authorized=1 ORDER BY name')
          .map(org => ({ id: org.id, webexOrgId: org.id, name: org.name, authorizedAt: null })) }
        : await webex.application(config.SERVICE_APP_ID, pat);
      stillCurrent(s, version, pat);
      remember(data);
      return data;
    } catch (error) {
      if (error.upstreamStatus === 401 && s.pat === pat) s.pat = null;
      throw error;
    }
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
  }
  async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    try {
      requireThat(req.headers.host === origin.host, 400, 'Unexpected host. Use the configured local URL.');
      requireThat(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress), 403, 'A loopback connection is required.');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': asset.type }); return res.end(asset.body);
      }
      const s = session(req, res, req.method === 'GET' && url.pathname === '/api/session');
      requireThat(s, 401, 'The local session ended. Reload the app.');
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { csrf: s.csrf, mode: config.MODE });
      let body;
      if (req.method === 'POST') {
        requireThat(req.headers.origin === origin.origin && req.headers['x-csrf-token'] === s.csrf,
          403, 'Request verification failed. Reload the page.');
        requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Send application/json.');
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; requireThat(length <= 32768, 413, 'Request too large.'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks)); } catch { throw new AppError(400, 'Invalid JSON.'); }
        requireThat(body && typeof body === 'object' && !Array.isArray(body), 400, 'Send a JSON object.');
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const app = configured() ? snapshot() : null;
        return json(res, 200, { configured: !!configured(), developerConnected: !!s.pat,
          serviceApp: { id: config.SERVICE_APP_ID || '', clientId: config.SERVICE_APP_CLIENT_ID || '',
            ...serviceAppDetails(config), name: app?.name || config.SERVICE_APP_NAME || '' },
          checkedAt: app?.checkedAt || null,
          organizations: (app?.organizations || []).map(org => {
            const tokens = savedTokens(org.id);
            return { ...org, token: tokens ? { obtainedAt: tokens.obtained_at,
              expiresAt: tokens.obtained_at + tokens.expires_in * 1000,
              refreshExpiresAt: tokens.refresh_token_expires_in === undefined ? null : tokens.obtained_at + tokens.refresh_token_expires_in * 1000 } : null };
          }),
          events: store.all('SELECT at,action,detail FROM audit ORDER BY id DESC LIMIT 30'),
          demoOrgs: config.MODE === 'demo' ? store.all('SELECT * FROM demo_orgs ORDER BY name') : undefined });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        requireThat(!flights.size, 409, 'A token action is running. Retry when it finishes.');
        requireThat(Object.keys(body).every(key => SERVICE_APP_FIELDS.includes(key)), 400, 'Use only Service App settings.');
        const patch = {};
        for (const key of SERVICE_APP_FIELDS) if (body[key] !== undefined) {
          requireThat(typeof body[key] === 'string' && body[key].length <= 4096 && !/[\r\n\u0000]/.test(body[key]), 400, 'Use valid Service App settings.');
          if (key !== 'SERVICE_APP_CLIENT_SECRET' || body[key].trim()) patch[key] = body[key].trim();
        }
        const next = { ...config, ...patch };
        serviceAppDetails(next);
        requireThat(SERVICE_APP_FIELDS.slice(0, 3).every(key => next[key]), 400, 'Supply the app ID, client ID, and client secret.');
        requireThat(!['SERVICE_APP_ID', 'SERVICE_APP_CLIENT_ID'].some(key => next[key] !== config[key]) || patch.SERVICE_APP_CLIENT_SECRET,
          400, 'Supply the matching client secret when changing an ID.');
        Object.assign(preserved, Object.fromEntries(SERVICE_APP_FIELDS.map(key => [key, next[key] || ''])));
        store.setting('provider_configuration', box.seal(preserved, 'provider-configuration'));
        Object.assign(config, next); revision++;
        for (const active of sessions.values()) active.pat = null;
        store.audit('service_app_settings_saved');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/developer') {
        requireThat(body.action === 'connect' || body.action === 'disconnect', 400, 'Choose a developer access action.');
        s.pat = null;
        if (body.action === 'connect') {
          requireThat(config.MODE === 'demo' || (typeof body.pat === 'string' && body.pat.length > 0 && body.pat.length <= 16384 && !/\s/.test(body.pat)),
            400, 'Supply a valid Developer Portal personal access token.');
          s.pat = config.MODE === 'demo' ? random() : body.pat;
          const candidate = s.pat;
          try { await readApplication(s); } catch (error) { if (s.pat === candidate) s.pat = null; throw error; }
        }
        store.audit(body.action === 'connect' ? 'developer_pat_connected' : 'developer_pat_disconnected');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/organizations') {
        await readApplication(s); store.audit('authorizations_read');
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/tokens') {
        requireThat(['retrieve', 'refresh', 'show'].includes(body.action) && typeof body.orgId === 'string' && body.confirm === true,
          400, 'Confirm a token action for an approved organization.');
        const version = revision, pat = s.pat, lock = context(body.orgId);
        requireThat(!flights.has(lock), 409, 'A token action is already running for this organization.');
        flights.add(lock);
        try {
          const app = await readApplication(s), org = app.organizations.find(item => item.id === body.orgId);
          requireThat(org, 403, 'This organization is not currently approved for the Service App.');
          const previous = savedTokens(org.id);
          requireThat(body.action === 'retrieve' || previous, 409, 'Retrieve a token pair first.');
          let tokens = previous;
          if (body.action !== 'show') {
            tokens = config.MODE === 'demo' ? { access_token: `demo-access-${random()}`, refresh_token: `demo-refresh-${random()}`,
              expires_in: 3600, refresh_token_expires_in: 86400, obtained_at: Date.now() }
              : body.action === 'refresh' ? await webex.refresh(previous) : await webex.serviceTokens(org.webexOrgId, pat);
          }
          stillCurrent(s, version, pat);
          if (body.action !== 'show') store.run('INSERT OR REPLACE INTO managed_service_tokens VALUES (?,?,?,?)',
            config.SERVICE_APP_ID, config.SERVICE_APP_CLIENT_ID, org.id, box.seal(tokens, context(org.id)));
          store.audit(`service_tokens_${body.action}`, org.id);
          return json(res, 200, { tokens, organization: { id: org.id, name: org.name } });
        } finally { flights.delete(lock); }
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/authorization') {
        requireThat(config.MODE === 'demo', 404, 'Not found.');
        requireThat(typeof body.authorized === 'boolean' && store.get('SELECT id FROM demo_orgs WHERE id=?', body.orgId), 400, 'Choose a demo organization.');
        store.run('UPDATE demo_orgs SET authorized=? WHERE id=?', Number(body.authorized), body.orgId);
        store.audit('demo_authorization_changed', `${body.orgId}: ${body.authorized}`);
        return json(res, 200, { ok: true });
      }
      throw new AppError(404, 'Not found.');
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Request failed; sensitive details omitted.');
      if (!res.headersSent) json(res, error instanceof AppError ? error.status : 500,
        { error: error instanceof AppError ? error.message : 'Unexpected server error.' });
      else res.end();
    }
  }
  return { handler, close() {
    clearInterval(expiryTimer);
    for (const s of sessions.values()) s.pat = null;
    sessions.clear();
  } };
}
