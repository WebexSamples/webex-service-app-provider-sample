import { AppError, requireThat, orgKey } from './security.mjs';

const API = 'https://webexapis.com/v1';
function pair(data, previous = {}) {
  const value = { access_token: data?.access_token, refresh_token: data?.refresh_token || previous.refresh_token,
    expires_in: Number(data?.expires_in), obtained_at: Date.now() };
  requireThat([value.access_token, value.refresh_token].every(t => typeof t === 'string' && t.length > 0 && t.length <= 16384 && !/[\r\n]/.test(t))
    && Number.isFinite(value.expires_in) && value.expires_in > 0, 502, 'Webex did not return a complete Service App token pair.');
  if (data.refresh_token_expires_in !== undefined) {
    requireThat(Number.isFinite(Number(data.refresh_token_expires_in)) && Number(data.refresh_token_expires_in) > 0, 502, 'Webex returned an invalid refresh-token lifetime.');
    value.refresh_token_expires_in = Number(data.refresh_token_expires_in);
  }
  return value;
}
export function createWebex(config, fetcher = fetch) {
  async function request(path, token, options = {}) {
    const url = new URL(`${API}${path}`);
    requireThat(url.origin === 'https://webexapis.com' && url.pathname.startsWith('/v1/'), 502, 'Rejected an unexpected Webex API URL.');
    let response;
    try {
      response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
    } catch { throw new AppError(502, 'Webex could not be reached. Retry later.', 'webex_unavailable'); }
    if (!response.ok) {
      const error = new AppError(response.status === 429 ? 429 : 502,
        response.status === 401 ? 'Webex rejected the credential. Replace an expired PAT or retrieve a new Service App token.'
          : response.status === 403 ? 'Webex denied access. Check the app owner, PAT permissions, and organization approval.'
            : `Webex returned HTTP ${response.status}. Retry or check the Service App in the Developer Portal.`,
        [401, 403].includes(response.status) ? 'webex_denied' : 'webex_error');
      error.upstreamStatus = response.status;
      throw error;
    }
    let data;
    try { data = await response.json(); } catch { throw new AppError(502, 'Webex returned an invalid response.'); }
    return { data, link: response.headers.get('link') };
  }
  return {
    async application(appId, token) {
      const { data: person } = await request('/people/me', token);
      requireThat(person?.type === 'person' && typeof person.id === 'string', 403, 'Use a personal access token from the developer who created the Service App.');
      // Experimental internal read path used by the Developer Portal; not a published API contract.
      const { data, link } = await request(`/applications/${encodeURIComponent(appId)}`, token);
      requireThat(data?.id === appId && data.type === 'authorizedApp', 502, 'Webex returned a different application or application type.');
      requireThat(data.createdBy === person.id, 403, 'Use the personal access token of this Service App’s creator.');
      requireThat(data.authorizationsList === undefined || Array.isArray(data.authorizationsList), 502, 'Webex returned an invalid authorization list.');
      const items = data.authorizationsList || [];
      requireThat(!link && (data.authorizationsCount === undefined || data.authorizationsCount === items.length),
        502, 'The authorization response may be incomplete. Check the Developer Portal.');
      const seen = new Set();
      const organizations = items.map(org => {
        const id = orgKey(org?.orgId);
        requireThat(!seen.has(id), 502, 'Webex returned duplicate organization identities.'); seen.add(id);
        return { id, webexOrgId: org.orgId, name: typeof org.orgName === 'string' ? org.orgName.slice(0, 512) : org.orgId,
          authorizedAt: typeof org.authorizationDate === 'string' ? org.authorizationDate.slice(0, 64) : null };
      });
      return { id: appId, name: typeof data.name === 'string' ? data.name.slice(0, 200) : 'Service App', organizations, checkedAt: Date.now() };
    },
    async serviceTokens(orgId, pat) {
      const { data } = await request(`/applications/${encodeURIComponent(config.SERVICE_APP_ID)}/token`, pat,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId: config.SERVICE_APP_CLIENT_ID, clientSecret: config.SERVICE_APP_CLIENT_SECRET, targetOrgId: orgId }) });
      return pair(data);
    },
    async refresh(tokens) {
      const { data } = await request('/access_token', null, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token',
          client_id: config.SERVICE_APP_CLIENT_ID, client_secret: config.SERVICE_APP_CLIENT_SECRET, refresh_token: tokens.refresh_token }).toString() });
      const fresh = pair(data, tokens);
      if (data.refresh_token_expires_in === undefined && fresh.refresh_token === tokens.refresh_token
        && tokens.refresh_token_expires_in !== undefined) {
        fresh.refresh_token_expires_in = Math.max(0, (tokens.obtained_at + tokens.refresh_token_expires_in * 1000 - fresh.obtained_at) / 1000);
      }
      return fresh;
    },
  };
}
