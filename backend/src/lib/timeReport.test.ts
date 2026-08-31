import { describe, it, expect } from 'vitest';
import { computeTimeReport, type ReportSession, type ReportGoal } from './timeReport';
import { daysBetweenKeys, shiftDateKey } from './localParts';

const MIN = 60;

function session(over: Partial<ReportSession> = {}): ReportSession {
  return {
    completedAt: new Date('2026-08-10T13:00:00Z'),
    durationSeconds: 25 * MIN,
    taskId: 'task_1',
    taskGoalId: null,
    goalTitleSnapshot: null,
    taskTitleSnapshot: 'A task',
    primaryTag: null,
    tags: [],
    priority: 'medium',
    wasRecurring: false,
    localDate: '2026-08-10',
    localHour: 9,
    localWeekday: 1,
    localDateApprox: false,
    ...over,
  };
}

/** Same-length window ending the day before `from`, as the route computes it. */
function previousWindow(from: string, to: string) {
  const days = daysBetweenKeys(from, to) + 1;
  const previousTo = shiftDateKey(from, -1);
  return { previousFrom: shiftDateKey(previousTo, -(days - 1)), previousTo };
}

function report(over: {
  sessions?: ReportSession[];
  goals?: ReportGoal[];
  from?: string;
  to?: string;
  today?: string;
  timeZone?: string;
} = {}) {
  const from = over.from ?? '2026-08-01';
  const to = over.to ?? '2026-08-31';
  return computeTimeReport({
    sessions: over.sessions ?? [],
    from,
    to,
    ...previousWindow(from, to),
    goals: over.goals ?? [],
    today: over.today ?? '2026-08-15',
    timeZone: over.timeZone ?? 'UTC',
  });
}

describe('totals', () => {
  it('sums time, counts sessions, and counts distinct active days', () => {
    const r = report({
      sessions: [
        session({ localDate: '2026-08-10', durationSeconds: 25 * MIN }),
        session({ localDate: '2026-08-10', durationSeconds: 20 * MIN }),
        session({ localDate: '2026-08-12', durationSeconds: 15 * MIN }),
      ],
    });
    expect(r.totals.seconds).toBe(60 * MIN);
    expect(r.totals.sessions).toBe(3);
    expect(r.totals.activeDays).toBe(2);
    expect(r.totals.avgSessionSeconds).toBe(20 * MIN);
  });

  it('returns zeroes and full-length arrays for an empty window', () => {
    const r = report();
    expect(r.totals.seconds).toBe(0);
    expect(r.totals.avgSessionSeconds).toBe(0);
    expect(r.patterns.byWeekday).toHaveLength(7);
    expect(r.patterns.byHour).toHaveLength(24);
    expect(r.patterns.peakHour).toBeNull();
    expect(r.patterns.bestWeekday).toBeNull();
    expect(r.goals).toEqual([]);
  });

  it('counts the range inclusively', () => {
    expect(report({ from: '2026-08-01', to: '2026-08-31' }).range.days).toBe(31);
    expect(report({ from: '2026-08-01', to: '2026-08-01' }).range.days).toBe(1);
  });
});

describe('intent — was this where I wanted my time to go', () => {
  it('reports the share of time linked to a goal', () => {
    const r = report({
      sessions: [
        session({ taskGoalId: 'g1', durationSeconds: 60 * MIN }),
        session({ taskGoalId: null, durationSeconds: 20 * MIN }),
      ],
    });
    expect(r.intent.goalLinkedSeconds).toBe(60 * MIN);
    expect(r.intent.unlinkedSeconds).toBe(20 * MIN);
    expect(r.intent.goalLinkedShare).toBeCloseTo(0.75, 5);
  });

  it('is null rather than zero when nothing was logged', () => {
    // No share exists to report. Zero would read as "none of your time went to
    // your goals", which is a different and untrue statement.
    const r = report();
    expect(r.intent.goalLinkedShare).toBeNull();
    expect(r.intent.urgentShare).toBeNull();
  });

  it('reports the share spent on high and urgent work', () => {
    const r = report({
      sessions: [
        session({ priority: 'urgent', durationSeconds: 30 * MIN }),
        session({ priority: 'high', durationSeconds: 30 * MIN }),
        session({ priority: 'low', durationSeconds: 60 * MIN }),
      ],
    });
    expect(r.intent.urgentShare).toBeCloseTo(0.5, 5);
  });
});

