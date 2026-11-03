import { describe, it, expect } from 'vitest';
import type { CalendarItem, TimelineSession } from '../types';
import type { SessionCompletion } from '../services/sessionOutbox';
import {
  planVsActual, plannedBlocksFromCalendar, plannedBlocksFromTasks, mergeQueuedSessions, timelineFromHistory,
  summaryLine, type PlannedBlock,
} from './planVsActual';

const DAY = '2026-10-31';
const MIN = 60;

function session(over: Partial<TimelineSession> = {}): TimelineSession {
  return {
    id: 's1',
    clientSessionId: null,
    durationSeconds: 25 * MIN,
    localDate: DAY,
    taskId: 'case-study',
    taskTitle: 'Write case study',
    goalId: null,
    startLocalMinutes: 9 * 60 + 22,
    endLocalMinutes: 9 * 60 + 47,
    ...over,
  };
}

const caseStudy: PlannedBlock = {
  taskId: 'case-study', date: DAY, title: 'Write case study', startMinutes: 9 * 60, endMinutes: 11 * 60, kind: 'task',
};
const invoice: PlannedBlock = {
  taskId: 'invoice', date: DAY, title: 'Invoice design', startMinutes: 14 * 60, endMinutes: 15 * 60, kind: 'task',
};

describe('planVsActual', () => {
  it('fills a planned block with same-task focus and leaves the rest unplanned (the design wireframe)', () => {
    const result = planVsActual(DAY, [invoice, caseStudy], [
      session({ id: 'a', durationSeconds: 25 * MIN }),
      session({ id: 'b', durationSeconds: 27 * MIN, startLocalMinutes: 604, endLocalMinutes: 631 }),
      session({ id: 'c', taskId: 'inbox', taskTitle: 'Inbox cleanup', durationSeconds: 38 * MIN }),
    ]);

    expect(result.fills.map((f) => f.block.taskId)).toEqual(['case-study', 'invoice']);
    expect(result.fills[0]).toMatchObject({ focusedSeconds: 52 * MIN, overSeconds: 0 });
    expect(result.fills[0].share).toBeCloseTo(52 / 120);
    expect(result.fills[1]).toMatchObject({ focusedSeconds: 0, share: 0, sessions: [] });
    expect(result.unplanned.map((s) => s.id)).toEqual(['c']);
    expect(result.totals).toEqual({ plannedMinutes: 180, anyTimeBlocks: 0, focusedSeconds: 90 * MIN, unplannedSeconds: 38 * MIN });
  });

  it('caps the fill at the block and reports the overrun', () => {
    const [fill] = planVsActual(DAY, [invoice], [session({ taskId: 'invoice', durationSeconds: 75 * MIN })]).fills;
    expect(fill.share).toBe(1);
    expect(fill.overSeconds).toBe(15 * MIN);
  });

  it('counts focus with no task, and focus on other days, correctly', () => {
    const result = planVsActual(DAY, [caseStudy], [
      session({ id: 'no-task', taskId: null, taskTitle: null }),
      session({ id: 'yesterday', localDate: '2026-10-30' }),
    ]);
    expect(result.unplanned.map((s) => s.id)).toEqual(['no-task']);
    expect(result.totals.focusedSeconds).toBe(25 * MIN);
    expect(result.fills[0].focusedSeconds).toBe(0);
  });

  it('treats the sessions of a task with no block that day (for example, deleted) as unplanned', () => {
    const result = planVsActual(DAY, [], [session()]);
    expect(result.fills).toEqual([]);
    expect(result.unplanned).toHaveLength(1);
    expect(result.totals).toEqual({ plannedMinutes: 0, anyTimeBlocks: 0, focusedSeconds: 25 * MIN, unplannedSeconds: 25 * MIN });
  });

  it('fills only the first block when a task is planned twice in a day', () => {
    const later = { ...caseStudy, startMinutes: 16 * 60, endMinutes: 17 * 60 };
    const result = planVsActual(DAY, [later, caseStudy], [session()]);
    expect(result.fills.map((f) => f.focusedSeconds)).toEqual([25 * MIN, 0]);
    expect(result.totals.plannedMinutes).toBe(180);
  });

  it('shows nothing for an empty day', () => {
    expect(planVsActual(DAY, [], [])).toEqual({
      fills: [], unplanned: [], totals: { plannedMinutes: 0, anyTimeBlocks: 0, focusedSeconds: 0, unplannedSeconds: 0 },
    });
  });
});

