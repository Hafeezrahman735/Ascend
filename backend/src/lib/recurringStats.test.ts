import { describe, it, expect } from 'vitest';
import { recurringStats } from './recurringStats';

/**
 * Streaks from a recurring task's rule and its done days.
 *
 * 2026-10-05 is a Monday. Every task here was created at noon UTC on the 5th.
 */

const MON = '2026-10-05';
const day = (offset: number) => {
  const d = new Date(`${MON}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const rule = (recurringDays: string[] = [], dueDate: string | null = null) => ({
  recurringDays,
  dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null,
  createdAt: new Date(`${MON}T12:00:00.000Z`),
});

const done = (...offsets: number[]) => new Set(offsets.map(day));

describe('recurringStats', () => {
  it('counts consecutive done days through today', () => {
    expect(recurringStats(rule(), done(0, 1, 2), day(2))).toEqual({
      currentStreak: 3, longestStreak: 3, totalCompletions: 3, latestDueDayDone: true,
    });
  });

  it('does not break the streak on today while today is still open', () => {
    const stats = recurringStats(rule(), done(0, 1), day(2));
    expect(stats.currentStreak).toBe(2);
    expect(stats.latestDueDayDone).toBe(false);
  });

  it('breaks it on a missed due day before today, keeping the longest', () => {
    const stats = recurringStats(rule(), done(0, 1, 2, 4), day(5));
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(3);
  });

  it('is zero once yesterday was missed', () => {
    expect(recurringStats(rule(), done(0, 1), day(3)).currentStreak).toBe(0);
  });

  it('skips days the task is not scheduled on', () => {
    // Mon/Wed/Fri: done on all three, Tuesday and Thursday do not count.
    const stats = recurringStats(rule(['mon', 'wed', 'fri']), done(0, 2, 4), day(5));
    expect(stats.currentStreak).toBe(3);
  });

  it('counts a done day the schedule no longer includes', () => {
    // Now Mondays only, but Tuesday was ticked off back when it was due.
    const stats = recurringStats(rule(['mon']), done(0, 1), day(2));
    expect(stats.currentStreak).toBe(2);
    expect(stats.latestDueDayDone).toBe(true);
  });

  it('judges a goal by the latest due day on a day the task is off', () => {
    // Mondays only; Monday done, today is Wednesday.
    expect(recurringStats(rule(['mon']), done(0), day(2)).latestDueDayDone).toBe(true);
    expect(recurringStats(rule(['mon']), done(), day(2)).latestDueDayDone).toBe(false);
  });

  it('stops scheduling after the end date, so the streak holds', () => {
    const stats = recurringStats(rule([], day(2)), done(0, 1, 2), day(6));
    expect(stats.currentStreak).toBe(3);
    expect(stats.latestDueDayDone).toBe(true);
  });

  it('starts at an earlier done day than the creation day', () => {
    // A user west of UTC ticked off their local Sunday before the creation
    // instant's UTC Monday.
    const stats = recurringStats(rule(), done(-1, 0), day(0));
    expect(stats.currentStreak).toBe(2);
  });

  it('is all zero for a task never done', () => {
    expect(recurringStats(rule(), done(), day(0))).toEqual({
      currentStreak: 0, longestStreak: 0, totalCompletions: 0, latestDueDayDone: false,
    });
  });
});
