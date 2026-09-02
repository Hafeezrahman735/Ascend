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

/**
 * Whole calendar days from `now` until a task's due date. Negative is overdue,
 * 0 is today.
 *
 * This exists because the task path had three different answers to one question
 * and two of them were wrong:
 *
 *   - `calcDaysUntilDue` used Math.ceil over LOCAL midnights. Across a
 *     spring-forward boundary the raw difference is -23h, and Math.ceil(-23/24)
 *     is -0. `-0 < 0` is false in JavaScript, so a task one day overdue did not
 *     take the overdue branch at all — it fell through and rendered as due on a
 *     weekday. The same `< 0` test guards the recurring-task exemption, so that
 *     leaked on the same day.
 *   - The hero card parsed `dueDate` as an instant and then read LOCAL calendar
 *     fields off it. `Task.dueDate` is stored at UTC midnight, so west of UTC a
 *     task due today measured -1 and was excluded by the `>= 0` floor, while a
 *     task due tomorrow measured 0 and was labelled "Today". The row chip on the
 *     same screen said 0. They disagreed by a day.
 *
 * Both sides are UTC midnights here, so the subtraction is exact whole days and
 * never crosses a DST boundary mid-calculation. The regex is a prefix match, not
 * anchored, because both shapes reach the client: the server's ISO DateTime and
 * the date-only string `taskStore.createTask` writes optimistically.
 *
 * `now` is required rather than defaulted. An optional clock is how a test
 * passes and production drifts.
 */
export function daysUntilDue(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  // `|| 0` normalises -0, which is not a value any caller should have to think
  // about and which `< 0` silently disagrees with.
  return (target - today) / 86_400_000 || 0;
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

/**
 * Whether a picker that opened with `floor` can safely be handed `value`.
 *
 * This is the second half of the same iOS crash `pickerMinimumDate` addresses,
 * and it is not a duplicate of it. That function keeps the two props consistent
 * with each other; this one keeps them safe to APPLY, which is a different
 * problem, because the native component does not apply them together:
 *
 *   RNDateTimePickerComponentView.mm, updatePropsForPicker
 *     line 172:  picker.date = <new date>          // written first
 *     line 188:  picker.minimumDate = nil          // floor relaxed sixteen
 *     line 194:  picker.minimumDate = <new floor>  // lines later
 *
 * So a commit that moves both writes the new date while the OLD floor is still
 * installed on the picker, and UIKit throws if the date is beneath it. Deriving
 * the floor from the value — which is what makes them consistent — is exactly
 * what makes them always move together, so the two fixes have to work as a pair.
 *
 * The rule that follows: capture the floor when the picker OPENS and hold it,
 * then refuse to render a picker whose value has since dropped below it. While
 * the picker is open every value comes from the picker itself and is inside its
 * own bounds, so this is only ever false when something outside changed the date
 * underneath it — re-seeding the form for another task, or clearing the field.
 * Unmounting there is both correct and free: a picker left open from the item
 * you were editing a moment ago should not still be on screen.
 */
export function pickerAcceptsValue(floor: Date, value: Date): boolean {
  return value.getTime() >= floor.getTime();
}
