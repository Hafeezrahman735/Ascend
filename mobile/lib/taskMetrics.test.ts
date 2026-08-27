import { describe, it, expect } from 'vitest';
import {
  formatSeconds,
  formatDuration,
  getCompletionRate,
  getPeakHour,
  formatPeakWindow,
  buildCategoryMap,
  getMonday,
} from './taskMetrics';
import type { Task } from '../types';
import type { SessionRecord } from '../store/sync';

// These functions moved out of a 2589-line screen component, where nothing
// could reach them without rendering the whole Tasks tab. The behaviour below
// is what that screen has always relied on — the tests pin it so the remaining
// extraction work cannot quietly change it.

function task(): Task {
  const now = new Date().toISOString();
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Task',
    createdAt: now,
    isCompleted: false,
    isArchived: false,
    completedAt: null,
    totalTimeOnTask: 0,
  } as Task;
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    completedAt: Date.now(),
    durationSeconds: 0,
    taskLabel: null,
    taskId: null,
    type: 'focus',
    ...over,
  };
}

describe('formatSeconds', () => {
  it('rounds sub-minute values up to a whole minute rather than showing seconds', () => {
    // Not a typo: the hero card has never displayed a seconds unit, so 45s
    // reads as "1m". Pinned because it is load-bearing for the layout width.
    expect(formatSeconds(45)).toBe('1m');
  });

  it('renders whole minutes without an hours part', () => {
    expect(formatSeconds(120)).toBe('2m');
  });

  it('splits into hours and minutes past an hour', () => {
    expect(formatSeconds(3900)).toBe('1h 5m');
  });
});

describe('formatDuration', () => {
  it('rolls up into hours past 60 minutes', () => {
    expect(formatDuration(3600)).toContain('1h');
  });
});

describe('getCompletionRate', () => {
  it('returns null when nothing was planned in the period', () => {
    expect(getCompletionRate([], 'today')).toBeNull();
  });

  it('returns 0 when tasks were planned but none completed', () => {
    const tasks = [task(), task()];
    expect(getCompletionRate(tasks, 'today')).toBe(0);
  });

  it('ignores archived tasks on both sides of the ratio', () => {
    const now = new Date().toISOString();
    const tasks = [
      { ...task(), isCompleted: true, completedAt: now },
      { ...task(), isArchived: true },
    ] as Task[];
    // One planned, one completed — the archived task must not count as planned.
    expect(getCompletionRate(tasks, 'today')).toBe(100);
  });
});

describe('getPeakHour', () => {
  const at = (hour: number) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  it('returns null with no sessions', () => {
    expect(getPeakHour([])).toBeNull();
  });

  it('stays null below five sessions — too little data to call a peak', () => {
    const sessions = Array.from({ length: 4 }, () => session({ completedAt: at(14) }));
    expect(getPeakHour(sessions)).toBeNull();
  });

  it('picks the hour with the most sessions, counting sessions not duration', () => {
    const sessions = [
      session({ completedAt: at(9), durationSeconds: 3600 }),
      session({ completedAt: at(9), durationSeconds: 3600 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
    ];
    // 9:00 holds far more time, but 14:00 holds more sessions — and count is
    // what this function ranks on.
    expect(getPeakHour(sessions)).toBe(14);
  });
});

describe('formatPeakWindow', () => {
  it('describes an hour as a readable window', () => {
    expect(typeof formatPeakWindow(14)).toBe('string');
    expect(formatPeakWindow(14).length).toBeGreaterThan(0);
  });
});

describe('buildCategoryMap', () => {
  it('is empty when no sessions map to a task', () => {
    expect(buildCategoryMap([], [])).toEqual({});
  });
});

describe('getMonday', () => {
  it('treats Sunday as the end of the week, not the start', () => {
    // 2026-08-23 is a Sunday; its Monday is the 17th, not the 24th.
    const monday = getMonday(new Date(2026, 7, 23));
    expect(monday.getDate()).toBe(17);
  });

  it('returns the same day when given a Monday', () => {
    const monday = getMonday(new Date(2026, 7, 24));
    expect(monday.getDate()).toBe(24);
  });
});
