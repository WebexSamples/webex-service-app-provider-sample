import { AppError, requireThat, orgKey } from './security.mjs';

const API = 'https://webexapis.com/v1';
export const SCOPES = {
  customer: 'spark:people_read spark-admin:people_read spark-admin:roles_read',
  provider: 'spark:people_read spark:applications_token',
};
export function oauthClient(config, kind) {
  const prefix = kind === 'provider' ? 'PROVIDER' : 'CUSTOMER';
  const clientId = config[`${prefix}_INTEGRATION_CLIENT_ID`];
  const secret = config[`${prefix}_INTEGRATION_CLIENT_SECRET`];
  requireThat(clientId && secret, 409, `Configure the ${kind} OAuth Integration on the server.`, 'configuration');
  return { clientId, secret, redirect: `${config.BASE_URL}/oauth/${kind}/callback` };
}
export function authorizationUrl(config, kind, state) {
  const client = oauthClient(config, kind);
  const url = new URL(`${API}/authorize`);
  url.search = new URLSearchParams({ client_id: client.clientId, response_type: 'code',
    redirect_uri: client.redirect, scope: SCOPES[kind], state }).toString();
  return url.href;
}
export function createWebex(config, fetcher = fetch) {
  async function request(path, token, options = {}) {
    const url = new URL(path.startsWith('https:') ? path : `${API}${path}`);
    requireThat(url.origin === 'https://webexapis.com' && url.pathname.startsWith('/v1/') && !url.username && !url.password,
      502, 'Rejected an unexpected Webex API URL.');
    let response;
    try {
      response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
    } catch { throw new AppError(502, 'Webex could not be reached. Retry later.', 'webex_unavailable'); }
    if (!response.ok) {
      // Raw upstream errors can contain credentials or personal data; never forward them.
      const code = [401, 403].includes(response.status) ? 'webex_denied' : 'webex_error';
      throw new AppError(response.status === 429 ? 429 : 502,
        `Webex returned HTTP ${response.status}. Check consent, scopes, credentials, and authorization.`, code);
    }
    try { return { data: await response.json(), link: response.headers.get('link') }; }
    catch { throw new AppError(502, 'Webex returned an invalid response.'); }
  }
  async function tokenForm(fields) {
    const { data } = await request('/access_token', null, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    requireThat(data.access_token && Number(data.expires_in) > 0, 502, 'Webex did not return a valid access token.');
    return { ...data, obtained_at: Date.now() };
  }
  return {
    request,
    async exchange(kind, code) {
      const c = oauthClient(config, kind);
      return tokenForm({ grant_type: 'authorization_code', client_id: c.clientId,
        client_secret: c.secret, code, redirect_uri: c.redirect });
    },
    async refresh(tokens, kind) {
      requireThat(tokens.refresh_token, 409, 'Reconnect: the refresh token is unavailable.');
      const c = kind === 'service'
        ? { clientId: config.SERVICE_APP_CLIENT_ID, secret: config.SERVICE_APP_CLIENT_SECRET }
        : oauthClient(config, kind);
      const fresh = await tokenForm({ grant_type: 'refresh_token', client_id: c.clientId,
        client_secret: c.secret, refresh_token: tokens.refresh_token });
      return { ...tokens, ...fresh, refresh_token: fresh.refresh_token || tokens.refresh_token };
    },
    async identity(token, requireAdmin = true) {
      const { data: person } = await request('/people/me', token);
      requireThat(person.id && person.orgId && person.type === 'person', 403, 'A human Webex account is required.');
      orgKey(person.orgId);
      if (requireAdmin) {
        const { data } = await request('/roles', token);
        const admin = data.items?.find(role => role.name === 'Full Administrator');
        requireThat(admin && Array.isArray(person.roles) && person.roles.includes(admin.id),
          403, 'A Webex Full Administrator must connect this organization.', 'admin_required');
      }
      return { personId: person.id, orgId: person.orgId, name: person.displayName || 'Webex administrator' };
    },
    async serviceTokens(orgId, providerToken) {
      requireThat(config.SERVICE_APP_ID && config.SERVICE_APP_CLIENT_ID && config.SERVICE_APP_CLIENT_SECRET,
        409, 'Configure the Service App credentials on the server.', 'configuration');
      const { data } = await request(`/applications/${encodeURIComponent(config.SERVICE_APP_ID)}/token`, providerToken,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId: config.SERVICE_APP_CLIENT_ID, clientSecret: config.SERVICE_APP_CLIENT_SECRET, targetOrgId: orgId }) });
      requireThat(data.access_token && data.refresh_token && Number(data.expires_in) > 0,
        502, 'Webex did not return a complete Service App token pair.');
      return { ...data, obtained_at: Date.now() };
    },
    async organization(orgId, token) {
      const { data } = await request(`/organizations/${encodeURIComponent(orgId)}`, token);
      requireThat(orgKey(data.id) === orgKey(orgId), 502, 'Webex returned a different organization.');
      return { id: orgId, name: data.displayName || orgId };
    },
    async directory(orgId, token, next = null) {
      let path = `/people?orgId=${encodeURIComponent(orgId)}&max=50`;
      if (next) {
        const url = new URL(next);
        requireThat(url.origin === 'https://webexapis.com' && url.pathname === '/v1/people'
          && orgKey(url.searchParams.get('orgId')) === orgKey(orgId), 502, 'Rejected an unsafe pagination link.');
        path = url.href;
      }
      const { data, link } = await request(path, token);
      requireThat(Array.isArray(data.items), 502, 'Webex returned an invalid directory page.');
      requireThat(data.items.every(p => p.orgId && orgKey(p.orgId) === orgKey(orgId)),
        502, 'Webex returned directory data outside the connected organization.');
      const nextUrl = link?.match(/<([^>]+)>;\s*rel="?next"?/)?.[1] || null;
      return { people: data.items.map(p => ({ name: p.displayName || 'Unnamed user', email: p.emails?.[0] || '' })), next: nextUrl };
    },
  };
}
