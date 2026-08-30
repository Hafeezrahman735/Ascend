import { describe, it, expect } from 'vitest';
import {
  buildAttribution, type AttributionTask, type AttributionGoal,
} from './sessionAttribution';

function task(over: Partial<AttributionTask> = {}): AttributionTask {
  return {
    title: 'Thermodynamics problem set',
    tags: ['Physics'],
    priority: 'high',
    taskGoalId: null,
    isRecurring: false,
    parentTaskId: null,
    ...over,
  };
}

function build(over: {
  task?: AttributionTask | null;
  goal?: AttributionGoal | null;
  completedAt?: string;
  localDate?: string;
  timeZone?: string | null;
} = {}) {
  return buildAttribution({
    task: over.task === undefined ? task() : over.task,
    goal: over.goal ?? null,
    completedAt: new Date(over.completedAt ?? '2026-08-27T14:00:00Z'),
    localDate: over.localDate ?? '2026-08-27',
    timeZone: over.timeZone === undefined ? 'UTC' : over.timeZone,
  });
}

describe('task attribution', () => {
  it('snapshots the title, tags and priority', () => {
    const a = build();
    expect(a.taskTitleSnapshot).toBe('Thermodynamics problem set');
    expect(a.tags).toEqual(['Physics']);
    expect(a.primaryTag).toBe('Physics');
    expect(a.priority).toBe('high');
  });

  it('keeps every tag, not just the first', () => {
    // The read-time path this replaces used tags[0] and discarded the rest.
    const a = build({ task: task({ tags: ['Physics', 'Exam', 'Year 2'] }) });
    expect(a.tags).toEqual(['Physics', 'Exam', 'Year 2']);
    expect(a.primaryTag).toBe('Physics');
  });

  it('records the goal id and its title together', () => {
    const a = build({
      task: task({ taskGoalId: 'goal_1' }),
      goal: { id: 'goal_1', title: 'Chemistry Degree' },
    });
    expect(a.taskGoalId).toBe('goal_1');
    expect(a.goalTitleSnapshot).toBe('Chemistry Degree');
  });

  it('leaves the goal title null when the goal could not be resolved', () => {
    // A dangling id with no title would render as a blank row in the report.
    const a = build({ task: task({ taskGoalId: 'goal_gone' }), goal: null });
    expect(a.taskGoalId).toBe('goal_gone');
    expect(a.goalTitleSnapshot).toBeNull();
  });

  it('handles a free-form session with no task at all', () => {
    const a = build({ task: null });
    expect(a.taskTitleSnapshot).toBeNull();
    expect(a.taskGoalId).toBeNull();
    expect(a.primaryTag).toBeNull();
    expect(a.tags).toEqual([]);
    expect(a.wasRecurring).toBe(false);
    // Local-time buckets still apply — the session happened somewhere in time.
    expect(a.localDate).toBe('2026-08-27');
  });

  it('handles a task with no tags without inventing one', () => {
    const a = build({ task: task({ tags: [] }) });
    expect(a.primaryTag).toBeNull();
    expect(a.tags).toEqual([]);
  });
});

describe('recurring flag', () => {
  it('is true for a spawned habit instance, which carries parentTaskId', () => {
    expect(build({ task: task({ parentTaskId: 'template_1' }) }).wasRecurring).toBe(true);
  });

  it('is true for the template itself, which carries isRecurring', () => {
    expect(build({ task: task({ isRecurring: true }) }).wasRecurring).toBe(true);
  });

  it('is false for an ordinary one-off task', () => {
    expect(build().wasRecurring).toBe(false);
  });
});

describe('local time', () => {
  it('takes the local date from the client rather than re-deriving it', () => {
    // The device knows its user's calendar day; the server is guessing.
    const a = build({ localDate: '2026-08-26', timeZone: 'America/New_York',
                      completedAt: '2026-08-27T01:00:00Z' });
    expect(a.localDate).toBe('2026-08-26');
  });

  it('derives the weekday from the local date, so the two cannot disagree', () => {
    // 2026-08-27 is a Thursday; Sunday-first index 4.
    expect(build({ localDate: '2026-08-27' }).localWeekday).toBe(4);
    // 2026-08-23 is a Sunday.
    expect(build({ localDate: '2026-08-23' }).localWeekday).toBe(0);
  });

  it('resolves the hour in the given zone', () => {
    // 14:00 UTC is 10:00 in New York, which is on EDT in August.
    const a = build({ completedAt: '2026-08-27T14:00:00Z', timeZone: 'America/New_York' });
    expect(a.localHour).toBe(10);
    expect(a.localDateApprox).toBe(false);
  });

  it('falls back to the UTC hour and flags it when no zone is sent', () => {
    const a = build({ completedAt: '2026-08-27T14:00:00Z', timeZone: null });
    expect(a.localHour).toBe(14);
    expect(a.localDateApprox).toBe(true);
  });

  it('flags the hour as approximate when the zone and the client disagree on the day', () => {
    // Client says the 27th, but in Tokyo that instant is already the 28th.
    // Keep the client's date, stop calling the hour exact.
    const a = build({
      completedAt: '2026-08-27T16:00:00Z', timeZone: 'Asia/Tokyo', localDate: '2026-08-27',
    });
    expect(a.localDate).toBe('2026-08-27');
    expect(a.localDateApprox).toBe(true);
  });

  it('does not throw on a garbage zone', () => {
    const a = build({ timeZone: 'Mars/Olympus_Mons' });
    expect(a.localHour).toBe(14); // safeTimeZone fell back to UTC
    expect(Number.isNaN(a.localHour)).toBe(false);
  });
});
