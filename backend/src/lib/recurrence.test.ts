import { describe, it, expect } from 'vitest';
import { isScheduledOn, daysUntilNextOccurrence, nextOccurrence } from './recurrence';

// 2026-08-17 Mon, 18 Tue, 19 Wed, 21 Fri, 23 Sun.
const MON = '2026-08-17';
const TUE = '2026-08-18';
const WED = '2026-08-19';
const FRI = '2026-08-21';
const SUN = '2026-08-23';

describe('isScheduledOn', () => {
  it('treats an empty schedule as every day', () => {
    expect(isScheduledOn([], MON)).toBe(true);
    expect(isScheduledOn([], SUN)).toBe(true);
  });

  it('matches only the listed days', () => {
    expect(isScheduledOn(['mon', 'wed'], MON)).toBe(true);
    expect(isScheduledOn(['mon', 'wed'], TUE)).toBe(false);
    expect(isScheduledOn(['mon', 'wed'], WED)).toBe(true);
  });

  it('is false when recurring is on but no day is ticked', () => {
    expect(isScheduledOn(['nonsense'], MON)).toBe(false);
  });
});

describe('daysUntilNextOccurrence', () => {
  it('is 0 for an everyday schedule', () => {
    expect(daysUntilNextOccurrence([], TUE)).toBe(0);
  });

  it('is 0 when today is scheduled', () => {
    expect(daysUntilNextOccurrence(['tue'], TUE)).toBe(0);
  });

  it('counts forward within the week', () => {
    expect(daysUntilNextOccurrence(['wed'], TUE)).toBe(1);
    expect(daysUntilNextOccurrence(['fri'], TUE)).toBe(3);
  });

  it('wraps to next week', () => {
    expect(daysUntilNextOccurrence(['mon'], TUE)).toBe(6);
  });

  it('picks the soonest of several', () => {
    expect(daysUntilNextOccurrence(['mon', 'thu'], TUE)).toBe(2);
  });

  it('returns null when no valid day is selected', () => {
    // A template can be saved with recurring on and nothing ticked. Callers must
    // say something honest rather than compute a wrong date.
    expect(daysUntilNextOccurrence(['bogus'], TUE)).toBeNull();
    expect(daysUntilNextOccurrence(['bogus', 'alsobad'], TUE)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('returns today when today is scheduled', () => {
    expect(nextOccurrence(['tue'], TUE)).toBe(TUE);
    expect(nextOccurrence([], TUE)).toBe(TUE);
  });

  it('returns the next scheduled date', () => {
    expect(nextOccurrence(['wed'], TUE)).toBe(WED);
    expect(nextOccurrence(['fri'], TUE)).toBe(FRI);
  });

  it('crosses a month boundary correctly', () => {
    // 2026-08-31 is a Monday; next Tuesday is 2026-09-01.
    expect(nextOccurrence(['tue'], '2026-08-31')).toBe('2026-09-01');
  });

  it('wraps to the following week', () => {
    expect(nextOccurrence(['mon'], TUE)).toBe('2026-08-24');
  });

  it('is null when nothing valid is scheduled', () => {
    expect(nextOccurrence(['bogus'], TUE)).toBeNull();
  });
});

describe('the end date', () => {
  /**
   * A recurring task ran forever until this existed. The bound lives with the
   * schedule rule so the spawner, the calendar projection and the client all
   * inherit it — three copies of "when does this stop" would end a habit in one
   * place and keep it running in another.
   *
   * The end date is INCLUSIVE: "ends on the 10th" fires on the 10th.
   */
  const MON = '2026-08-17';
  const TUE = '2026-08-18';
  const WED = '2026-08-19';

  it('fires on the end date itself', () => {
    expect(isScheduledOn([], TUE, TUE)).toBe(true);
    expect(isScheduledOn(['tue'], TUE, TUE)).toBe(true);
  });

  it('does not fire after it', () => {
    expect(isScheduledOn([], WED, TUE)).toBe(false);
    expect(isScheduledOn(['wed'], WED, TUE)).toBe(false);
  });

  it('never ends without one', () => {
    expect(isScheduledOn([], '2099-12-31')).toBe(true);
    expect(isScheduledOn([], '2099-12-31', null)).toBe(true);
  });

  it('reports no next occurrence once it has passed', () => {
    expect(nextOccurrence([], WED, TUE)).toBeNull();
    expect(daysUntilNextOccurrence([], WED, TUE)).toBeNull();
  });

  it('reports the end date itself as the last occurrence', () => {
    expect(nextOccurrence([], TUE, TUE)).toBe(TUE);
  });

  it('reports none when the schedule ends mid-week before its next day', () => {
    // Mon/Wed/Fri ending on Tuesday: Wednesday matches the weekday but falls
    // past the end, and there is no later day to find. Checking only the
    // weekday would return Wednesday here.
    expect(nextOccurrence(['mon', 'wed', 'fri'], TUE, TUE)).toBeNull();
  });

  it('still finds a day that falls before the end', () => {
    expect(nextOccurrence(['wed'], MON, WED)).toBe(WED);
  });
});
