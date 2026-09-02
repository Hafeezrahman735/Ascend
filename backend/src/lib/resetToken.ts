import crypto from 'crypto';

/**
 * Password-reset token minting and hashing.
 *
 * Separated from the route so the security properties can be tested directly:
 * that the raw token never equals what is stored, that hashing is deterministic
 * (or the lookup could never find it), and that two mints never collide.
 */

/**
 * Thirty minutes.
 *
 * Long enough to survive a slow inbox, a locked phone and a walk to a laptop.
 * Short enough that a link sitting in a mailbox synced to a shared desktop
 * stops working within the hour. Fifteen is hostile to anyone whose mail is
 * delayed — and mail from a single-sender free tier often is. Sixty is a long
 * life for a single-use credential delivered over a channel we do not control.
 */
export const RESET_TOKEN_TTL_MINUTES = 30;

/** 256 bits of CSPRNG output, URL-safe so it survives an email client intact. */
export function mintResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * SHA-256, hex.
 *
 * Not bcrypt, and that is not an oversight. bcrypt is deliberately slow to make
 * guessing a LOW-entropy secret expensive; a password needs that. This token
 * has 256 bits of entropy, so guessing is already impossible, and a slow hash
 * would only make every redemption slow. What hashing buys here is that a
 * database read yields nothing usable — and a fast hash buys that just as well.
 */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function resetTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
}

/**
 * The deep link the email points at.
 *
 * `ascend://reset-password?token=…`, which resolves to app/(auth)/reset-password.
 * The `(auth)` group is load-bearing and invisible in the URL: expo-router
 * excludes groups from the path, and the root layout's auth guard redirects any
 * signed-out user whose first segment is not `(auth)` straight to login. A
 * reset screen anywhere else would be bounced before it could read the token —
 * by the person who most needs it, since forgetting your password is precisely
 * the state of being signed out.
 */
export function resetDeepLink(scheme: string, token: string): string {
  return `${scheme}://reset-password?token=${encodeURIComponent(token)}`;
}
