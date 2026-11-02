import { mkdirSync, existsSync, lstatSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireThat } from './security.mjs';

export const SERVICE_APP_DETAILS = ['SERVICE_APP_NAME', 'SERVICE_APP_MANAGE_URL'];
export const PROVIDER_FIELDS = ['SERVICE_APP_ID', 'SERVICE_APP_CLIENT_ID', 'SERVICE_APP_CLIENT_SECRET', ...SERVICE_APP_DETAILS,
  'PROVIDER_INTEGRATION_CLIENT_ID', 'PROVIDER_INTEGRATION_CLIENT_SECRET', 'PROVIDER_WEBEX_PERSON_ID',
  'CUSTOMER_INTEGRATION_CLIENT_ID', 'CUSTOMER_INTEGRATION_CLIENT_SECRET', 'WEBHOOK_SECRET',
  'DATASOURCE_SCHEMA_ID', 'DATASOURCE_BASE_URL'];

export function serviceAppDetails(config) {
  const name = config.SERVICE_APP_NAME || '', manageUrl = config.SERVICE_APP_MANAGE_URL || '';
  requireThat(name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(name), 400, 'Use a Service App name of up to 200 characters.');
  requireThat(!manageUrl || /^https:\/\/developer\.webex\.com\/my-apps\/[a-z0-9][a-z0-9-]*\/?$/.test(manageUrl),
    400, 'Use the Service App detail URL under https://developer.webex.com/my-apps/.');
  return { name, manageUrl };
}

export function dataSourceSettings(config) {
  const schemaId = config.DATASOURCE_SCHEMA_ID || (config.MODE === 'demo' ? '5397013b-7920-4ffc-807c-e8a3e0a18f43' : '');
  const base = config.DATASOURCE_BASE_URL || (config.MODE === 'demo' ? 'https://provider.example' : '');
  if (!schemaId && !base) return null;
  requireThat(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(schemaId), 400, 'Enter the Data Source schema UUID selected on your Service App.');
  let url;
  try { url = new URL(base); } catch { /* Report configuration errors without echoing the URL. */ }
  requireThat(url && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && !url.port && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)
    && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local'),
  400, 'Use a public HTTPS endpoint base URL without credentials, a port, query, or fragment.');
  return { schemaId, baseUrl: url.href.replace(/\/+$/, '') };
}

export function localKey(directory, legacyKey) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  requireThat(!lstatSync(directory).isSymbolicLink(), 500, 'The private data directory must not be a symbolic link.');
  chmodSync(directory, 0o700);
  const path = join(directory, 'master.key');
  if (!existsSync(path)) {
    requireThat(legacyKey || !['live.sqlite', 'demo.sqlite'].some(file => existsSync(join(directory, file))),
      500, 'The encryption key is missing for an existing database. Restore master.key or supply the original migration key.');
    const key = legacyKey || randomBytes(32).toString('base64');
    requireThat(Buffer.from(key, 'base64').length === 32, 500, 'The existing encryption key is invalid.');
    // Exclusive creation prevents a second process from replacing the key protecting stored tokens.
    writeFileSync(path, key, { mode: 0o600, flag: 'wx' });
  }
  requireThat(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 500, 'The local encryption key must be a regular file.');
  chmodSync(path, 0o600);
  const key = readFileSync(path, 'utf8');
  requireThat(Buffer.from(key, 'base64').length === 32, 500, 'The local encryption key is invalid. Restore its backup.');
  requireThat(!legacyKey || legacyKey === key, 500, 'The existing environment key differs from the local key. Preserve the key matching your database.');
  return key;
}
