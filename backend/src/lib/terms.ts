/**
 * The Terms of Use version this server is currently serving.
 *
 * The SERVER is the authority here, not the client. A client tells us that a
 * user accepted the terms; it does not get to tell us which version, because
 * that value is a consent record and an arbitrary client-supplied string in a
 * consent record is worth nothing. The client's constant in
 * mobile/constants/legal.ts is compared against this one to decide whether the
 * app is showing current text, and this one is what gets stamped on the row.
 *
 * LOADED: any account whose stored termsVersion is null or differs from this is
 * routed to the terms gate before it can reach the app. Bumping this therefore
 * re-prompts the ENTIRE user base on their next launch. Do it when the terms
 * materially change, not to fix a typo.
 *
 * Keep in step with mobile/constants/legal.ts and the hosted public copy.
 */
export const CURRENT_TERMS_VERSION = '2026-09-08';

/** True when the account has accepted the version this server is serving. */
export function hasAcceptedCurrentTerms(user: {
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
}): boolean {
  return user.termsAcceptedAt !== null && user.termsVersion === CURRENT_TERMS_VERSION;
}
