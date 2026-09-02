import crypto from 'crypto';
import type { Request } from 'express';

/**
 * A single, greppable line per authentication failure.
 *
 * There was no record of any of this before: every 401 in the auth routes
 * returned silently, and morgan is disabled in production, so the question "was
 * this account targeted?" had no answer anywhere. The rate limiter would throttle
 * a burst and leave no evidence of it.
 *
 * Deliberately structured and deliberately small. Railway retains stdout, so
 * these are greppable today without adding a logging service; the shape is JSON
 * so they stay queryable if one is added later.
 */

export type AuthFailureReason =
  | 'no_such_email'
  | 'bad_password'
  | 'refresh_invalid'
  | 'refresh_unknown'
  | 'refresh_user_missing';

/**
 * Emails are hashed, never logged in plaintext.
 *
 * The log has to distinguish "one address tried 400 times" from "400 addresses
 * tried once" — those are different incidents — but it does not need to know
 * which address, and a log full of user emails is its own breach waiting to
 * happen. A truncated SHA-256 keeps the former and discards the latter.
 */
function emailFingerprint(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
}

export function logAuthFailure(
  req: Request,
  reason: AuthFailureReason,
  details: { email?: string; userId?: string } = {},
): void {
  // trust proxy is set, so req.ip is the client rather than Railway's edge.
  console.warn(JSON.stringify({
    evt: 'auth_failure',
    reason,
    ip: req.ip ?? null,
    ...(details.email ? { emailHash: emailFingerprint(details.email) } : {}),
    ...(details.userId ? { userId: details.userId } : {}),
    at: new Date().toISOString(),
  }));
}
