/**
 * Wall-clock arithmetic for the demo account seed.
 *
 * The demo is screenshotted on a phone, and the phone decides what "today" is.
 * Every date the seed writes is therefore built in the phone's timezone and
 * converted to an instant, never the other way round — otherwise a session
 * seeded at "9pm yesterday" lands on today for anyone west of UTC and the
 * Focus screen's "today" total is wrong.
 */
import { localPartsOf, shiftDateKey, daysBetweenKeys } from '../localParts';

/** 'YYYY-MM-DD' of `instant` on the wall clock in `timeZone`. */
export function dateKeyIn(instant: Date, timeZone: string): string {
  return localPartsOf(instant, timeZone).dateKey;
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads `hour:minute` on `dateKey`.
 *
 * Two passes: the first finds the zone's offset near the target, the second
 * corrects for a DST change falling between that guess and the answer.
 */
export function zonedInstant(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let instant = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  }
  return new Date(instant);
}

/**
 * A calendar day as the app stores Task.dueDate and User.lastActiveDate:
 * midnight UTC of that local date, so UTC getters read back the right day.
 */
export function calendarDay(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export { shiftDateKey };

export interface Streaks {
  current: number;
  longest: number;
  /** Most recent day with activity, or null for none. */
  lastActive: string | null;
}

/**
 * Current and longest run of consecutive days in `dateKeys`.
 *
 * A run ending yesterday still counts as current, because that is the rule
 * POST /auth/me/streak-check applies: the streak only resets once a whole day
 * has gone by with nothing in it.
 */
export function streaksFrom(dateKeys: Iterable<string>, today: string): Streaks {
  const days = [...new Set(dateKeys)].sort();
  if (days.length === 0) return { current: 0, longest: 0, lastActive: null };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetweenKeys(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const lastActive = days[days.length - 1];
  const gap = daysBetweenKeys(lastActive, today);
  // `run` is the length of the run that ends on lastActive.
  const current = gap === 0 || gap === 1 ? run : 0;
  return { current, longest, lastActive };
}
