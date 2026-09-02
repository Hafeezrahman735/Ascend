import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { daysUntilDue } from './date';

/**
 * These run in a fixed western timezone on purpose. Both bugs this helper
 * replaces were invisible at UTC and only appeared west of it, which is why
 * they survived a test suite that never set a zone.
 *
 * `process.env.TZ` is assigned here rather than passed as a shell prefix: a
 * `TZ=` prefix is silently ignored by the Node build on this machine, so the
 * tests would pass while proving nothing.
 */
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

describe('daysUntilDue', () => {
  it('reads the date-only form the client writes optimistically', () => {
    expect(daysUntilDue('2026-09-03', new Date(2026, 8, 1, 15, 30))).toBe(2);
  });

  it('reads the full ISO form the server sends, identically', () => {
    // Task.dueDate is a Prisma DateTime stored at UTC midnight. Both shapes are
    // live in the store at once — createTask writes one, fetchTasks the other —
    // so they must never disagree.
    const now = new Date(2026, 8, 1, 15, 30);
    expect(daysUntilDue('2026-09-03T00:00:00.000Z', now))
      .toBe(daysUntilDue('2026-09-03', now));
  });

  it('says 0 for a task due today, west of UTC', () => {
    // The bug this replaces: the instant was parsed and then read with LOCAL
    // calendar fields, so UTC midnight fell on the previous local day and a task
    // due today measured -1 — excluded outright by the `>= 0` hero card floor.
    expect(daysUntilDue('2026-06-15T00:00:00.000Z', new Date(2026, 5, 15, 10, 0))).toBe(0);
  });

  it('says 1 for a task due tomorrow, west of UTC', () => {
    // Same bug's other half: tomorrow measured 0 and was labelled "Today".
    expect(daysUntilDue('2026-06-16T00:00:00.000Z', new Date(2026, 5, 15, 10, 0))).toBe(1);
  });

  it('says -1 across a spring-forward boundary, not -0', () => {
    // Math.ceil over local midnights returned -0 here, and `-0 < 0` is false, so
    // every overdue branch in the app silently failed on this day each year.
    const result = daysUntilDue('2026-03-08', new Date(2026, 2, 9, 12, 0));
    expect(result).toBe(-1);
    expect(result! < 0).toBe(true);
  });

  it('says -1 across a fall-back boundary too', () => {
    expect(daysUntilDue('2026-11-01', new Date(2026, 10, 2, 12, 0))).toBe(-1);
  });

  it('never returns negative zero', () => {
    // toBe(0) would not catch this: expect(-0).toBe(0) passes in Vitest. Only
    // Object.is separates them, and only `< 0` cares about the difference.
    const sameDay = daysUntilDue('2026-09-01', new Date(2026, 8, 1, 23, 59));
    expect(Object.is(sameDay, -0)).toBe(false);
    expect(Object.is(sameDay, 0)).toBe(true);
  });

  it('returns null for missing or malformed values rather than NaN', () => {
    const now = new Date(2026, 8, 1);
    for (const bad of [null, undefined, '', 'not-a-date', '01/09/2026', '2026-9-1']) {
      expect(daysUntilDue(bad as string | null, now)).toBeNull();
    }
  });

  it('agrees with itself at a positive UTC offset', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(daysUntilDue('2026-06-15T00:00:00.000Z', new Date(2026, 5, 15, 10, 0))).toBe(0);
    process.env.TZ = 'America/New_York';
  });
});