describe('planned blocks', () => {
  /** A one-off task's work block as the calendar draws it: the task, with the block's times. */
  const task = {
    id: 'case-study', title: 'Write case study',
    startMinutes: 540, endMinutes: 660, isRecurring: false, isCompleted: false,
  };
  /** The same task in the store: no times of its own, its plan on `blocks`. */
  const stored = {
    ...task, startMinutes: null, endMinutes: null,
    blocks: [{ date: DAY, startMinutes: 540, endMinutes: 660 }],
  };
  const habit = {
    id: 'inbox', title: 'Inbox zero', startMinutes: 480, endMinutes: 510, isRecurring: true, isCompleted: false,
  };

  it('never counts events, notes, deadlines or untimed habit days as planned', () => {
    const items: CalendarItem[] = [
      { type: 'work_block', date: DAY, data: task },
      { type: 'task_due', date: DAY, data: { ...task, id: 'due', startMinutes: null, endMinutes: null } },
      { type: 'event', date: DAY, data: { id: 'call', title: 'Client call', startMinutes: 660, endMinutes: 690 } },
      { type: 'note', date: DAY, data: { id: 'n', content: 'Remember' } },
      { type: 'habit_instance', date: DAY, data: habit },
      { type: 'habit_instance', date: DAY, data: { ...habit, id: 'untimed-habit', startMinutes: null, endMinutes: null } },
    ];
    expect(plannedBlocksFromCalendar(items).map((b) => [b.taskId, b.kind])).toEqual([
      ['case-study', 'task'],
      ['inbox', 'habit'],
    ]);
  });

  it('counts an any-time work block as planned, with no minutes (D12)', () => {
    const anyTime = { ...task, id: 'any', startMinutes: null, endMinutes: null };
    const blocks = plannedBlocksFromCalendar([{ type: 'work_block', date: DAY, data: anyTime }]);
    expect(blocks).toEqual([
      { taskId: 'any', date: DAY, title: 'Write case study', startMinutes: null, endMinutes: null, kind: 'task' },
    ]);
    const plan = planVsActual(DAY, blocks, [session({ taskId: 'any' })]);
    expect(plan.unplanned).toEqual([]);
    expect(plan.fills[0].focusedSeconds).toBe(25 * MIN);
    expect(plan.totals).toMatchObject({ plannedMinutes: 0, anyTimeBlocks: 1, unplannedSeconds: 0 });
  });

  it("fills a task's timed block before its any-time one on the same day", () => {
    const blocks = plannedBlocksFromCalendar([
      { type: 'work_block', date: DAY, data: { ...task, startMinutes: null, endMinutes: null } },
      { type: 'work_block', date: DAY, data: task },
    ]);
    const plan = planVsActual(DAY, blocks, [session({ taskId: 'case-study' })]);
    expect(plan.fills.map((f) => [f.block.startMinutes, f.focusedSeconds])).toEqual([[540, 25 * MIN], [null, 0]]);
  });

  it('gives the same blocks from the calendar and from the task store for the same tasks', () => {
    const fromCalendar = plannedBlocksFromCalendar([
      { type: 'work_block', date: DAY, data: task },
      { type: 'habit_instance', date: DAY, data: habit },
    ]);
    const fromTasks = plannedBlocksFromTasks([stored, habit], DAY);
    expect(fromTasks).toEqual(fromCalendar);
  });

  it("takes a one-off task's blocks on the day, never its due date or stale own times", () => {
    expect(plannedBlocksFromTasks([{ ...stored, blocks: [{ date: '2026-11-01', startMinutes: 540, endMinutes: 660 }] }], DAY)).toEqual([]);
    // An older build's cache may still carry times on the task itself.
    expect(plannedBlocksFromTasks([{ ...task, blocks: [] }], DAY)).toEqual([]);
  });
});