describe('goals', () => {
  const goal = (over: Partial<ReportGoal> = {}): ReportGoal => ({
    id: 'g1', title: 'Chemistry Degree', deadline: null, isCompleted: false, ...over,
  });

  it('includes a goal with no time this window, marked idle', () => {
    const r = report({ goals: [goal()] });
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0].status).toBe('idle');
    expect(r.goals[0].seconds).toBe(0);
  });

  it('marks a goal with an imminent deadline and almost no time as starved', () => {
    const r = report({
      today: '2026-08-15',
      goals: [goal({ id: 'g1', deadline: '2026-08-20' }), goal({ id: 'g2', title: 'Other' })],
      sessions: [
        session({ taskGoalId: 'g1', durationSeconds: 5 * MIN }),
        session({ taskGoalId: 'g2', durationSeconds: 200 * MIN }),
      ],
    });
    const g1 = r.goals.find((g) => g.goalId === 'g1')!;
    expect(g1.status).toBe('starved');
    expect(g1.daysLeft).toBe(5);
  });

  it('does not call a due goal starved when it is getting the time', () => {
    const r = report({
      today: '2026-08-15',
      goals: [goal({ deadline: '2026-08-20' })],
      sessions: [session({ taskGoalId: 'g1', durationSeconds: 200 * MIN })],
    });
    expect(r.goals[0].status).toBe('fed');
  });

  it('never calls a completed goal starved', () => {
    // It is done. Reporting it as neglected would be nagging about finished work.
    const r = report({
      today: '2026-08-15',
      goals: [goal({ deadline: '2026-08-16', isCompleted: true }), goal({ id: 'g2', title: 'Other' })],
      sessions: [
        session({ taskGoalId: 'g1', durationSeconds: 1 * MIN }),
        session({ taskGoalId: 'g2', durationSeconds: 300 * MIN }),
      ],
    });
    expect(r.goals.find((g) => g.goalId === 'g1')!.status).toBe('fed');
  });

  it('treats an overdue goal as due', () => {
    const r = report({
      today: '2026-08-15',
      goals: [goal({ deadline: '2026-08-01' }), goal({ id: 'g2', title: 'Other' })],
      sessions: [
        session({ taskGoalId: 'g1', durationSeconds: 2 * MIN }),
        session({ taskGoalId: 'g2', durationSeconds: 300 * MIN }),
      ],
    });
    const g1 = r.goals.find((g) => g.goalId === 'g1')!;
    expect(g1.daysLeft).toBe(-14);
    expect(g1.status).toBe('starved');
  });

  it('sorts starved goals first, then by time, with idle last', () => {
    const r = report({
      today: '2026-08-15',
      goals: [
        goal({ id: 'fed', title: 'Fed' }),
        goal({ id: 'starved', title: 'Starved', deadline: '2026-08-18' }),
        goal({ id: 'idle', title: 'Idle' }),
      ],
      sessions: [
        session({ taskGoalId: 'fed', durationSeconds: 300 * MIN }),
        session({ taskGoalId: 'starved', durationSeconds: 2 * MIN }),
      ],
    });
    expect(r.goals.map((g) => g.goalId)).toEqual(['starved', 'fed', 'idle']);
  });

  it('still reports a goal that only exists in history, under its frozen title', () => {
    // Deleted since. The time was still spent and still counts.
    const r = report({
      goals: [],
      sessions: [session({ taskGoalId: 'gone', goalTitleSnapshot: 'Abandoned Goal' })],
    });
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0].title).toBe('Abandoned Goal');
  });

  it('records the last day each goal was worked', () => {
    const r = report({
      goals: [goal()],
      sessions: [
        session({ taskGoalId: 'g1', localDate: '2026-08-03' }),
        session({ taskGoalId: 'g1', localDate: '2026-08-11' }),
        session({ taskGoalId: 'g1', localDate: '2026-08-07' }),
      ],
    });
    expect(r.goals[0].lastWorkedDate).toBe('2026-08-11');
  });
});

