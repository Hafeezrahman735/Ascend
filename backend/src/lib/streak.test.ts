import { describe, it, expect } from 'vitest';
import { updateStreak } from './streak';

/** lastActiveDate is stored as midnight UTC of the user's local date. */
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe('updateStreak', () => {
  it('starts a streak on the first ever session', () => {
    expect(updateStreak(null, 0, 0, '2026-10-20')).toEqual({ streak: 1, longestStreak: 1, isNewDay: true });
  });

  it('does nothing for a second session the same day', () => {
    expect(updateStreak(day('2026-10-20'), 4, 6, '2026-10-20')).toEqual({ streak: 4, longestStreak: 6, isNewDay: false });
  });

  it('extends the streak on the next day', () => {
    expect(updateStreak(day('2026-10-19'), 4, 4, '2026-10-20')).toEqual({ streak: 5, longestStreak: 5, isNewDay: true });
  });

  it('restarts after a missed day', () => {
    expect(updateStreak(day('2026-10-17'), 4, 6, '2026-10-20')).toEqual({ streak: 1, longestStreak: 6, isNewDay: true });
  });

  it('ignores a late session from an earlier day instead of resetting', () => {
    // Yesterday's session, finished offline, delivered after today's.
    // It used to compute "not yesterday of today" and reset the streak to 1.
    expect(updateStreak(day('2026-10-20'), 5, 5, '2026-10-19')).toEqual({ streak: 5, longestStreak: 5, isNewDay: false });
  });

  it('ignores a late session from well before the last active day', () => {
    expect(updateStreak(day('2026-10-20'), 5, 7, '2026-10-12')).toEqual({ streak: 5, longestStreak: 7, isNewDay: false });
  });

  it('crosses month and year boundaries', () => {
    expect(updateStreak(day('2026-12-31'), 2, 2, '2027-01-01')).toEqual({ streak: 3, longestStreak: 3, isNewDay: true });
    expect(updateStreak(day('2027-01-01'), 3, 3, '2026-12-31')).toEqual({ streak: 3, longestStreak: 3, isNewDay: false });
  });
});