describe('mergeQueuedSessions', () => {
  function queued(over: Partial<SessionCompletion> = {}): SessionCompletion {
    return {
      clientSessionId: 'cs-1',
      completedAt: Date.UTC(2026, 9, 31, 12, 38),
      localDate: DAY,
      tz: 'UTC',
      actualElapsedSeconds: 38 * MIN,
      plannedDurationSeconds: 25 * MIN,
      taskId: 'inbox',
      taskLabel: 'Inbox cleanup',
      ...over,
    };
  }
  const utcMinutes = (ms: number) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();

  it('adds a session still waiting to upload, placed by the phone clock', () => {
    const [s] = mergeQueuedSessions([], [queued()], utcMinutes);
    expect(s).toMatchObject({
      id: 'queued:cs-1', queued: true, goalId: null, taskTitle: 'Inbox cleanup',
      startLocalMinutes: 12 * 60, endLocalMinutes: 12 * 60 + 38,
    });
  });

  it('drops a queued session the server already has, so it is not counted twice', () => {
    const merged = mergeQueuedSessions([session({ clientSessionId: 'cs-1' })], [queued()], utcMinutes);
    expect(merged).toHaveLength(1);
    expect(merged[0].queued).toBeUndefined();
  });

  it('keeps sessions in day and time order', () => {
    const merged = mergeQueuedSessions(
      [session({ id: 'late', endLocalMinutes: 15 * 60 }), session({ id: 'early', localDate: '2026-10-30' })],
      [queued()],
      utcMinutes,
    );
    expect(merged.map((s) => s.id)).toEqual(['early', 'queued:cs-1', 'late']);
  });
});

describe('timelineFromHistory', () => {
  it('places local history records on the given day by the phone clock', () => {
    const at = Date.UTC(2026, 9, 31, 10, 31);
    const utcMinutes = (ms: number) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();
    const [s] = timelineFromHistory(
      [{ sessionId: 'x', completedAt: at, durationSeconds: 27 * MIN, taskId: 'case-study', taskLabel: 'Write case study' }],
      DAY,
      utcMinutes,
    );
    expect(s).toMatchObject({ id: 'x', localDate: DAY, taskId: 'case-study', startLocalMinutes: 604, endLocalMinutes: 631 });
  });
});

describe('summaryLine', () => {
  it('reads focused of planned, then unplanned', () => {
    expect(summaryLine({ plannedMinutes: 180, anyTimeBlocks: 0, focusedSeconds: 90 * MIN, unplannedSeconds: 38 * MIN }))
      .toBe('1h 30m of 3h planned · 38m unplanned');
  });

  it('drops the unplanned part when there is none', () => {
    expect(summaryLine({ plannedMinutes: 60, anyTimeBlocks: 0, focusedSeconds: 25 * MIN, unplannedSeconds: 0 })).toBe('25m of 1h planned');
  });

  it('says nothing was planned rather than "0m planned"', () => {
    expect(summaryLine({ plannedMinutes: 0, anyTimeBlocks: 0, focusedSeconds: 25 * MIN, unplannedSeconds: 25 * MIN }))
      .toBe('25m focused, nothing planned');
  });

  it('counts any-time work blocks as planned, never as "nothing planned"', () => {
    expect(summaryLine({ plannedMinutes: 0, anyTimeBlocks: 2, focusedSeconds: 70 * MIN, unplannedSeconds: 0 }))
      .toBe('1h 10m focused · 2 planned any time');
    expect(summaryLine({ plannedMinutes: 120, anyTimeBlocks: 1, focusedSeconds: 75 * MIN, unplannedSeconds: 20 * MIN }))
      .toBe('1h 15m of 2h planned · 1 planned any time · 20m unplanned');
  });

  it('is silent on an empty day', () => {
    expect(summaryLine({ plannedMinutes: 0, anyTimeBlocks: 0, focusedSeconds: 0, unplannedSeconds: 0 })).toBeNull();
  });
});
