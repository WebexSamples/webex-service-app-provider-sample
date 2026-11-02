let session, state, notice = '', failed = false, busy = false, revealed = null;
const pages = ['overview', 'service-app', 'developer-access', 'organizations', 'activity'];
let navigationRevision = 0;
let page = pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const root = document.querySelector('#app');
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(c => c != null).map(c => c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}
const text = (tag, cls, value) => el(tag, { class: cls }, value);
const date = value => value ? new Date(value).toLocaleString() : 'Not checked yet';
const link = (label, href) => el('a', { href }, label);
const external = (label, href) => el('a', { href, target: '_blank', rel: 'noreferrer' }, label);
const button = (label, action, secondary = false) => el('mdc-button', { class: 'button', variant: secondary ? 'secondary' : 'primary',
  color: 'accent', size: '40', type: 'button', disabled: busy, onClick: () => run(action) }, label);
const pill = (label, ready = false) => text('span', `pill ${ready ? 'connected' : ''}`, label);
const panel = (...children) => el('section', { class: 'panel' }, ...children);
function field(label, name, value = '', type = 'text', props = {}) {
  return el('div', {}, el('label', { for: name }, label), el('input', { id: name, name, value, type, autocomplete: 'off', ...props }));
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
async function refresh() {
  const previous = session?.csrf;
  session = await api('/api/session');
  if (previous && previous !== session.csrf) revealed = null;
  state = await api('/api/state');
  if (!state.developerConnected) revealed = null;
}
async function run(action) {
  if (busy) return;
  busy = true; notice = ''; failed = false; revealed = null; render();
  try { await action(); await refresh(); }
  catch (error) { revealed = null; notice = error.message; failed = true; try { await refresh(); } catch { /* Retain the original error. */ } }
  finally { busy = false; render(); }
}
function header() {
  return el('header', { class: 'portal-header' }, el('a', { class: 'brand', href: '#overview' },
    text('span', 'brand-symbol', '</>'), el('span', {}, 'Webex', text('span', 'brand-subtitle', 'for Developers'))),
  el('span', { class: 'header-context' }, 'Samples', text('span', '', 'Service App Studio')));
}
function nav(label, destination, status, ready) {
  return el('a', { href: `#${destination}`, class: `nav-link ${page === destination ? 'active' : ''}`,
    'aria-current': page === destination ? 'page' : null }, text('span', '', label), status ? pill(status, ready) : null);
}
function sidebar() {
  return el('aside', { class: 'sidebar' }, el('nav', { 'aria-label': 'Studio navigation' },
    nav('Overview', 'overview'), text('p', 'eyebrow nav-group', 'Developer Connections'),
    nav('Service App', 'service-app', state.configured ? 'Configured' : 'Needs setup', state.configured),
    nav('Developer Access', 'developer-access', state.developerConnected ? 'Connected' : 'Needs PAT', state.developerConnected),
    text('p', 'eyebrow nav-group', 'Manage'), nav('Organizations', 'organizations'), nav('Connection History', 'activity')),
    el('div', { class: 'sidebar-note' }, el('strong', {}, 'Local workspace'),
      text('p', '', 'Configure one Service App, inspect its approvals, and get tokens for an approved organization.')));
}
function overview() {
  const app = state.serviceApp;
  return [text('p', 'lead', 'Maintain your Webex Service App from a local workspace. See which organizations have approved it, then retrieve and refresh their Service App tokens.'),
    el('div', { class: 'status-grid' },
      panel(text('p', 'eyebrow', 'Service App'), text('h2', '', app.name || 'Set up your app'), pill(state.configured ? 'Configured' : 'Needs setup', state.configured), el('p', {}, link('View Service App →', '#service-app'))),
      panel(text('p', 'eyebrow', 'Developer Access'), text('h2', '', state.developerConnected ? 'PAT connected' : 'Connect a PAT'), text('p', 'muted', 'Kept in this server session only.'), link('Manage developer access →', '#developer-access')),
      panel(text('p', 'eyebrow', 'Organizations'), text('h2', 'metric', state.checkedAt ? state.organizations.length : '—'), text('p', 'muted', `Approved · Last checked: ${date(state.checkedAt)}`), link('View organizations →', '#organizations'))),
    panel(text('h2', '', 'How it works'), el('ol', { class: 'steps' },
      el('li', {}, el('strong', {}, 'Configure your Service App'), text('p', 'muted', 'Save the app ID and client credentials from My Webex Apps.')),
      el('li', {}, el('strong', {}, 'Connect developer access'), text('p', 'muted', 'Supply the app creator’s personal access token to read approvals.')),
      el('li', {}, el('strong', {}, 'Get an organization token'), text('p', 'muted', 'Select an approved organization and confirm a token action.')))),
    panel(text('h2', '', 'Approval happens in Webex'), text('p', 'muted', 'A customer administrator approves the Service App in Control Hub. This console reads those approvals; it does not approve organizations or grant scopes.'),
      text('p', 'fine', 'Organization listing currently uses an experimental Developer Portal API. PAT access is for local validation. Public API and scope enablement are being investigated separately.'))];
}
function serviceApp() {
  const app = state.serviceApp;
  const form = el('form', { onSubmit: event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
    run(async () => { await api('/api/settings', values); notice = 'Service App saved. Connect a PAT to read its approvals.'; });
  } },
  field('Service App name', 'SERVICE_APP_NAME', app.name, 'text', { maxlength: 200 }),
  field('Manage URL', 'SERVICE_APP_MANAGE_URL', app.manageUrl, 'url', { placeholder: 'https://developer.webex.com/my-apps/your-app' }),
  field('Service App ID', 'SERVICE_APP_ID', app.id, 'text', { required: true }),
  field('Client ID', 'SERVICE_APP_CLIENT_ID', app.clientId, 'text', { required: true }),
  field('Client secret', 'SERVICE_APP_CLIENT_SECRET', '', 'password', { required: !state.configured, placeholder: state.configured ? 'Leave blank to keep the saved secret' : '' }),
  el('p', { class: 'fine' }, 'Credentials are encrypted locally. Saving settings disconnects the PAT session. Existing organization tokens stay bound to their original app and client.'),
  el('button', { class: 'button', type: 'submit', disabled: busy }, 'Save Service App'));
  return [panel(el('div', { class: 'section-heading' }, text('h2', '', app.name || 'Your Service App'),
    pill(state.configured ? 'Configured' : 'Needs setup', state.configured)),
    app.manageUrl ? external('Manage in Webex ↗', app.manageUrl) : external('Open My Webex Apps ↗', 'https://developer.webex.com/my-apps'),
    text('p', 'muted', 'Use an existing Service App, or create one in the Developer Portal and return with its credentials.'), form)];
}
function developerAccess() {
  const form = el('form', { onSubmit: event => {
    event.preventDefault(); const pat = new FormData(event.target).get('pat'); event.target.reset();
    run(async () => { await api('/api/developer', { action: 'connect', pat }); notice = 'Developer access connected. Organization approvals refreshed.'; });
  } }, field('Personal access token', 'pat', '', 'password', { required: true, spellcheck: false }),
  el('p', { class: 'fine' }, 'Use the PAT of the developer who created this Service App. It stays in server memory for this browser session and is discarded on disconnect, session expiry, or restart.'),
  el('button', { class: 'button', type: 'submit', disabled: busy || !state.configured }, 'Connect PAT'));
  return [panel(text('h2', '', 'Developer personal access token'), pill(state.developerConnected ? 'Connected' : 'Not connected', state.developerConnected),
    text('p', 'muted', 'A PAT is a temporary local testing credential. The console checks that it belongs to the Service App creator before reading organization approvals.'),
    external('Get your personal access token ↗', 'https://developer.webex.com/admin/docs/getting-started#your-personal-access-token'),
    !state.configured ? el('p', {}, link('Configure the Service App first →', '#service-app')) : null,
    session.mode === 'demo' ? button('Connect demo developer', async () => { await api('/api/developer', { action: 'connect' }); notice = 'Demo developer connected.'; }) : form,
    state.developerConnected ? el('div', { class: 'actions' }, button('Disconnect PAT', () => api('/api/developer', { action: 'disconnect' }), true)) : null),
    panel(text('h2', '', 'Why a PAT?'), text('p', 'muted', 'The organization-read API accepts application-read permissions that are not currently offered in the Integration editor. This sample uses an explicitly supplied PAT until a supported API and OAuth scope are available. It does not use your old Integration credentials.'))];
}
function tokenAction(org, action) {
  const version = navigationRevision;
  return run(async () => {
    const result = await api('/api/tokens', { orgId: org.id, action, confirm: true });
    if (version === navigationRevision) revealed = result;
    notice = action === 'show' ? 'Saved token pair revealed.' : 'Service App token pair saved locally.';
  });
}
function organizationCard(org) {
  const disclosure = el('details', { class: 'token-actions' }, el('summary', {}, 'Manage tokens'),
    text('p', 'fine', 'These actions reveal credentials for this organization. Retrieval may issue a new pair. Keep tokens private.'),
    el('div', { class: 'actions' },
      el('mdc-button', { class: 'button', variant: 'primary', color: 'accent', disabled: busy || !state.developerConnected,
        onClick: () => tokenAction(org, 'retrieve') }, 'Retrieve token pair'),
      org.token ? el('mdc-button', { class: 'button', variant: 'secondary', disabled: busy || !state.developerConnected,
        onClick: () => tokenAction(org, 'refresh') }, 'Refresh token pair') : null,
      org.token ? el('mdc-button', { class: 'button', variant: 'secondary', disabled: busy || !state.developerConnected,
        onClick: () => tokenAction(org, 'show') }, 'Reveal saved pair') : null));
  return panel(el('div', { class: 'section-heading' }, text('h2', '', org.name), pill('Approved', true)),
    text('p', 'identifier', org.webexOrgId), text('p', 'fine', org.authorizedAt ? `Approved: ${date(org.authorizedAt)}` : 'Webex reports this organization as approved.'),
    org.token ? text('p', 'muted', `Saved token · Access expires ${date(org.token.expiresAt)}`) : text('p', 'muted', 'No token pair saved for this organization.'), disclosure);
}
async function copyToken(key) {
  if (!revealed) return;
  try { await navigator.clipboard.writeText(revealed.tokens[key]); notice = 'Token copied to your clipboard.'; failed = false; }
  catch { notice = 'Clipboard access was denied. Select and copy the token manually.'; failed = true; }
  render();
}
function tokenPanel() {
  if (!revealed) return null;
  return panel(text('h2', '', `Token pair · ${revealed.organization.name}`), text('p', 'fine', 'Visible only after your explicit action. Hide when finished. Tokens are cleared from this view when you navigate away.'),
    ...['access_token', 'refresh_token'].map(key => el('div', {}, el('label', { for: key }, key === 'access_token' ? 'Access token' : 'Refresh token'),
      el('textarea', { id: key, readonly: true, rows: 3, spellcheck: false }, revealed.tokens[key]),
      el('mdc-button', { class: 'button', variant: 'secondary', onClick: () => copyToken(key) }, key === 'access_token' ? 'Copy access token' : 'Copy refresh token'))),
    el('div', { class: 'actions' }, el('mdc-button', { class: 'button', variant: 'secondary', onClick: () => { revealed = null; render(); } }, 'Hide tokens')));
}
function organizations() {
  return [panel(el('div', { class: 'section-heading' }, text('h2', '', 'Approved organizations'),
    button('Refresh approvals', async () => { await api('/api/organizations', {}); notice = 'Organization approvals refreshed from Webex.'; }, true)),
    text('p', 'muted', `Last checked: ${date(state.checkedAt)}. The list below is a saved snapshot. Every token action checks the current approval again.`),
    !state.developerConnected ? el('p', {}, link('Connect a developer PAT to refresh approvals or manage tokens →', '#developer-access')) : null),
    tokenPanel(), ...state.organizations.map(organizationCard),
    !state.organizations.length ? panel(text('p', 'empty', state.checkedAt ? 'No approved organizations were returned for this Service App.' : 'Connect developer access to load approved organizations.')) : null,
    session.mode === 'demo' ? panel(text('h2', '', 'Simulated Control Hub'), text('p', 'muted', 'Demo controls only. Change an approval, then refresh the list.'),
      ...state.demoOrgs.map(org => el('div', { class: 'demo-approval' }, text('strong', '', org.name),
        button(org.authorized ? 'Revoke demo approval' : 'Approve demo organization', () => api('/api/demo/authorization', { orgId: org.id, authorized: !org.authorized }), true)))) : null];
}
function activity() {
  return [panel(text('h2', '', 'Recent activity'), state.events.length ? el('ul', { class: 'events' },
    ...state.events.map(event => el('li', {}, el('div', {}, text('strong', '', event.action.replaceAll('_', ' ')),
      event.detail ? text('small', '', event.detail) : null), el('time', {}, date(event.at))))) : text('p', 'empty', 'No actions recorded yet.'))];
}
function render() {
  if (!state) { root.replaceChildren(header(), text('p', 'loading', notice || 'Loading local workspace…')); return; }
  const labels = { overview: 'Service App Studio', 'service-app': 'Service App', 'developer-access': 'Developer Access', organizations: 'Organizations', activity: 'Connection History' };
  root.replaceChildren(header(), el('div', { class: 'app-shell' }, sidebar(), el('main', { class: 'workspace', id: 'main', tabindex: -1 },
    text('div', `mode-banner ${session.mode}`, session.mode === 'demo' ? 'DEMO MODE · Fictional organizations and tokens. No Webex requests.' : 'LOCAL LIVE MODE · Real Service App approvals and credentials.'),
    el('div', { class: 'page-heading' }, text('h1', '', labels[page])),
    notice ? el('div', { class: `notice ${failed ? 'error' : ''}`, role: failed ? 'alert' : 'status' }, notice) : null,
    ...({ overview, 'service-app': serviceApp, 'developer-access': developerAccess, organizations, activity }[page])())));
}
window.addEventListener('hashchange', () => {
  navigationRevision++;
  page = pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  revealed = null; notice = ''; render(); document.querySelector('#main')?.focus();
});
window.addEventListener('pagehide', () => { navigationRevision++; revealed = null; root.replaceChildren(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) refresh().then(render).catch(error => { notice = error.message; failed = true; render(); });
});
// Clear revealed credentials after inactivity even if no request checks the server session.
setInterval(() => { if (revealed) { revealed = null; render(); } }, 5 * 60 * 1000);
refresh().then(render).catch(error => { notice = error.message; render(); });
