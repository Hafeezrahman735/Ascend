import { describe, it, expect } from 'vitest';
import { computeTimePace, type TimePaceInput } from './timePace';

const H = 3600;

/** 10h planned over Oct 1–10 inclusive (10 days), checked on Oct 5. */
function pace(over: Partial<TimePaceInput> = {}) {
  return computeTimePace({
    plannedMinutes: 600,
    actualSeconds: 5 * H,
    isCompleted: false,
    startDay: '2026-10-01',
    deadline: '2026-10-10',
    today: '2026-10-05',
    ...over,
  });
}

describe('computeTimePace — even schedule', () => {
  it('expects the plan spread evenly, start and deadline days inclusive', () => {
    // Day 5 of 10 → half of 10h.
    const p = pace();
    expect(p.expectedSeconds).toBe(5 * H);
    expect(p.deltaSeconds).toBe(0);
    expect(p.status).toBe('on_pace');
  });

  it('is ahead or behind only outside max(15 min, 5% of plan)', () => {
    // 5% of 10h is 30 min, above the 15 min floor.
    expect(pace({ actualSeconds: 5 * H + 29 * 60 }).status).toBe('on_pace');
    expect(pace({ actualSeconds: 5 * H + 30 * 60 }).status).toBe('ahead');
    expect(pace({ actualSeconds: 5 * H - 29 * 60 }).status).toBe('on_pace');
    expect(pace({ actualSeconds: 5 * H - 30 * 60 }).status).toBe('behind');
  });

  it('uses the 15 minute floor for small plans', () => {
    // 2h plan: 5% is 6 min, so the floor of 15 min applies. Expected 1h on day 5.
    expect(pace({ plannedMinutes: 120, actualSeconds: H + 14 * 60 }).status).toBe('on_pace');
    expect(pace({ plannedMinutes: 120, actualSeconds: H + 15 * 60 }).status).toBe('ahead');
  });

  it('gives a per-day figure to finish only when behind, counting today', () => {
    // 2h done, 8h left, Oct 5–10 is 6 days → 80 min a day.
    const p = pace({ actualSeconds: 2 * H });
    expect(p.status).toBe('behind');
    expect(p.perDayToFinishSeconds).toBe(80 * 60);
    expect(pace({ actualSeconds: 7 * H }).perDayToFinishSeconds).toBeNull();
  });

  it('expects the whole plan on the deadline day, and still offers a per-day figure that day', () => {
    const p = pace({ today: '2026-10-10', actualSeconds: 6 * H });
    expect(p.expectedSeconds).toBe(10 * H);
    expect(p.status).toBe('behind');
    expect(p.perDayToFinishSeconds).toBe(4 * H);
  });

  it('expects one day’s share on the day it was created', () => {
    expect(pace({ today: '2026-10-01', actualSeconds: H }).expectedSeconds).toBe(H);
  });

  it('expects the whole plan when the deadline is before the start day', () => {
    const p = pace({ startDay: '2026-10-08', deadline: '2026-10-05', today: '2026-10-05', actualSeconds: H });
    expect(p.expectedSeconds).toBe(10 * H);
    expect(p.status).toBe('behind');
  });
});

describe('computeTimePace — status precedence', () => {
  it('completed beats everything', () => {
    expect(pace({ isCompleted: true, plannedMinutes: null }).status).toBe('completed');
    expect(pace({ isCompleted: true, actualSeconds: 20 * H }).status).toBe('completed');
  });

  it('no_plan when there is no plannedMinutes, with no remaining figure', () => {
    const p = pace({ plannedMinutes: null });
    expect(p.status).toBe('no_plan');
    expect(p.remainingSeconds).toBeNull();
  });

  it('reached beats past_due', () => {
    expect(pace({ actualSeconds: 10 * H, today: '2026-10-20' }).status).toBe('reached');
    expect(pace({ actualSeconds: 12 * H }).remainingSeconds).toBe(0);
  });

  it('past_due after the deadline when the plan is not met, with the remainder and no schedule', () => {
    const p = pace({ actualSeconds: 4 * H, today: '2026-10-11' });
    expect(p).toEqual({
      status: 'past_due', remainingSeconds: 6 * H,
      expectedSeconds: null, deltaSeconds: null, perDayToFinishSeconds: null,
    });
  });

  it('no_deadline keeps the remainder but has no schedule', () => {
    const p = pace({ deadline: null, actualSeconds: 3 * H });
    expect(p.status).toBe('no_deadline');
    expect(p.remainingSeconds).toBe(7 * H);
    expect(p.expectedSeconds).toBeNull();
  });
});
