import crypto from 'crypto';

/**
 * Authenticated encryption for third-party tokens held at rest.
 *
 * Google OAuth access and refresh tokens were stored as bare strings in
 * external_calendar_connections, so a read of that table was a read of every
 * connected user's calendar. These are not our credentials to lose.
 *
 * AES-256-GCM: the tag makes tampering detectable, which matters because a
 * silently corrupted refresh token would otherwise surface as a confusing
 * Google API error weeks later.
 *
 * OPTIONAL BY DESIGN. With TOKEN_ENCRYPTION_KEY unset the functions below are
 * pass-throughs and the server boots exactly as before. Making the key required
 * would have meant the next deploy failing at startup until it was set in
 * Railway, which is a worse outcome than the thing being fixed. Set the key,
 * deploy, and rows re-encrypt as they are written.
 */

const PREFIX = 'v1:';

/**
 * Read from process.env rather than the config object on purpose. config.ts
 * validates the whole environment at import time and calls process.exit(1) when
 * anything is missing, which makes it unimportable from a unit test — and this
 * is the one module in the codebase whose correctness most needs testing in
 * isolation. The format check still happens at boot: config.ts owns the schema
 * entry, this owns the use.
 */
function key(): Uint8Array | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  // 64 hex chars = 32 bytes, format-validated by config.ts at boot. Uint8Array
  // rather than Buffer because that is what this @types/node types CipherKey as.
  return new Uint8Array(Buffer.from(raw, 'hex'));
}

export function isEncryptionEnabled(): boolean {
  return key() !== null;
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64url. Plaintext when no key is set. */
export function seal(plaintext: string): string {
  const k = key();
  if (!k || plaintext === '') return plaintext;
  const iv = new Uint8Array(crypto.randomBytes(12));
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([new Uint8Array(cipher.update(plaintext, 'utf8')), new Uint8Array(cipher.final())]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.from(iv).toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

/**
 * Reverses `seal`. A value with no prefix is returned untouched, which is what
 * makes this deployable against a table already full of plaintext: existing
 * rows keep working and get sealed the next time they are written.
 */
export function open(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) {
    // Sealed rows exist but the key is gone. Failing loudly beats handing an
    // unusable ciphertext to Google and debugging the 401 that follows.
    throw new Error('TOKEN_ENCRYPTION_KEY is not set, but a stored token is encrypted');
  }
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, new Uint8Array(Buffer.from(ivB64, 'base64url')));
  decipher.setAuthTag(new Uint8Array(Buffer.from(tagB64, 'base64url')));
  return Buffer.concat([
    new Uint8Array(decipher.update(new Uint8Array(Buffer.from(ctB64, 'base64url')))),
    new Uint8Array(decipher.final()),
  ]).toString('utf8');
}
