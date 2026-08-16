/**
 * The app's local-date convention, in one place.
 *
 * Anything day-shaped — streaks, daily goals, recurring-task spawns — must use
 * the USER'S calendar day, not the server's. A user in UTC-8 is still on Monday
 * at 5pm while the server has already rolled over to Tuesday; keying off server
 * time would end their day early and break their streak nightly.
 *
 * So clients send `localDate` as 'YYYY-MM-DD', and dates derived from it are
 * stored as midnight UTC of that local date. Storing it that way means the UTC
 * getters read back the correct calendar day, which is what lib/streak.ts and
 * the recurring-task day-bounds queries rely on.
 */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date of `d` in UTC, as 'YYYY-MM-DD'. */
export function utcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * A client-supplied local date is plausible only within one calendar day of the
 * reference instant's UTC date. Real timezones span UTC-12..UTC+14, so ±1 day
 * covers every device on earth while rejecting dates chosen to game streaks.
 */
export function isPlausibleLocalDate(localDate: string, reference: Date): boolean {
  if (!YYYY_MM_DD.test(localDate)) return false;
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const referenceMidnight = new Date(`${utcDateStr(reference)}T00:00:00.000Z`);
  return Math.abs(parsed.getTime() - referenceMidnight.getTime()) <= 24 * 60 * 60 * 1000;
}

/**
 * Resolve the date to treat as "today" for this request.
 *
 * Falls back to the reference instant's UTC date when the client sends nothing
 * or sends something implausible — degrading to a possibly-wrong timezone beats
 * rejecting the request and losing the user's work.
 */
export function resolveLocalDate(
  localDate: string | null | undefined,
  reference: Date = new Date(),
  context = 'request',
): string {
  if (localDate) {
    if (isPlausibleLocalDate(localDate, reference)) return localDate;
    console.warn(`[localDate] Implausible localDate "${localDate}" on ${context} — falling back to UTC date`);
  }
  return utcDateStr(reference);
}

/** Lowercase 3-letter weekday ('sun'…'sat') for a 'YYYY-MM-DD' local date. */
export function dayNameFromLocalDate(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00.000Z`);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()];
}
