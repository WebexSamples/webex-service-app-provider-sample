import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export const random = () => randomBytes(32).toString('base64url');
export class AppError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
export function requireThat(condition, status, message, code) {
  if (!condition) throw new AppError(status, message, code);
}
export function hashPassword(password) {
  requireThat(typeof password === 'string' && password.length >= 12 && password.length <= 256,
    400, 'Use a password between 12 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function vault(base64Key) {
  const key = Buffer.from(base64Key || '', 'base64');
  requireThat(key.length === 32, 500, 'Configure a 32-byte ENCRYPTION_KEY with npm run setup.');
  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      // Bind ciphertext to its tenant so copied rows cannot cross tenant boundaries.
      cipher.setAAD(Buffer.from(context));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    open(value, context) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    },
  };
}
export function orgKey(id) {
  if (typeof id !== 'string' || id.length > 512) throw new AppError(502, 'Webex returned an invalid organization identity.');
  const decoded = Buffer.from(id, 'base64url').toString();
  const value = decoded.startsWith('ciscospark://') ? decoded.split('/ORGANIZATION/')[1] : id;
  requireThat(/^[a-zA-Z0-9-]{1,128}$/.test(value || ''), 502, 'Webex returned an invalid organization identity.');
  return value.toLowerCase();
}