describe('tags', () => {
  it('shares sum to 1 across primary tags', () => {
    const r = report({
      sessions: [
        session({ primaryTag: 'Physics', durationSeconds: 60 * MIN }),
        session({ primaryTag: 'Maths', durationSeconds: 40 * MIN }),
      ],
    });
    const total = r.tags.reduce((sum, t) => sum + t.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('counts a multi-tag session once, under its primary tag only', () => {
    // Counting it once per tag would make the shares add to more time than was
    // actually spent.
    const r = report({
      sessions: [session({ primaryTag: 'Physics', tags: ['Physics', 'Exam'], durationSeconds: 30 * MIN })],
    });
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0].seconds).toBe(30 * MIN);
  });

  it('carries the previous window for direction of travel', () => {
    // One array covering both windows; the split is by resolved local day.
    const r = report({
      sessions: [
        session({ primaryTag: 'Physics', durationSeconds: 30 * MIN, localDate: '2026-08-10' }),
        session({ primaryTag: 'Physics', durationSeconds: 90 * MIN, localDate: '2026-07-15' }),
      ],
    });
    expect(r.totals.seconds).toBe(30 * MIN);
    expect(r.tags[0].previousSeconds).toBe(90 * MIN);
    expect(r.previous.seconds).toBe(90 * MIN);
    expect(r.previous.sessions).toBe(1);
  });
});

describe('tasks', () => {
  it('ranks by time and keeps the goal each belonged to', () => {
    const r = report({
      sessions: [
        session({ taskId: 't1', taskTitleSnapshot: 'Small', durationSeconds: 10 * MIN }),
        session({ taskId: 't2', taskTitleSnapshot: 'Big', durationSeconds: 90 * MIN,
                  goalTitleSnapshot: 'Chemistry Degree' }),
      ],
    });
    expect(r.tasks[0].title).toBe('Big');
    expect(r.tasks[0].goalTitle).toBe('Chemistry Degree');
  });

  it('marks habit time so a daily routine does not read as a runaway project', () => {
    const r = report({ sessions: [session({ wasRecurring: true })] });
    expect(r.tasks[0].wasRecurring).toBe(true);
  });

  it('counts task-less time as unattributed rather than dropping it', () => {
    const r = report({
      sessions: [
        session({ taskId: null, durationSeconds: 30 * MIN }),
        session({ taskId: 't1', durationSeconds: 30 * MIN }),
      ],
    });
    expect(r.unattributedSeconds).toBe(30 * MIN);
    expect(r.totals.seconds).toBe(60 * MIN);
    expect(r.tasks).toHaveLength(1);
  });
});

describe('patterns', () => {
  it('buckets time by hour and weekday, and picks the peak by time', () => {
    const r = report({
      sessions: [
        session({ localHour: 9, localWeekday: 1, durationSeconds: 90 * MIN }),
        session({ localHour: 14, localWeekday: 3, durationSeconds: 10 * MIN }),
        session({ localHour: 14, localWeekday: 3, durationSeconds: 10 * MIN }),
        session({ localHour: 14, localWeekday: 3, durationSeconds: 10 * MIN }),
      ],
    });
    // 14:00 has three sessions to 09:00's one, but 09:00 holds three times the
    // time — and time is what a "peak focus" readout is asked for.
    expect(r.patterns.peakHour?.hour).toBe(9);
    expect(r.patterns.bestWeekday).toBe(1);
    expect(r.patterns.byHour[14]).toBe(30 * MIN);
  });
});

describe('approximate history', () => {
  it('reports the share of time whose hour had to be inferred', () => {
    const r = report({
      sessions: [
        session({ localDateApprox: true, durationSeconds: 30 * MIN }),
        session({ localDateApprox: false, durationSeconds: 90 * MIN }),
      ],
    });
    expect(r.approxShare).toBeCloseTo(0.25, 5);
  });

  it('is zero, not NaN, on an empty window', () => {
    expect(report().approxShare).toBe(0);
  });
});

describe('which local day a session is filed under', () => {
  it('re-resolves an approximate stamp that landed on the wrong day', () => {
    // The reported bug, exactly. A 19:53 session in UTC-5 is 00:53 UTC the NEXT
    // day. The backfill had no timezone to work from and stamped the UTC day,
    // so the session filed under tomorrow — vanishing from "today" and, at a
    // month boundary, from the month as well.
    const s = session({
      completedAt: new Date('2026-08-31T00:53:00Z'),
      localDate: '2026-08-31',
      localHour: 0,
      localDateApprox: true,
      durationSeconds: 27 * MIN,
      primaryTag: null,
    });

    // Bogota is UTC-5 all year, so there is no DST ambiguity in the fixture.
    // A month ending on the 30th must still contain it.
    const r = report({
      sessions: [s], from: '2026-08-01', to: '2026-08-30',
      today: '2026-08-30', timeZone: 'America/Bogota',
    });
    expect(r.totals.seconds).toBe(27 * MIN);
    expect(r.patterns.byHour[19]).toBe(27 * MIN);

    // And a single day — the 30th — must contain it too.
    const day = report({
      sessions: [s], from: '2026-08-30', to: '2026-08-30',
      today: '2026-08-30', timeZone: 'America/Bogota',
    });
    expect(day.totals.seconds).toBe(27 * MIN);

    // The stored stamp said the 31st. A window that trusted it would have
    // counted this session twice over: once here and once tomorrow.
    const tomorrow = report({
      sessions: [s], from: '2026-08-31', to: '2026-08-31',
      today: '2026-08-31', timeZone: 'America/Bogota',
    });
    expect(tomorrow.totals.seconds).toBe(0);
  });

  it('keeps an EXACT stamp even when the caller is now in another zone', () => {
    // The stamp is what was true where the user was standing. Someone who flew
    // to Tokyo has not retroactively worked at a different local hour.
    const r = report({
      sessions: [session({
        completedAt: new Date('2026-08-10T13:00:00Z'),
        localDate: '2026-08-10', localHour: 9, localWeekday: 1,
        localDateApprox: false, durationSeconds: 30 * MIN,
      })],
      timeZone: 'Asia/Tokyo',
    });
    expect(r.patterns.byHour[9]).toBe(30 * MIN);
    expect(r.patterns.byHour[22]).toBe(0);
  });

  it('resolves a row that has no stamp at all', () => {
    const r = report({
      sessions: [session({
        completedAt: new Date('2026-08-10T13:00:00Z'),
        localDate: null, localHour: null, localWeekday: null,
        localDateApprox: false, durationSeconds: 30 * MIN,
      })],
      timeZone: 'UTC',
    });
    expect(r.totals.seconds).toBe(30 * MIN);
    expect(r.patterns.byHour[13]).toBe(30 * MIN);
  });

  it('ignores sessions the widened query pulled in from outside both windows', () => {
    const r = report({
      sessions: [
        session({ localDate: '2026-08-10', durationSeconds: 30 * MIN }),
        session({ localDate: '2026-06-01', durationSeconds: 99 * MIN }),
      ],
    });
    expect(r.totals.seconds).toBe(30 * MIN);
    expect(r.previous.seconds).toBe(0);
  });

  it('reports the share of time whose day had to be recomputed', () => {
    const r = report({
      sessions: [
        session({ localDateApprox: true, durationSeconds: 30 * MIN,
                  completedAt: new Date('2026-08-10T13:00:00Z') }),
        session({ localDateApprox: false, durationSeconds: 90 * MIN }),
      ],
    });
    expect(r.approxShare).toBeCloseTo(0.25, 5);
  });
});
