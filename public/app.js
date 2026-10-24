let session, state, notice = '', isError = false, busy = false, people = [], hasMore = false;
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
const text = (tag, className, value) => el(tag, { class: className }, value);
const date = value => value ? new Date(value).toLocaleString() : 'Not yet';
const button = (label, action, secondary = false) => el('button', { class: secondary ? 'button secondary' : 'button',
  type: 'button', disabled: busy, onClick: () => run(action) }, label);
const pill = label => text('span', `pill ${label === 'Connected' ? 'connected' : ''}`, label);
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') { session.account = null; state = null; }
    throw new Error(data.error || 'The request failed.');
  }
  return data;
}
async function refresh() {
  session = await api('/api/session');
  state = session.account ? await api('/api/state') : null;
  if (state && session.account.role === 'customer' && state.tenants[0].status !== 'Connected') { people = []; hasMore = false; }
}
async function run(action) {
  if (busy) return;
  busy = true; notice = ''; isError = false; render();
  try { await action(); await refresh(); }
  catch (error) { notice = error.message; isError = true; people = []; hasMore = false;
    try { await refresh(); } catch { /* Keep the original actionable error visible. */ }
  } finally { busy = false; render(); }
}
function brand() { return el('div', { class: 'brand' }, text('span', 'brand-symbol', '↗'), el('div', {}, 'Service App Studio', text('small', '', 'A Webex developer sample'))); }
function banner() {
  return text('div', `mode-banner ${session.mode}`, session.mode === 'demo'
    ? 'DEMO MODE · Fixture identities and directory data. No Webex requests are made.'
    : 'LIVE MODE · Real Webex authorization, identities, and customer organization data.');
}
function message() { return notice ? el('div', { class: `notice ${isError ? 'error' : ''}`, role: isError ? 'alert' : 'status' }, notice) : null; }
function login() {
  const form = el('form', { class: 'login-form', onSubmit: event => {
    event.preventDefault(); const data = new FormData(event.target);
    run(async () => { await api('/api/login', { email: data.get('email'), password: data.get('password') }); people = []; });
  } }, text('p', 'eyebrow', 'ONE APP. TWO PERSPECTIVES.'), text('h2', '', 'Welcome back'),
  text('p', 'muted', 'Use your provider or customer account. Your account determines your experience.'),
  el('label', { for: 'email' }, 'Email address'), el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.test' }),
  el('label', { for: 'password' }, 'Password'), el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: '256' }),
  el('button', { class: 'button', type: 'submit', disabled: busy }, busy ? 'Signing in…' : 'Sign in →'),
  text('p', 'fine', 'Local accounts are created with npm run setup. There are no default passwords.'));
  return el('div', { class: 'login-shell' }, el('section', { class: 'intro' }, brand(),
    text('p', 'eyebrow', 'CUSTOMER-INITIATED ORGANIZATION LINKING'), text('h1', '', 'A connection\nwith clear consent.'),
    text('p', 'intro-copy', 'Approve in Webex. Verify your identity. Choose the provider account. Only then activate the Service App.'),
    el('ol', { class: 'flow' }, ['Authorize the Service App', 'Verify the Webex administrator', 'Confirm the organization link'].map((s, i) => el('li', {}, text('span', '', `0${i + 1}`), s))),
    text('p', 'intro-foot', 'Human verification → organization identity → machine access')),
    el('main', { id: 'main', class: 'login-panel' }, banner(), message(), form));
}
async function oauth(kind) {
  const result = await api(`/api/oauth/${kind}`, {});
  const url = new URL(result.url);
  if (url.origin !== 'https://webexapis.com' || url.pathname !== '/v1/authorize') throw new Error('Unexpected authorization destination.');
  window.location.assign(url.href);
}
function auditPanel() {
  return el('section', { class: 'panel audit' }, text('p', 'eyebrow', 'CONNECTION HISTORY'), text('h2', '', 'What happened, and when'),
    state.events.length ? el('ol', { class: 'events' }, state.events.map(event => el('li', {},
      el('div', {}, text('strong', '', event.action.replaceAll('_', ' ')), text('small', 'muted', event.detail || 'Recorded by the sample')),
      el('time', {}, date(event.at))))) : text('p', 'muted', 'Connection activity will appear here.'));
}
function provider() {
  const connectionButton = session.mode === 'demo'
    ? button(state.providerConnected ? 'Reconnect demo Integration' : 'Connect demo Integration', async () => { await api('/api/demo/provider', {}); notice = 'Demo provider Integration connected.'; })
    : button('Connect provider Integration', () => oauth('provider'));
  const config = state.configuration;
  const setup = el('section', { class: 'panel provider-setup' },
    el('div', {}, text('p', 'eyebrow', 'PROVIDER SETUP'), text('h2', '', 'Token-management connection'),
      text('p', 'muted', 'The provider’s Integration retrieves organization-specific Service App credentials. Customer sign-in tokens have a separate purpose.')),
    el('div', { class: 'setup-action' }, pill(state.providerConnected ? 'Connected' : 'Not connected'), connectionButton));
  const configurations = session.mode === 'live' ? el('section', { class: 'config-grid' },
    Object.entries({ 'Service App': config.serviceApp, 'Provider OAuth': config.providerOAuth, 'Customer OAuth': config.customerOAuth, 'Webhook secret': config.webhook })
      .map(([name, ready]) => el('div', { class: 'config-item' }, text('span', '', name), text('strong', ready ? 'good' : 'muted', ready ? 'Configured' : 'Needs setup')))) : null;
  const demo = session.mode === 'demo' ? el('section', { class: 'panel demo-controls' },
    text('p', 'eyebrow', 'SIMULATED CONTROL HUB'), text('h2', '', 'Customer Service App approvals'),
    text('p', 'muted', 'These switches simulate a Full Admin’s Control Hub action. Approval alone never links a provider account or activates the connection.'),
    el('div', { class: 'org-grid' }, state.demoOrgs.map(org => el('div', { class: 'org-item' },
      text('h3', '', org.name), pill(org.authorized ? 'Authorized fixture' : 'Not authorized'),
      button(org.authorized ? `Deauthorize ${org.name}` : `Authorize ${org.name}`, async () => {
        await api('/api/demo/authorization', { orgId: org.id, authorized: !org.authorized }); notice = 'Simulated authorization updated.';
      }, true))))) : null;
  const rows = state.tenants.map(t => el('tr', {}, el('td', {}, text('strong', '', t.name), text('small', 'muted', t.id)),
    el('td', {}, t.orgName || 'No confirmed link', text('small', 'identifier', t.orgId || '')), el('td', {}, pill(t.status),
      text('small', 'muted', t.credentialExpiresAt ? `Access token expires ${date(t.credentialExpiresAt)}` : 'No stored credentials')), el('td', {}, date(t.lastChecked))));
  return [setup, configurations, demo, el('section', { class: 'panel' }, text('p', 'eyebrow', 'PROVIDER ACCOUNTS'), text('h2', '', 'Customer connections'),
    text('p', 'muted', 'Connection metadata only. Customer directories and secret values are not shown in this console.'),
    el('div', { class: 'table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Customer', 'Webex organization', 'Connection', 'Last successful read'].map(h => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows)))), auditPanel()];
}
function customer() {
  const t = state.tenants[0];
  const summary = el('section', { class: 'connection-hero' }, el('div', {}, text('p', 'eyebrow', 'YOUR PROVIDER ACCOUNT'), text('h2', '', t.name),
    text('p', '', t.orgName || 'Connect the Webex organization you administer.'), text('small', 'identifier', t.orgId || 'A Webex approval and an explicit account link are both required.')), pill(t.status));
  const guide = el('section', { class: 'panel' }, text('p', 'eyebrow', 'CONNECT YOUR ORGANIZATION'), text('h2', '', 'Three steps. One explicit link.'),
    el('ol', { class: 'steps' }, el('li', {}, text('strong', '', 'Authorize in Control Hub'),
      text('p', 'muted', session.mode === 'demo' ? 'Use a separate provider session to simulate your organization’s Service App approval.' : 'A Full Admin authorizes the Service App under Management → Apps → Service Apps. For this pre-App Hub test, use the developer’s Webex organization.')),
      el('li', {}, text('strong', '', 'Verify your Webex account'), text('p', 'muted', 'The connecting person must administer this provider account and be a Webex Full Administrator.')),
      el('li', {}, text('strong', '', 'Confirm the organization link'), text('p', 'muted', 'Review the verified identity before the provider requests machine-account credentials.'))));
  let verification;
  if (session.mode === 'demo') {
    const org = el('select', { id: 'demo-org', name: 'orgId' }, state.demoOrgs.map(o => el('option', { value: o.id, selected: o.id === `demo-${t.id}` }, o.name)));
    const authority = el('select', { id: 'authority', name: 'authority' }, el('option', { value: 'admin' }, 'Full Administrator'), el('option', { value: 'member' }, 'Organization member — expected denial'));
    verification = el('form', { class: 'demo-form', onSubmit: event => {
      event.preventDefault(); const values = new FormData(event.target);
      run(async () => { await api('/api/demo/verify', { orgId: values.get('orgId'), authority: values.get('authority') }); notice = 'Fixture identity verified. Review the link below.'; });
    } }, text('p', 'eyebrow', 'SIMULATED WEBEX SIGN-IN'),
    el('label', { for: 'demo-org' }, 'Fixture organization'), org, el('label', { for: 'authority' }, 'Fixture authority'), authority,
    el('button', { class: 'button', type: 'submit', disabled: busy }, 'Verify fixture identity'));
  } else verification = button('Verify with Webex →', () => oauth('customer'));
  const p = state.proof;
  const confirmation = p ? el('section', { class: 'confirm-panel' }, text('p', 'eyebrow', 'REVIEW BEFORE ACTIVATION'), text('h2', '', 'Confirm this organization link'),
    text('p', '', `Verified administrator: ${p.name}`), text('p', 'identifier', `Webex organization: ${p.orgId}`),
    text('p', '', `Provider account: ${t.name}`), text('p', 'fine', 'This verification expires in five minutes. The Service App must already be authorized.'),
    button('Confirm link and activate Service App', async () => { await api('/api/connect', { orgId: p.orgId, confirm: true }); notice = 'Organization linked. The directory now uses the Service App’s machine identity.'; people = []; })) : null;
  const directory = t.status === 'Connected' ? el('section', { class: 'panel' },
    el('div', { class: 'section-heading' }, el('div', {}, text('p', 'eyebrow', 'POWERED BY THE SERVICE APP'), text('h2', '', 'Organization directory')), button('Refresh directory', () => loadDirectory(false), true)),
    text('p', 'muted', `${people.length} members loaded · ${session.mode === 'demo' ? 'Fixture data' : 'Live Webex data'} · Last successful read: ${date(t.lastChecked)}`),
    people.length ? el('div', { class: 'table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Name'), el('th', { scope: 'col' }, 'Email'))),
      el('tbody', {}, people.map(person => el('tr', {}, el('td', {}, person.name), el('td', {}, person.email))))))
      : text('p', 'empty', 'Select Refresh directory to read this organization’s members.'),
    hasMore ? button('Load more members', () => loadDirectory(true), true) : null) : null;
  const disconnect = t.orgId ? el('section', { class: 'disconnect-row' }, text('p', 'fine', 'Disconnect removes stored credentials and releases this provider-account link. It does not revoke the Service App in Control Hub.'),
    button('Disconnect organization', async () => {
      if (!window.confirm('Disconnect this organization and delete its locally stored Service App credentials?')) return;
      await api('/api/disconnect', { confirm: true }); people = []; notice = 'Disconnected. Revoke authorization separately in Control Hub if needed.';
    }, true)) : null;
  return [summary, directory, ...(t.status === 'Connected' ? [] : [guide, el('section', { class: 'panel' }, verification), confirmation]), disconnect, auditPanel()];
}
async function loadDirectory(more) {
  if (!more) people = [];
  const result = await api('/api/directory', { more });
  people = more ? [...people, ...result.people] : result.people;
  hasMore = result.hasMore;
}
function render() {
  if (!session) { root.replaceChildren(text('p', 'loading', 'Opening Service App Studio…')); return; }
  if (!session.account) { root.replaceChildren(login()); return; }
  const isProvider = session.account.role === 'provider';
  root.replaceChildren(el('div', { class: 'app-shell' },
    el('aside', { class: 'sidebar' }, brand(), text('p', 'eyebrow sidebar-label', isProvider ? 'PROVIDER EXPERIENCE' : 'CUSTOMER EXPERIENCE'),
      text('div', 'nav-active', isProvider ? '↗  Customer connections' : '↗  Webex organization'),
      el('div', { class: 'sidebar-note' }, text('strong', '', 'Consent is only the beginning.'), text('p', '', 'Identity, authority, and the account link are verified before activation.')),
      el('div', { class: 'account' }, text('strong', '', session.account.name), text('small', '', session.account.email),
        button('Sign out', async () => { await api('/api/logout', {}); people = []; notice = ''; }, true))),
    el('main', { id: 'main', class: 'workspace', 'aria-busy': busy }, banner(),
      el('header', { class: 'page-heading' }, el('div', {}, text('p', 'eyebrow', 'SERVICE APP STUDIO'), text('h1', '', isProvider ? 'Customer connections' : 'Your Webex organization')),
        button('Refresh status', async () => { people = []; hasMore = false; }, true)), message(),
      state ? (isProvider ? provider() : customer()) : text('p', '', 'Loading connection status…'),
      text('footer', 'fine', 'Webex developer sample · Read-only directory access · Secrets stay on the server'))));
}
try {
  await refresh();
  const query = new URLSearchParams(window.location.search);
  notice = query.get('notice') || '';
  if (query.has('notice')) history.replaceState(null, '', '/');
  render();
} catch (error) { root.replaceChildren(el('main', { id: 'main', class: 'loading' }, text('h1', '', 'Could not open the sample'), text('p', '', error.message))); }
