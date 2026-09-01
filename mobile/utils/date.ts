/**
 * The device's calendar date as 'YYYY-MM-DD'.
 *
 * Send this as `localDate` on any request whose meaning is day-shaped — session
 * completion, recurring-task spawning, streak checks. The server uses it instead
 * of its own UTC date so a user's day ends at their midnight, not the server's.
 * See backend/src/lib/localDate.ts for the other half of this contract.
 */
export function getLocalDateString(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The device's IANA timezone, e.g. 'America/New_York'.
 *
 * Sent alongside `localDate` when a session completes. The DATE still comes
 * from the device's own calendar — it knows what day it is for its user better
 * than any zone the server could infer — but the server needs the zone to place
 * the session in an hour-of-day bucket for reports.
 *
 * Returns null rather than throwing if the platform cannot resolve one; the
 * server then stamps the UTC hour and marks it approximate.
 */
export function getDeviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Whole calendar days from today until a 'YYYY-MM-DD' date, in the device's
 * current timezone. Negative means overdue, 0 means today.
 *
 * Deliberately compares calendar dates rather than subtracting epoch
 * milliseconds. The old `Math.ceil((deadline - Date.now()) / 86400000)` measured
 * rolling 24-hour buckets off a stored instant, so "days left" drifted through
 * the day and shifted if the user travelled or crossed DST.
 */
export function daysUntilLocalDate(target: string | null | undefined): number | null {
  if (!target) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
  if (!m) return null;

  // Compare both sides as UTC midnights so the subtraction is exact whole days
  // and never crosses a DST boundary mid-calculation.
  const targetUTC = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((targetUTC - todayUTC) / 86400000);
}

// ─── Calendar view ranges ────────────────────────────────────────────────────
// All range maths runs on local calendar days and returns 'YYYY-MM-DD', matching
// what the /calendar endpoint expects.

/** 0 = Sunday, 1 = Monday — mirrors SettingsData['weekStartDay']. */
export type WeekStartDay = 0 | 1;

/**
 * Start of the week containing `date`.
 *
 * `weekStartsOn` defaults to Sunday to preserve existing behaviour; the Calendar
 * tab passes the user's setting.
 */
export function startOfWeek(date: Date, weekStartsOn: WeekStartDay = 0): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function endOfWeek(date: Date, weekStartsOn: WeekStartDay = 0): Date {
  const d = startOfWeek(date, weekStartsOn);
  d.setDate(d.getDate() + 6);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Add days to a date without mutating it. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Every day in an inclusive range, as 'YYYY-MM-DD'. */
export function eachDayOfRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    days.push(getLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Parse a 'YYYY-MM-DD' into a local-midnight Date (never UTC-shifted). */
export function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return getLocalDateString(a) === getLocalDateString(b);
}

/** Human label for a deadline: "3d left", "Due today", "2d overdue". */
export function formatDeadlineLabel(target: string | null | undefined): string | null {
  const days = daysUntilLocalDate(target);
  if (days === null) return null;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  return `${days}d left`;
}

/**
 * The floor for a date picker that means "today or later".
 *
 * iOS throws — a native crash, not a warning — when the value a picker opens on
 * sits in a month outside its own bounds:
 *
 *   Unable to set a visible month that is before the minimum or after the
 *   maximum date.
 *
 * `new Date()` is the wrong floor for this. It is *this instant*, so a date
 * held as local midnight is already beneath it before the user touches
 * anything, and an item whose date has passed — an overdue task, a goal past
 * its deadline — sits whole months beneath it. That second case is the one that
 * crashed: opening the editor on an overdue item was enough.
 *
 * So the floor is the start of today, which is what "today or later" actually
 * means, and it drops back to `value` whenever `value` is older. An existing
 * date therefore stays displayable no matter how stale it is; only choosing a
 * date fresh stays bounded to today.
 */
export function pickerMinimumDate(value: Date, now: Date = new Date()): Date {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return value < startOfToday ? value : startOfToday;
}
