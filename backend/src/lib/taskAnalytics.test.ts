import { describe, it, expect } from 'vitest';
import { computeTaskAnalytics, safeTimeZone, type AnalyticsSession } from './taskAnalytics';

/**
 * The timezone cases are the point of this file. The previous implementation
 * bucketed by UTC and labelled the result as local time, so every assertion
 * below that names a zone would have failed against it.
 */

const MIN = 60;

function session(iso: string, minutes: number, plannedMinutes?: number): AnalyticsSession {
  return {
    completedAt: new Date(iso),
    durationSeconds: minutes * MIN,
    plannedDurationSeconds: plannedMinutes != null ? plannedMinutes * MIN : null,
  };
}

function compute(over: {
  sessions?: AnalyticsSession[];
  estimatedMinutes?: number | null;
  createdAt?: string;
  now?: string;
  timeZone?: string;
}) {
  return computeTaskAnalytics({
    sessions: over.sessions ?? [],
    estimatedMinutes: over.estimatedMinutes ?? null,
    createdAt: new Date(over.createdAt ?? '2026-08-01T00:00:00Z'),
    now: new Date(over.now ?? '2026-08-27T18:00:00Z'),
    timeZone: over.timeZone ?? 'UTC',
  });
}

describe('peak hour', () => {
  it('reports the hour in the caller’s zone, not UTC', () => {
    // 14:00 UTC is 10:00 in New York, which is on EDT (UTC-4) in August.
    const sessions = [session('2026-08-26T14:00:00Z', 50)];

    expect(compute({ sessions, timeZone: 'UTC' }).mostProductiveHour)
      .toEqual({ hour: 14, label: '2pm' });
    expect(compute({ sessions, timeZone: 'America/New_York' }).mostProductiveHour)
      .toEqual({ hour: 10, label: '10am' });
    // Tokyo is UTC+9 year-round, so the same instant is late evening there.
    expect(compute({ sessions, timeZone: 'Asia/Tokyo' }).mostProductiveHour)
      .toEqual({ hour: 23, label: '11pm' });
  });

  it('ranks by seconds focused, not by number of sessions', () => {
    const sessions = [
      session('2026-08-26T09:00:00Z', 90),
      session('2026-08-26T14:00:00Z', 10),
      session('2026-08-26T14:20:00Z', 10),
      session('2026-08-26T14:40:00Z', 10),
    ];
    // 14:00 holds three sessions; 09:00 holds more time and wins.
    expect(compute({ sessions }).mostProductiveHour?.hour).toBe(9);
  });

  it('is null when there are no sessions', () => {
    expect(compute({}).mostProductiveHour).toBeNull();
  });

  it('labels midnight as 12am rather than 0am or 24', () => {
    expect(compute({ sessions: [session('2026-08-26T00:30:00Z', 30)] }).mostProductiveHour)
      .toEqual({ hour: 0, label: '12am' });
  });
});

describe('day bucketing', () => {
  it('puts a late-evening local session on that local day, not the next UTC one', () => {
    // 01:00 UTC on the 27th is 21:00 on the 26th in New York.
    const sessions = [session('2026-08-27T01:00:00Z', 30)];

    const utc = compute({ sessions, timeZone: 'UTC', now: '2026-08-27T18:00:00Z' });
    const ny = compute({ sessions, timeZone: 'America/New_York', now: '2026-08-27T18:00:00Z' });

    expect(utc.timePerDayLast7.find((d) => d.date === '2026-08-27')?.seconds).toBe(30 * MIN);
    expect(ny.timePerDayLast7.find((d) => d.date === '2026-08-26')?.seconds).toBe(30 * MIN);
    expect(ny.totalTimeToday).toBe(0);
  });

  it('always returns exactly seven day buckets ending today', () => {
    const { timePerDayLast7 } = compute({ now: '2026-08-27T18:00:00Z' });
    expect(timePerDayLast7).toHaveLength(7);
    expect(timePerDayLast7[0].date).toBe('2026-08-21');
    expect(timePerDayLast7[6].date).toBe('2026-08-27');
  });

  it('crosses a month boundary without producing an invalid date', () => {
    const { timePerDayLast7 } = compute({ now: '2026-09-02T12:00:00Z' });
    expect(timePerDayLast7[0].date).toBe('2026-08-27');
    expect(timePerDayLast7[6].date).toBe('2026-09-02');
  });
});

