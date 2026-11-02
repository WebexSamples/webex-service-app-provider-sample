let session, state, notice = '', isError = false, busy = false, people = [], hasMore = false;
let setupCode = '', settingsOpen = false;
const providerPages = ['service-app', 'developer-integration', 'customer-verification', 'customers', 'activity'];
let providerPage = providerPages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'service-app';
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
    ? 'DEMO MODE · Fixture identities, directory data, and Data Sources. No Webex requests are made.'
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
function setupStatus(page) {
  const demo = session.mode === 'demo', c = state.configuration;
  if (page === 'service-app') return demo || c.serviceApp ? 'Configured' : 'Needs setup';
  if (page === 'developer-integration') return state.providerConnected ? 'Connected' : demo || c.providerOAuth ? 'Ready to connect' : 'Needs setup';
  return demo || c.customerOAuth ? 'Configured' : 'Needs setup';
}
const nextStep = (page, label) => el('a', { class: 'next-step', href: `#${page}` }, label, el('span', { 'aria-hidden': 'true' }, ' →'));
function providerSettings(page) {
  const c = state.configuration, saved = state.providerSetup;
  const service = page === 'service-app', developer = page === 'developer-integration';
  const title = service ? 'Service App' : developer ? 'Developer Integration' : 'Customer Verification';
  const ready = service ? c.serviceApp : developer ? c.providerOAuth : c.customerOAuth;
  const description = service ? 'The Service App acts on behalf of each customer organization after its administrator approves access.'
    : developer ? 'Connect the Webex developer who owns your Service App. This Integration retrieves customer-specific Service App tokens.'
      : 'A separate Integration verifies each customer’s Webex administrator before the customer confirms an organization link.';
  const next = service ? nextStep('developer-integration', 'Continue to Developer Integration')
    : developer ? null : nextStep('customers', 'Open Customers');
  const heading = el('div', { class: 'section-heading' }, text('h2', '', title), pill(setupStatus(page)));
  if (session.mode === 'demo') return el('section', { class: 'panel' }, heading, text('p', 'muted', description),
    text('p', 'fine', 'This demo uses a fixture registration. No Webex credentials are needed.'), next);
  const portal = el('a', { href: 'https://developer.webex.com/my-apps', target: '_blank', rel: 'noopener noreferrer' }, 'Open My Webex Apps');
  const details = service && ready ? el('div', { class: 'service-app-details' },
    text('h3', '', saved.serviceApp.name || 'Your Service App'),
    saved.serviceApp.manageUrl ? el('a', { href: saved.serviceApp.manageUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Manage Service App' }, 'Manage') : portal) : null;
  if (ready && !settingsOpen) return el('section', { class: 'panel' }, heading, text('p', 'muted', description), details,
    button(`Edit ${title}`, () => { settingsOpen = true; }, true), next);
  if (!saved?.managed) return el('section', { class: 'panel' }, heading, text('p', 'muted', description));
  const secret = (label, key) => field(label, key, 'password', '', {
    maxlength: '2048', placeholder: ready ? 'Saved · leave blank to keep' : 'Paste the client secret', autocomplete: 'off' });
  const inputs = service ? [
    field('Service App name (optional)', 'SERVICE_APP_NAME', 'text', saved.serviceApp.name, { maxlength: '200' }),
    field('Service App manage URL (optional)', 'SERVICE_APP_MANAGE_URL', 'url', saved.serviceApp.manageUrl, { maxlength: '2048', placeholder: 'https://developer.webex.com/my-apps/your-service-app' }),
    field('Service App ID', 'SERVICE_APP_ID', 'text', saved.serviceAppId, { maxlength: '2048', required: true }),
    field('Service App client ID', 'SERVICE_APP_CLIENT_ID', 'text', saved.serviceAppClientId, { maxlength: '2048', required: true }),
    secret('Service App client secret', 'SERVICE_APP_CLIENT_SECRET'),
    el('details', { class: 'registration' }, el('summary', {}, 'Optional Data Source and webhooks'),
      text('p', 'fine', 'For Data Sources, add spark-admin:datasource_read and spark-admin:datasource_write, select the schema and receiver domain on the Service App, and have the customer administrator reauthorize it.'),
      field('Data Source schema ID', 'DATASOURCE_SCHEMA_ID', 'text', saved.dataSourceSchemaId, { maxlength: '36' }),
      field('Data Source endpoint base URL', 'DATASOURCE_BASE_URL', 'url', saved.dataSourceBaseUrl, { maxlength: '2048', placeholder: 'https://connector.example.com' }),
      text('p', 'fine', 'The sample adds /customers/<provider-customer-id> to this base URL. Leave both fields blank if unused.'),
      field('Optional webhook signing secret', 'WEBHOOK_SECRET', 'password', '', { maxlength: '2048', placeholder: c.webhook ? 'Saved · leave blank to keep' : 'Leave blank if unused' }))
  ] : developer ? [
    field('Developer Integration client ID', 'PROVIDER_INTEGRATION_CLIENT_ID', 'text', saved.providerClientId, { maxlength: '2048', required: true }),
    secret('Developer Integration client secret', 'PROVIDER_INTEGRATION_CLIENT_SECRET')
  ] : [field('Customer Integration client ID', 'CUSTOMER_INTEGRATION_CLIENT_ID', 'text', saved.customerClientId, { maxlength: '2048', required: true }),
    secret('Customer Integration client secret', 'CUSTOMER_INTEGRATION_CLIENT_SECRET')];
  const scopes = service ? 'spark-admin:people_read, spark-admin:organizations_read'
    : developer ? 'spark:people_read, spark:applications_token' : 'spark:people_read, spark-admin:people_read, spark-admin:roles_read';
  const form = el('form', { class: 'settings-form', onSubmit: event => {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.target));
    run(async () => { await api('/api/provider/settings', body); settingsOpen = false; notice = `${title} saved securely.`; });
  } }, text('p', 'fine', `Create or open your ${service ? 'Service App' : 'Integration'} in My Webex Apps, then enter its details here.`), portal,
    text('p', 'fine scopes', `Scopes: ${scopes}`),
    service ? text('p', 'fine', 'For own-org testing, request admin authorization on the Service App and approve it in Control Hub. External customer organizations require App Hub approval.')
      : el('p', { class: 'fine' }, 'Redirect URI: ', text('code', 'identifier', `${session.baseUrl}/oauth/${developer ? 'provider' : 'customer'}/callback`)),
    inputs, text('p', 'fine', 'Blank secret fields keep saved secrets. Disconnect customer organizations before replacing registrations.'),
    el('button', { class: 'button', type: 'submit', disabled: busy }, `Save ${title}`));
  return el('section', { class: 'panel' }, heading, text('p', 'muted', description), form, ready ? next : null);
}
function developerConnection() {
  const demo = session.mode === 'demo';
  const connect = demo ? button(state.providerConnected ? 'Reconnect demo Integration' : 'Connect demo Integration', async () => {
    await api('/api/demo/provider', {}); notice = 'Demo provider Integration connected.';
  }) : button(state.providerConnected ? 'Reconnect Webex developer' : 'Connect Webex developer', () => oauth('provider'));
  if (!demo && !state.configuration.providerOAuth) connect.setAttribute('disabled', '');
  return el('section', { class: 'panel' }, el('div', {}, text('h2', '', 'Connect your Webex developer account'),
    text('p', 'muted', 'Use the account that owns the Service App. Customers will verify their own Webex accounts separately.')),
    el('div', { class: 'setup-action' }, pill(state.providerConnected ? 'Connected' : 'Not connected'), connect),
    state.providerConnected ? nextStep('customer-verification', 'Continue to Customer Verification') : null);
}
function providerNavigation() {
  const entry = (page, label, status) => el('a', { class: providerPage === page ? 'nav-active' : '', href: `#${page}`,
    'aria-current': providerPage === page ? 'page' : null }, text('span', '', label),
    status ? el('small', { class: `nav-status ${status === 'Needs setup' ? 'pending' : status === 'Ready to connect' ? 'ready' : 'complete'}` },
      text('span', 'status-dot', ''), status) : null);
  return el('nav', { 'aria-label': 'Provider navigation' }, text('p', 'nav-group', 'Developer Connections'),
    entry('service-app', 'Service App', setupStatus('service-app')),
    entry('developer-integration', 'Developer Integration', setupStatus('developer-integration')),
    entry('customer-verification', 'Customer Verification', setupStatus('customer-verification')),
    text('p', 'nav-group', 'Customer Organizations'), entry('customers', 'Customers'), entry('activity', 'Connection History'));
}
function customerAccounts() {
  if (session.localAccess || !state.providerSetup?.managed) return null;
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
  if (providerPage === 'activity') return auditPanel();
  if (providerPage !== 'customers') return [providerSettings(providerPage), providerPage === 'developer-integration' ? developerConnection() : null];
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
  const incomplete = session.mode === 'live' && (!state.configuration.serviceApp || !state.configuration.providerOAuth
    || !state.configuration.customerOAuth || !state.providerConnected);
  return [incomplete ? el('section', { class: 'panel setup-reminder' }, text('h2', '', 'Finish developer setup'),
    text('p', 'muted', 'Configure the Service App and both Integrations, then connect your Webex developer account before onboarding a customer.'),
    nextStep(!state.configuration.serviceApp ? 'service-app' : !state.configuration.providerOAuth || !state.providerConnected ? 'developer-integration' : 'customer-verification', 'Continue setup')) : null,
    customerAccounts(), demo, el('section', { class: 'panel' }, text('h2', '', 'Customer organizations'),
    text('p', 'muted', 'Organizations linked to your provider customers. Customer directories and secrets stay in each customer workspace.'),
    el('div', { class: 'table-scroll' }, el('table', {}, el('thead', {}, el('tr', {}, ['Customer', 'Webex organization', 'Connection', 'Last successful read'].map(h => el('th', { scope: 'col' }, h)))), el('tbody', {}, rows))))];
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
  const disconnect = t.orgId ? el('details', { class: 'disconnect-confirmation' },
    el('summary', {}, 'Disconnect organization'),
    el('div', { class: 'disconnect-review' }, text('h2', '', 'Disconnect this organization?'),
      text('p', 'fine', 'This removes stored Service App credentials and releases this account link. It does not revoke the Service App in Control Hub or remove a Data Source from Webex. Remove the Data Source first, or reconnect the same organization to manage it later. Reconnecting requires Webex verification and confirmation again.'),
      button('Confirm disconnect', async () => {
        await api('/api/disconnect', { confirm: true }); people = []; notice = 'Disconnected. Revoke authorization separately in Control Hub if needed.';
      }, true))) : null;
  return [summary, directory, dataSourcePanel(t), ...(t.status === 'Connected' ? [] : [guide, el('section', { class: 'panel' }, verification), confirmation]), disconnect, auditPanel()];
}
function dataSourcePanel(t) {
  const saved = state.dataSource, setup = state.dataSourceSetup;
  if (t.status !== 'Connected' && !saved) return null;
  const connected = t.status === 'Connected' && (!saved || saved.matchesConnection);
  const action = (label, name, secondary = false) => {
    const control = button(label, async () => {
      await api('/api/data-source', { action: name, ...(['register', 'remove'].includes(name) ? { confirm: true } : {}) });
      notice = { register: 'Data Source registered. Registration does not verify receiver connectivity.', read: 'Data Source status refreshed.',
        renew: 'Data Source delivery token renewed. The token stays on the server.', remove: 'Data Source removed.' }[name];
    }, secondary);
    if (!connected) control.setAttribute('disabled', '');
    return control;
  };
  const endpoint = saved || setup;
  return el('section', { class: 'panel', id: 'data-source' }, text('p', 'eyebrow', 'PROVIDER ENDPOINT · BYODS'),
    el('div', { class: 'section-heading' }, text('h2', '', 'Customer Data Source'), saved ? pill(saved.status) : null),
    text('p', 'muted', session.mode === 'demo' ? 'Register a simulated provider endpoint for this customer. No Webex requests or deliveries occur.'
      : 'Register the provider endpoint where Webex can send data for this organization. A compatible receiver is required; this sample does not implement one.'),
    endpoint ? el('dl', { class: 'source-details' },
      el('dt', {}, 'Customer endpoint'), el('dd', { class: 'identifier' }, endpoint.url),
      el('dt', {}, 'Schema ID'), el('dd', { class: 'identifier' }, endpoint.schemaId),
      saved ? [el('dt', {}, 'Data Source ID'), el('dd', { class: 'identifier' }, saved.id),
        el('dt', {}, 'Renew by (local estimate)'), el('dd', {}, date(saved.renewBy))] : null) : null,
    !connected ? text('p', 'fine', 'The registration remains in Webex. Reconnect its original organization to refresh, renew, or remove it.')
      : !setup && !saved ? text('p', 'fine', 'The provider must configure a Data Source schema and endpoint base URL before registration.') : null,
    saved ? [text('p', 'fine', 'Status is the last reported registration state. It does not prove endpoint health. Delivery tokens last 60 minutes and must be renewed before expiry; this sample renews only when you select the button.'),
      el('div', { class: 'source-actions' }, action('Refresh data source', 'read', true), action('Renew delivery token', 'renew', true)),
      el('details', { class: 'disconnect-confirmation' }, el('summary', {}, 'Remove data source'),
        el('div', { class: 'disconnect-review' }, text('h3', '', 'Remove this registration from Webex?'),
          text('p', 'fine', 'This removes only this customer’s saved Data Source. It leaves the organization link and directory access connected.'),
          action('Confirm remove data source', 'remove', true)))]
      : connected && setup ? el('details', { class: 'disconnect-confirmation' }, el('summary', {}, 'Register a data source'),
        el('div', { class: 'disconnect-review' }, text('h3', '', 'Register this customer endpoint?'),
          text('p', 'fine', 'Webex may send data to the endpoint above when a consuming feature is configured. Confirm the endpoint and approved schema before registering.'),
          action('Confirm register data source', 'register'))) : null);
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
      isProvider ? providerNavigation() : el('nav', { 'aria-label': 'Customer navigation' },
        el('a', { class: 'nav-active', href: '#main', 'aria-current': 'page' }, 'Webex organization')),
      !isProvider ? el('div', { class: 'sidebar-note' }, text('strong', '', 'Customer-initiated onboarding'), text('p', '', 'Verify identity, review the organization, and confirm the account link.')) : null,
      el('div', { class: `account${session.localAccess ? ' local-workspace' : ''}` }, text('strong', '', session.account.name),
        session.localAccess ? el('div', { class: 'form-field' }, el('label', { for: 'perspective' }, 'Experience'),
          el('select', { id: 'perspective', disabled: busy, onChange: event => {
            const perspective = event.target.value;
            run(async () => { await api('/api/local/perspective', { perspective }); people = []; hasMore = false; settingsOpen = false; });
          } }, session.perspectives.map(p => el('option', { value: p.id,
            selected: p.id === (session.account.tenantId || 'provider') }, p.name))),
          text('small', '', 'Local workspace · no app login'))
          : [text('small', '', session.account.email), button('Sign out', async () => { await api('/api/logout', {}); people = []; notice = ''; }, true)])),
    el('main', { id: 'main', class: 'workspace', 'aria-busy': busy }, banner(),
      el('header', { class: 'page-heading' }, el('div', {}, text('p', 'eyebrow', 'SERVICE APP STUDIO'), text('h1', '', isProvider ? (providerPage === 'customers' ? 'Customers' : providerPage === 'activity' ? 'Connection History' : 'Developer Connections') : 'Your Webex organization')),
        button('Refresh status', async () => { people = []; hasMore = false; }, true)), message(),
      state ? (isProvider ? provider() : customer()) : text('p', '', 'Loading connection status…'),
      text('footer', 'fine', 'Webex developer sample · Directory and Data Source examples · Secrets stay on the server'))));
}
window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (!providerPages.includes(page)) return;
  providerPage = page; settingsOpen = false; notice = ''; isError = false; render();
});
try {
  const fragment = new URLSearchParams(location.hash.slice(1));
  setupCode = fragment.get('setup') || '';
  if (fragment.has('setup')) history.replaceState(null, '', location.pathname + location.search);
  await customElements.whenDefined('mdc-button');
  await refresh();
  const query = new URLSearchParams(window.location.search);
  notice = query.get('notice') || '';
  if (query.has('notice')) history.replaceState(null, '', location.pathname + location.hash);
  render();
} catch (error) { root.replaceChildren(el('main', { id: 'main', class: 'loading' }, text('h1', '', 'Could not open the sample'), text('p', '', error.message))); }
