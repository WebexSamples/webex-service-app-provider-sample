import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  // Existing account/example tables are left intact; this console does not use them.
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS managed_service_tokens (
      app_id TEXT NOT NULL, client_id TEXT NOT NULL, org_id TEXT NOT NULL, credentials TEXT NOT NULL,
      PRIMARY KEY (app_id,client_id,org_id));
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, tenant_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, authorized INTEGER NOT NULL DEFAULT 0);`);
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    setting(key, value) {
      if (value !== undefined) db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, value);
      return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
    },
    audit(action, detail = '') {
      db.prepare('INSERT INTO audit(at,actor,tenant_id,action,detail) VALUES (?,?,NULL,?,?)')
        .run(Date.now(), 'local-developer', action, detail);
    },
    close: () => db.close(),
  };
}
export function seedDemoOrganizations(store) {
  for (const [id, name, authorized] of [['demo-summit', 'Summit Outfitters', 1], ['demo-northstar', 'Northstar Travel', 0]]) {
    store.run('INSERT OR IGNORE INTO demo_orgs VALUES (?,?,?)', id, name, authorized);
  }
}
