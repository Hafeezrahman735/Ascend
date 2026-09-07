import { describe, it, expect } from 'vitest';
import {
  HISTORY_DAYS,
  MAX_SESSIONS_PER_DAY,
  workedDays,
  sessionCountByDay,
  type HistoryShape,
} from './demoHistory';

/**
 * The demo seeder's whole claim is that the numbers on a demo profile are
 * produced by the rows underneath them rather than declared beside them. These
 * assert exactly that, on the five shapes the seeder actually ships.
 */

const PERSONAS: HistoryShape[] = [
  { seed: 'leo_kim', currentStreak: 5, longestStreak: 9, totalSessions: 64 },
  { seed: 'maya_chen', currentStreak: 12, longestStreak: 15, totalSessions: 148 },
  { seed: 'sam_rivera', currentStreak: 8, longestStreak: 19, totalSessions: 172 },
  { seed: 'jordan_blake', currentStreak: 23, longestStreak: 31, totalSessions: 268 },
  { seed: 'priya_patel', currentStreak: 34, longestStreak: 41, totalSessions: 372 },
];

/** Longest run of consecutive worked days anywhere in the history. */
function longestRun(days: number[]): number {
  const worked = new Set(days);
  let longest = 0;
  let run = 0;
  for (let d = 0; d < HISTORY_DAYS; d += 1) {
    if (worked.has(d)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}

describe('workedDays', () => {
  it.each(PERSONAS)('gives $seed a live streak of exactly currentStreak', (shape) => {
    const worked = new Set(workedDays(shape));
    // Every day of the streak, ending today.
    for (let d = 0; d < shape.currentStreak; d += 1) {
      expect(worked.has(d), `day ${d} should be worked`).toBe(true);
    }
    // And the day that ended it, or the streak would read longer than it is.
    expect(worked.has(shape.currentStreak)).toBe(false);
  });

  it.each(PERSONAS)('gives $seed a record run of exactly longestStreak', (shape) => {
    expect(longestRun(workedDays(shape))).toBe(shape.longestStreak);
  });

  it('never lets the sparse older history beat the record', () => {
    // A long history with a short record is where an accidental run is most
    // likely: 60-odd days to fill at ~2-in-3 density, capped at 4.
    const shape: HistoryShape = { seed: 'edge', currentStreak: 3, longestStreak: 4, totalSessions: 200 };
    expect(longestRun(workedDays(shape))).toBe(4);
  });

  it('is deterministic', () => {
    expect(workedDays(PERSONAS[3])).toEqual(workedDays(PERSONAS[3]));
  });

  it('gives two accounts different histories', () => {
    const a = workedDays({ ...PERSONAS[0], seed: 'one' });
    const b = workedDays({ ...PERSONAS[0], seed: 'two' });
    expect(a).not.toEqual(b);
  });
});

describe('sessionCountByDay', () => {
  it.each(PERSONAS)('places exactly totalSessions for $seed', (shape) => {
    const counts = sessionCountByDay(shape);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    // The regression this exists for: the allocation used to stall partway and
    // silently short the two heaviest accounts by about a third.
    expect(total).toBe(shape.totalSessions);
  });

  it.each(PERSONAS)('puts at least one and at most the cap on each day for $seed', (shape) => {
    for (const [day, count] of sessionCountByDay(shape)) {
      expect(count, `day ${day}`).toBeGreaterThanOrEqual(1);
      expect(count, `day ${day}`).toBeLessThanOrEqual(MAX_SESSIONS_PER_DAY);
    }
  });

  it.each(PERSONAS)('only puts sessions on days $seed worked', (shape) => {
    const worked = new Set(workedDays(shape));
    for (const day of sessionCountByDay(shape).keys()) {
      expect(worked.has(day), `day ${day} has sessions but is not a worked day`).toBe(true);
    }
  });

  it('weights recent days more heavily than old ones', () => {
    const counts = sessionCountByDay(PERSONAS[4]);
    const days = [...counts.keys()].sort((a, b) => a - b);
    const recent = days.slice(0, 10).reduce((sum, d) => sum + (counts.get(d) ?? 0), 0);
    const oldest = days.slice(-10).reduce((sum, d) => sum + (counts.get(d) ?? 0), 0);
    expect(recent).toBeGreaterThan(oldest);
  });

  it('stops at the cap rather than overfilling when the target cannot fit', () => {
    // More sessions than 84 days at six a day can hold. Nothing should exceed
    // the cap; the seeder writes whatever was actually placed to the user row.
    const shape: HistoryShape = { seed: 'greedy', currentStreak: 10, longestStreak: 12, totalSessions: 9_000 };
    const counts = sessionCountByDay(shape);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(MAX_SESSIONS_PER_DAY);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeLessThan(shape.totalSessions);
    expect(total).toBeLessThanOrEqual(HISTORY_DAYS * MAX_SESSIONS_PER_DAY);
  });
});
