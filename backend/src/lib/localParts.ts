/**
 * What local day and hour an instant falls on, and calendar arithmetic on
 * 'YYYY-MM-DD' strings.
 *
 * Extracted from `taskAnalytics.ts` so session attribution and task analytics
 * cannot drift on the definition of a local day. Two answers to "what day was
 * that session on" is exactly how this codebase ended up with three different
 * definitions of "completion rate".
 *
 * ─── Why bucketing is string comparison ─────────────────────────────────────
 *
 * Local days are not all 24 hours long. Subtracting 86_400_000ms across a DST
 * boundary either skips a local date or repeats one, so every helper here does
 * calendar arithmetic on the date parts instead. ISO date strings also sort
 * correctly with `<` and `>=`, which keeps range checks trivial and lets
 * Postgres do them on an indexed VarChar column.
 */

/** Sunday-first, matching `Intl` weekday output and `Date.getDay()`. */
export const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface LocalParts {
  /** 'YYYY-MM-DD' */
  dateKey: string;
  /** 0-23 */
  hour: number;
  /** 0-6, Sunday-first */
  weekday: number;
}

/**
 * `Intl` throws on an unknown zone, and zones arrive from clients, so they are
 * untrusted input. Fall back to UTC rather than failing a request over a typo.
 */
export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Build a formatter once and reuse it across a loop — constructing an
 * `Intl.DateTimeFormat` per session is the expensive part of any aggregation.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which yields "24" for
 * midnight in some ICU versions and would put every midnight session into a
 * bucket that cannot exist.
 */
export function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
}

export function partsOf(fmt: Intl.DateTimeFormat, d: Date): LocalParts {
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** One-shot convenience for a single instant. Prefer `partsOf` inside loops. */
export function localPartsOf(d: Date, timeZone: string): LocalParts {
  return partsOf(makeFormatter(safeTimeZone(timeZone)), d);
}

/**
 * Shift a 'YYYY-MM-DD' key by whole calendar days.
 *
 * UTC constructors are used purely as calendar arithmetic on the date parts —
 * no instant is involved, so no DST rule can apply and the result is exact.
 */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to`, both 'YYYY-MM-DD'. */
export function daysBetweenKeys(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

/**
 * Weekday of a 'YYYY-MM-DD' key, Sunday-first.
 *
 * Derived from the date string rather than from a timezone so it can never
 * disagree with the `localDate` it belongs to — the client's own local date is
 * authoritative, and the weekday must follow it.
 */
export function weekdayOfDateKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "9am" / "12pm" / "11pm" for an hour in 0..23. */
export function hourLabel(hour: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}${period}`;
}
