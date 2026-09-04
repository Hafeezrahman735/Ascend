import { describe, it, expect } from 'vitest';
import { computeTodayTrace, isTraceEmpty, formatTraceDuration } from './todayTrace';
import type { Task } from '../types';
import type { SessionRecord } from '../store/sync';

const HOUR = 60 * 60 * 1000;

/**
 * Midday today, not `Date.now() - 1h`.
 *
 * The fixture used to subtract an hour from now, which lands on YESTERDAY for
 * any run between midnight and 01:00 — so these tests passed all day and failed
 * in the small hours. Anchoring to noon keeps every "today" session inside the
 * local day no matter when the suite runs.
 */
function middayToday(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    completedAt: middayToday(),
    durationSeconds: 25 * 60,
    taskLabel: null,
    taskId: null,
    type: 'focus',
    ...over,
  } as SessionRecord;
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'T', isCompleted: false, isArchived: false,
    completedAt: null, dueDate: null, parentTaskId: null, tags: [],
    priority: 'medium', sessionsOnTask: 0, totalTimeOnTask: 0, sessionDates: [],
    ...over,
  } as unknown as Task;
}

const base = { sessionHistory: [], tasks: [], currentStreak: 0 };

describe('computeTodayTrace', () => {
  it('is all zeros for someone who has done nothing', () => {
    expect(computeTodayTrace(base)).toEqual({
      sessionCount: 0, focusSeconds: 0, tasksCompleted: 0, streakDays: 0,
    });
  });

  it('sums today focus sessions', () => {
    const trace = computeTodayTrace({
      ...base,
      sessionHistory: [session(), session({ durationSeconds: 50 * 60 })],
    });
    expect(trace.sessionCount).toBe(2);
    expect(trace.focusSeconds).toBe(75 * 60);
  });

  it('ignores breaks — a break is not focus time', () => {
    const trace = computeTodayTrace({
      ...base,
      sessionHistory: [session(), session({ type: 'break', durationSeconds: 5 * 60 })],
    });
    expect(trace.sessionCount).toBe(1);
    expect(trace.focusSeconds).toBe(25 * 60);
  });

  it('ignores sessions from previous days', () => {
    // The card says "today". Yesterday's work belongs on yesterday's card.
    const trace = computeTodayTrace({
      ...base,
      sessionHistory: [session(), session({ completedAt: middayToday() - 48 * HOUR })],
    });
    expect(trace.sessionCount).toBe(1);
  });

  it('counts tasks completed today only', () => {
    const trace = computeTodayTrace({
      ...base,
      tasks: [
        task({ isCompleted: true, completedAt: new Date(middayToday()).toISOString() }),
        task({ isCompleted: true, completedAt: new Date(middayToday() - 48 * HOUR).toISOString() }),
        task({ isCompleted: false }),
      ],
    });
    expect(trace.tasksCompleted).toBe(1);
  });

  it('counts an archived task that was completed today', () => {
    // Finishing something and filing it away is still having finished it —
    // excluding archived rows would make the number drop during the day.
    const trace = computeTodayTrace({
      ...base,
      tasks: [task({ isCompleted: true, isArchived: true, completedAt: new Date().toISOString() })],
    });
    expect(trace.tasksCompleted).toBe(1);
  });

  it('ignores a completed task with no completion time', () => {
    const trace = computeTodayTrace({
      ...base,
      tasks: [task({ isCompleted: true, completedAt: null })],
    });
    expect(trace.tasksCompleted).toBe(0);
  });

  it('passes the streak straight through', () => {
    expect(computeTodayTrace({ ...base, currentStreak: 7 }).streakDays).toBe(7);
  });
});

describe('isTraceEmpty', () => {
  it('is empty with no sessions and no tasks', () => {
    expect(isTraceEmpty(computeTodayTrace(base))).toBe(true);
  });

  it('is NOT empty when only tasks were done', () => {
    // Clearing tasks without running the timer is still showing up.
    const trace = computeTodayTrace({
      ...base,
      tasks: [task({ isCompleted: true, completedAt: new Date(middayToday()).toISOString() })],
    });
    expect(isTraceEmpty(trace)).toBe(false);
  });

  it('is NOT empty on a streak alone if a session ran', () => {
    const trace = computeTodayTrace({ ...base, sessionHistory: [session()], currentStreak: 3 });
    expect(isTraceEmpty(trace)).toBe(false);
  });
});

describe('formatTraceDuration', () => {
  it('shows bare minutes under an hour', () => {
    expect(formatTraceDuration(25 * 60)).toBe('25m');
  });

  it('shows a whole hour without a trailing zero', () => {
    expect(formatTraceDuration(60 * 60)).toBe('1h');
  });

  it('shows hours and minutes together', () => {
    expect(formatTraceDuration(75 * 60)).toBe('1h 15m');
  });

  it('shows 0m rather than an empty string', () => {
    expect(formatTraceDuration(0)).toBe('0m');
  });

  it('rounds part-minutes down rather than up', () => {
    // 59 seconds of focus is not a minute of focus.
    expect(formatTraceDuration(119)).toBe('1m');
  });
});
