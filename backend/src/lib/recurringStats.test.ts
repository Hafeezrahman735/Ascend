import { describe, it, expect } from 'vitest';
import { isSeriesFinished, recurringStats } from './recurringStats';

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
      // Monday and Tuesday are past; today is still open.
      scheduledDays: 2, doneOnSchedule: 2, missedDays: 0,
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
      scheduledDays: 0, doneOnSchedule: 0, missedDays: 0,
    });
  });
});

describe('recurringStats: missed days (docs/designs/tasks-recurring-blocks-sessions.md)', () => {
  it('R1: counts an unticked yesterday as missed until it is marked done', () => {
    // Daily; Monday done, Tuesday not; today is Wednesday.
    const missed = recurringStats(rule(), done(0), day(2));
    expect(missed).toMatchObject({ scheduledDays: 2, doneOnSchedule: 1, missedDays: 1, currentStreak: 0 });
    // Tuesday marked done on Wednesday: the miss and the streak recover.
    const marked = recurringStats(rule(), done(0, 1), day(2));
    expect(marked).toMatchObject({ scheduledDays: 2, doneOnSchedule: 2, missedDays: 0, currentStreak: 2 });
  });

  it('never counts today as missed', () => {
    expect(recurringStats(rule(), done(), day(0))).toMatchObject({ scheduledDays: 0, missedDays: 0 });
  });

  it('R8: judges past days by the current rule, keeping the lifetime total', () => {
    // Two weeks from Mon Oct 5 (window ends Sun Oct 18 when today is Mon Oct 19).
    // Ticked: weekends 10, 11, 17, 18 and weekdays 5, 6, 7, 12, 13, 14. Now weekdays only.
    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const stats = recurringStats(rule(weekdays), done(5, 6, 12, 13, 0, 1, 2, 7, 8, 9), day(14));
    expect(stats).toMatchObject({ scheduledDays: 10, doneOnSchedule: 6, missedDays: 4, totalCompletions: 10 });
  });

  it('R9: starts the window at the creation day', () => {
    // Mondays only, created Wednesday Oct 7; today is Thursday Oct 15.
    const createdWednesday = { ...rule(['mon']), createdAt: new Date(`${day(2)}T12:00:00.000Z`) };
    expect(recurringStats(createdWednesday, done(), day(10))).toMatchObject({ scheduledDays: 1, missedDays: 1 });
  });

  it('stops counting at the series end date', () => {
    // Daily until Thursday; today is the next Monday; Mon-Wed done.
    const stats = recurringStats(rule([], day(3)), done(0, 1, 2), day(7));
    expect(stats).toMatchObject({ scheduledDays: 4, doneOnSchedule: 3, missedDays: 1 });
  });

  it('counts an unticked last day as missed, completed series or not', () => {
    // Daily until Thursday; today is Friday, Thursday unticked.
    const open = recurringStats(rule([], day(3)), done(0, 1, 2), day(4));
    expect(open).toMatchObject({ scheduledDays: 4, missedDays: 1 });
    const completed = recurringStats({ ...rule([], day(3)), isCompleted: true }, done(0, 1, 2), day(4));
    expect(completed).toMatchObject({ scheduledDays: 4, missedDays: 1 });
  });
});

describe('recurringStats: a completed series stops on its completion day', () => {
  // Stored as PATCH /tasks/:id stores it: noon UTC of the local completion day.
  const completedOn = (offset: number) => ({ isCompleted: true, completedAt: new Date(`${day(offset)}T12:00:00.000Z`) });

  it('stops counting days after completion, even with no end date', () => {
    // Daily, no end; Mon and Tue done, completed on Wednesday; today is next Monday.
    const stats = recurringStats({ ...rule(), ...completedOn(2) }, done(0, 1), day(7));
    // Mon-Wed scheduled; Wednesday counts (not ticked), nothing after it.
    expect(stats).toMatchObject({ scheduledDays: 3, doneOnSchedule: 2, missedDays: 1 });
  });

  it('keeps the earlier end date when the series ended before it was completed', () => {
    const stats = recurringStats({ ...rule([], day(1)), ...completedOn(5) }, done(0, 1), day(7));
    expect(stats).toMatchObject({ scheduledDays: 2, missedDays: 0 });
  });
});

describe('isSeriesFinished', () => {
  it('is finished once the end date has passed', () => {
    expect(isSeriesFinished(rule([], day(3)), day(3))).toBe(false);
    expect(isSeriesFinished(rule([], day(3)), day(4))).toBe(true);
  });

  it('R6b: is finished before the end date when no scheduled day is left', () => {
    // Fridays only, ending Thursday Oct 8; today is Tuesday Oct 6.
    expect(isSeriesFinished(rule(['fri'], day(3)), day(1))).toBe(true);
  });

  it('never finishes a series with no end date', () => {
    expect(isSeriesFinished(rule(['fri']), day(100))).toBe(false);
  });
});