describe('estimate figures', () => {
  it('scores a task that matched its estimate at 100', () => {
    const a = compute({ sessions: [session('2026-08-26T09:00:00Z', 60)], estimatedMinutes: 60 });
    expect(a.estimationAccuracy).toBe(100);
    expect(a.estimateDeltaSeconds).toBe(0);
    expect(a.estimateUsedPct).toBe(100);
  });

  it('does not report a 3x overrun as 300% accurate', () => {
    // The old field returned 300 here, which reads as excellent and meant the
    // opposite. Accuracy bottoms out at 0; the overrun is carried by the delta.
    const a = compute({ sessions: [session('2026-08-26T09:00:00Z', 180)], estimatedMinutes: 60 });
    expect(a.estimationAccuracy).toBe(0);
    expect(a.estimateUsedPct).toBe(300);
    expect(a.estimateDeltaSeconds).toBe(120 * MIN);
  });

  it('scores a half-length task at 50 and signs the delta negative', () => {
    const a = compute({ sessions: [session('2026-08-26T09:00:00Z', 30)], estimatedMinutes: 60 });
    expect(a.estimationAccuracy).toBe(50);
    expect(a.estimateDeltaSeconds).toBe(-30 * MIN);
  });

  it('leaves every estimate figure null when the task has no estimate', () => {
    const a = compute({ sessions: [session('2026-08-26T09:00:00Z', 30)] });
    expect(a.estimationAccuracy).toBeNull();
    expect(a.estimateUsedPct).toBeNull();
    expect(a.estimateDeltaSeconds).toBeNull();
  });
});

describe('full session rate', () => {
  it('counts a session that ran at least 90% of its plan', () => {
    const a = compute({
      sessions: [session('2026-08-26T09:00:00Z', 27, 30), session('2026-08-26T10:00:00Z', 10, 30)],
    });
    expect(a.fullSessionRate).toBe(50);
  });

  it('counts an unplanned session as full, having nothing to fall short of', () => {
    expect(compute({ sessions: [session('2026-08-26T09:00:00Z', 5)] }).fullSessionRate).toBe(100);
  });

  it('keeps completionRate as an identical alias for older app builds', () => {
    const a = compute({ sessions: [session('2026-08-26T09:00:00Z', 27, 30)] });
    expect(a.completionRate).toBe(a.fullSessionRate);
  });

  it('is 0 rather than NaN with no sessions', () => {
    expect(compute({}).fullSessionRate).toBe(0);
    expect(compute({}).avgSessionLength).toBe(0);
  });
});

describe('consistency', () => {
  it('counts distinct local days, not sessions', () => {
    const a = compute({
      sessions: [
        session('2026-08-25T09:00:00Z', 25),
        session('2026-08-25T14:00:00Z', 25),
        session('2026-08-26T09:00:00Z', 25),
      ],
      createdAt: '2026-08-25T00:00:00Z',
      now: '2026-08-27T18:00:00Z',
    });
    expect(a.daysWorked).toBe(2);
    // Created on the 25th, now the 27th — three days inclusive.
    expect(a.consistency).toBeCloseTo(2 / 3, 5);
  });

  it('reports a task created and worked today as fully consistent', () => {
    const a = compute({
      sessions: [session('2026-08-27T09:00:00Z', 25)],
      createdAt: '2026-08-27T00:00:00Z',
      now: '2026-08-27T18:00:00Z',
    });
    expect(a.consistency).toBe(1);
  });

  it('is null when the task has never been worked', () => {
    expect(compute({}).consistency).toBeNull();
    expect(compute({}).lastSessionAt).toBeNull();
  });

  it('never exceeds 1 even if a session predates the task row', () => {
    const a = compute({
      sessions: [session('2026-08-20T09:00:00Z', 25), session('2026-08-27T09:00:00Z', 25)],
      createdAt: '2026-08-27T00:00:00Z',
      now: '2026-08-27T18:00:00Z',
    });
    expect(a.consistency).toBe(1);
  });
});

describe('lastSessionAt', () => {
  it('is the newest session regardless of input order', () => {
    const a = compute({
      sessions: [
        session('2026-08-20T09:00:00Z', 25),
        session('2026-08-26T09:00:00Z', 25),
        session('2026-08-22T09:00:00Z', 25),
      ],
    });
    expect(a.lastSessionAt).toBe('2026-08-26T09:00:00.000Z');
  });
});

describe('safeTimeZone', () => {
  it('passes a valid IANA zone through', () => {
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
  });

  it('falls back to UTC rather than throwing on client garbage', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTimeZone('')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});
