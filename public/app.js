let session, state, notice = '', isError = false, busy = false, people = [], hasMore = false;
let setupCode = '', setupPath = null, settingsOpen = false;
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
const button = (label, action, secondary = false) => el('mdc-button', { class: secondary ? 'button secondary' : 'button',
  variant: secondary ? 'secondary' : 'primary', color: 'accent', size: '40',
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
function portalHeader() {
  return el('header', { class: 'portal-header' },
    el('a', { class: 'brand', href: 'https://developer.webex.com', 'aria-label': 'Webex for Developers' },
      text('span', 'brand-symbol', '</>'), el('span', {}, 'Webex', text('span', 'brand-subtitle', 'for Developers'))),
    el('span', { class: 'header-context' }, 'Samples', text('span', '', 'Service App Studio')));
}
function banner() {
  return text('div', `mode-banner ${session.mode}`, session.mode === 'demo'
    ? 'DEMO MODE · Fixture identities and directory data. No Webex requests are made.'
    : 'LIVE MODE · Real Webex authorization, identities, and customer organization data.');
}
function message() { return notice ? el('div', { class: `notice ${isError ? 'error' : ''}`, role: isError ? 'alert' : 'status' }, notice) : null; }
function field(label, name, type = 'text', value = '', props = {}) {
  return el('div', { class: 'form-field' }, el('label', { for: name }, label),
    el('input', { id: name, name, type, value, autocomplete: type === 'password' ? 'off' : 'on', ...props }));
}
function bootstrap() {
  const form = el('form', { class: 'bootstrap-form', onSubmit: event => {
    event.preventDefault(); const values = new FormData(event.target);
    run(async () => {
      await api('/api/setup', { email: values.get('email'), password: values.get('password'), setupToken: values.get('setupToken') });
      setupCode = ''; notice = 'Provider account created. Add the Webex registrations you already have.';
    });
  } }, text('p', 'eyebrow', 'FIRST-RUN SETUP'), text('h1', '', 'Set up your provider account'),
  text('p', 'muted', 'Create the local administrator account for this sample. You can add existing Webex credentials or create the missing registrations next.'),
  field('Setup code', 'setupToken', 'password', setupCode, { required: true, maxlength: '128' }),
  text('small', 'muted', 'Use the private setup link or code printed in the server terminal. It works only until the first account is created.'),
  field('Email address', 'email', 'email', '', { required: true, autocomplete: 'username', maxlength: '254' }),
  field('Password', 'password', 'password', '', { required: true, minlength: '12', maxlength: '256', autocomplete: 'new-password' }),
  text('small', 'muted', 'Use 12–256 characters. This is your local sample account, separate from Webex.'),
  el('button', { class: 'button', type: 'submit', disabled: busy }, 'Create provider account'));
  return el('div', {}, portalHeader(), el('main', { id: 'main', class: 'bootstrap-shell' }, banner(), message(), form));
}
function providerSettings() {
  const c = state.configuration, saved = state.providerSetup;
  if (!saved?.managed || session.mode === 'demo') return null;
  const ready = c.serviceApp && c.providerOAuth && c.customerOAuth;
  const heading = el('div', { class: 'section-heading' }, el('div', {}, text('p', 'eyebrow', 'PROVIDER ONBOARDING'),
    text('h2', '', 'Webex registrations')), ready ? button(settingsOpen ? 'Hide registration details' : 'Edit registration details', () => { settingsOpen = !settingsOpen; }, true) : null);
  if (ready && !settingsOpen) return el('section', { class: 'panel' }, heading,
    text('p', 'muted', 'Registration credentials are saved. Secrets are encrypted on the server and are never returned to this browser.'));
  const selected = setupPath || (c.serviceApp ? (c.providerOAuth ? 'both' : 'service') : c.providerOAuth ? 'integration' : 'neither');
  const choices = el('fieldset', { class: 'setup-choices' }, el('legend', {}, 'What do you already have?'),
    [['both', 'Service App and Integration'], ['service', 'Service App only'], ['integration', 'Integration only'], ['neither', 'Neither yet']]
      .map(([value, label]) => el('label', {}, el('input', { type: 'radio', name: 'setupPath', value, checked: selected === value,
        onChange: () => { setupPath = value; render(); } }), label)));
  const portal = () => el('a', { href: 'https://developer.webex.com/my-apps', target: '_blank', rel: 'noopener noreferrer' }, 'Open My Webex Apps');
  const registration = (title, help, scope, callback, fields) => el('fieldset', { class: 'registration' }, el('legend', {}, title),
    text('p', 'muted', help), portal(), text('p', 'fine scopes', `Scopes: ${scope}`),
    !callback ? text('p', 'fine', 'For own-org testing, request admin authorization in the Service App details, then have a Full Administrator approve it in Control Hub. External customer organizations require App Hub approval.') : null,
    callback ? el('p', { class: 'fine' }, 'Redirect URI: ', text('code', 'identifier', `${session.baseUrl}${callback}`)) : null, fields);
  const secret = (label, key, configured) => field(label, key, 'password', '', {
    maxlength: '2048', placeholder: configured ? 'Saved · leave blank to keep' : 'Paste the client secret', autocomplete: 'off' });
  const form = el('form', { class: 'settings-form', onSubmit: event => {
    event.preventDefault(); const values = new FormData(event.target);
    const body = Object.fromEntries([...values.entries()].filter(([key]) => key !== 'setupPath'));
    run(async () => { await api('/api/provider/settings', body); settingsOpen = false; setupPath = null; notice = 'Available registrations saved securely. Connect the provider Integration when ready.'; });
  } }, choices,
  text('p', 'fine', 'For missing registrations, create them in Webex and return here with their credentials. The sample does not create Webex apps or accept their terms for you.'),
  registration('1. Service App', ['both', 'service'].includes(selected)
    ? 'Use your existing Service App. Confirm that it requests the directory scopes below.'
    : 'In My Webex Apps, choose Create a New App → Create a Service App. Copy the App ID, client ID, and client secret.',
    'spark-admin:people_read, spark-admin:organizations_read', null,
    [field('Service App ID', 'SERVICE_APP_ID', 'text', saved.serviceAppId, { maxlength: '2048' }),
      field('Service App client ID', 'SERVICE_APP_CLIENT_ID', 'text', saved.serviceAppClientId, { maxlength: '2048' }),
      secret('Service App client secret', 'SERVICE_APP_CLIENT_SECRET', c.serviceApp)]),
  registration('2. Provider Integration', ['both', 'integration'].includes(selected)
    ? 'Use an Integration owned by the Service App developer. Add the scopes and redirect URI below.'
    : 'Create a separate Integration for the developer who owns the Service App. Add the scopes and redirect URI below.',
    'spark:people_read, spark:applications_token', '/oauth/provider/callback',
    [field('Provider Integration client ID', 'PROVIDER_INTEGRATION_CLIENT_ID', 'text', saved.providerClientId, { maxlength: '2048' }),
      secret('Provider Integration client secret', 'PROVIDER_INTEGRATION_CLIENT_SECRET', c.providerOAuth)]),
  registration('3. Customer verification Integration', 'Use a separate Integration for customer Webex verification. It requests read access to verify the assigned Full Administrator role.',
    'spark:people_read, spark-admin:people_read, spark-admin:roles_read', '/oauth/customer/callback',
    [field('Customer Integration client ID', 'CUSTOMER_INTEGRATION_CLIENT_ID', 'text', saved.customerClientId, { maxlength: '2048' }),
      secret('Customer Integration client secret', 'CUSTOMER_INTEGRATION_CLIENT_SECRET', c.customerOAuth)]),
  field('Optional webhook signing secret', 'WEBHOOK_SECRET', 'password', '', { maxlength: '2048', placeholder: c.webhook ? 'Saved · leave blank to keep' : 'Leave blank if not using lifecycle webhooks' }),
  text('p', 'fine', 'Blank secret fields keep saved secrets. Supply all fields for each registration you add. Disconnect customer organizations before replacing registrations.'),
  el('button', { class: 'button', type: 'submit', disabled: busy }, 'Save available registrations'));
  return el('section', { class: 'panel' }, heading, form);
}
function customerAccounts() {
  if (!state.providerSetup?.managed) return null;
  const pending = state.tenants.filter(t => !state.providerSetup.customerAccounts.includes(t.id));
  if (!pending.length) return null;
  return el('section', { class: 'panel' }, text('p', 'eyebrow', 'LOCAL CUSTOMER ACCESS'), text('h2', '', 'Create a sample customer sign-in'),
    text('p', 'muted', 'Create a separate local customer account, then use another browser profile to connect its Webex organization.'),
    el('form', { class: 'customer-account-form', onSubmit: event => {
      event.preventDefault(); const values = new FormData(event.target);
      run(async () => { await api('/api/provider/customer', Object.fromEntries(values)); notice = 'Customer sign-in created. Share its credentials privately with your tester.'; });
    } }, el('label', { for: 'tenantId' }, 'Sample customer'), el('select', { id: 'tenantId', name: 'tenantId' }, pending.map(t => el('option', { value: t.id }, t.name))),
    field('Customer email address', 'customerEmail', 'email', '', { name: 'email', required: true, maxlength: '254', autocomplete: 'off' }),
    field('Customer password', 'customerPassword', 'password', '', { name: 'password', required: true, minlength: '12', maxlength: '256', autocomplete: 'new-password' }),
    el('button', { class: 'button', type: 'submit', disabled: busy }, 'Create customer sign-in')));
}
function login() {
  const form = el('form', { class: 'login-form', onSubmit: event => {
    event.preventDefault(); const data = new FormData(event.target);
    run(async () => { await api('/api/login', { email: data.get('email'), password: data.get('password') }); people = []; });
  } }, text('p', 'eyebrow', 'ONE APP. TWO PERSPECTIVES.'), text('h2', '', 'Welcome back'),
  text('p', 'muted', 'Use your provider or customer account. Your account determines your experience.'),
  el('label', { for: 'email' }, 'Email address'), el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.test' }),
  el('label', { for: 'password' }, 'Password'), el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: '256' }),
  el('button', { class: 'button', type: 'submit', disabled: busy }, busy ? 'Signing in…' : 'Sign in →'),
  text('p', 'fine', 'Use the local account created during provider setup. There are no default passwords.'));
  return el('div', {}, portalHeader(), el('div', { class: 'login-shell' }, el('section', { class: 'intro' },
    text('p', 'eyebrow', 'SERVICE APP STUDIO'), text('h1', '', 'Connect your customers\nto Webex.'),
    text('p', 'intro-copy', 'Approve in Webex. Verify your identity. Choose the provider account. Only then activate the Service App.'),
    el('ol', { class: 'flow' }, ['Authorize the Service App', 'Verify the Webex administrator', 'Confirm the organization link'].map((s, i) => el('li', {}, text('span', '', `0${i + 1}`), s))),
    text('p', 'intro-foot', 'A Webex Service App provider sample')),
    el('main', { id: 'main', class: 'login-panel' }, banner(), message(), form)));
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
  if (session.mode === 'live' && !state.configuration.providerOAuth) connectionButton.setAttribute('disabled', '');
  const config = state.configuration;
  const setup = el('section', { class: 'panel provider-setup' },
    el('div', {}, text('p', 'eyebrow', 'PROVIDER SETUP'), text('h2', '', 'Token-management connection'),
      text('p', 'muted', session.mode === 'demo' ? 'Connect the fixture provider Integration to exercise customer onboarding without Webex credentials.'
        : 'Connect as the Webex developer who owns the Service App. The first verified developer identity is saved for later connections. Customer sign-in uses its separate Integration.')),
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
  return [providerSettings(), setup, configurations, customerAccounts(), demo, el('section', { class: 'panel' }, text('p', 'eyebrow', 'PROVIDER ACCOUNTS'), text('h2', '', 'Customer connections'),
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
  if (session.setupRequired) { root.replaceChildren(bootstrap()); return; }
  if (!session.account) { root.replaceChildren(login()); return; }
  const isProvider = session.account.role === 'provider';
  root.replaceChildren(portalHeader(), el('div', { class: 'app-shell' },
    el('aside', { class: 'sidebar' }, text('p', 'eyebrow sidebar-label', isProvider ? 'PROVIDER EXPERIENCE' : 'CUSTOMER EXPERIENCE'),
      el('nav', { 'aria-label': isProvider ? 'Provider navigation' : 'Customer navigation' },
        el('a', { class: 'nav-active', href: '#main', 'aria-current': 'page' }, isProvider ? 'Customer connections' : 'Webex organization')),
      el('div', { class: 'sidebar-note' }, text('strong', '', 'Customer-initiated onboarding'), text('p', '', 'Verify identity, review the organization, and confirm the account link.')),
      el('div', { class: 'account' }, text('strong', '', session.account.name), text('small', '', session.account.email),
        button('Sign out', async () => { await api('/api/logout', {}); people = []; notice = ''; }, true))),
    el('main', { id: 'main', class: 'workspace', 'aria-busy': busy }, banner(),
      el('header', { class: 'page-heading' }, el('div', {}, text('p', 'eyebrow', 'SERVICE APP STUDIO'), text('h1', '', isProvider ? 'Customer connections' : 'Your Webex organization')),
        button('Refresh status', async () => { people = []; hasMore = false; }, true)), message(),
      state ? (isProvider ? provider() : customer()) : text('p', '', 'Loading connection status…'),
      text('footer', 'fine', 'Webex developer sample · Read-only directory access · Secrets stay on the server'))));
}
try {
  const fragment = new URLSearchParams(location.hash.slice(1));
  setupCode = fragment.get('setup') || '';
  if (fragment.has('setup')) history.replaceState(null, '', location.pathname + location.search);
  await customElements.whenDefined('mdc-button');
  await refresh();
  const query = new URLSearchParams(window.location.search);
  notice = query.get('notice') || '';
  if (query.has('notice')) history.replaceState(null, '', '/');
  render();
} catch (error) { root.replaceChildren(el('main', { id: 'main', class: 'loading' }, text('h1', '', 'Could not open the sample'), text('p', '', error.message))); }
