import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './security.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, org_id TEXT UNIQUE, webex_org_id TEXT, org_name TEXT,
      status TEXT NOT NULL DEFAULT 'Not connected', credentials TEXT,
      verified_by TEXT, connected_at INTEGER, last_checked INTEGER, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('provider','customer')),
      tenant_id TEXT REFERENCES tenants(id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL,
      tenant_id TEXT REFERENCES tenants(id), action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS demo_orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, authorized INTEGER NOT NULL DEFAULT 0);`);
  return {
    db,
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    setting(key, value) {
      if (value !== undefined) db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, value);
      return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
    },
    audit(actor, tenant, action, detail = '') {
      db.prepare('INSERT INTO audit(at,actor,tenant_id,action,detail) VALUES (?,?,?,?,?)')
        .run(Date.now(), actor, tenant, action, detail);
    },
    addAccount(email, name, password, role, tenant = null) {
      db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), email.trim().toLowerCase(), name, hashPassword(password), role, tenant);
    },
    close: () => db.close(),
  };
}
export function seedTenants(store) {
  for (const [id, name] of [['summit', 'Summit Outfitters'], ['northstar', 'Northstar Travel']]) {
    store.run('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)', id, name);
    store.run('INSERT OR IGNORE INTO demo_orgs(id,name) VALUES (?,?)', `demo-${id}`, `${name} Webex`);
  }
}
