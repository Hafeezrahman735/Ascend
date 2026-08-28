import { describe, it, expect } from 'vitest';
import {
  formatSeconds,
  formatDuration,
  getCompletionRate,
  getPeakHour,
  formatPeakWindow,
  buildCategoryMap,
  getMonday,
  formatEstimateDelta,
  formatLastWorked,
  formatConsistency,
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

  it('picks the hour holding the most focus time, not the most sessions', () => {
    const sessions = [
      session({ completedAt: at(9), durationSeconds: 3600 }),
      session({ completedAt: at(9), durationSeconds: 3600 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
      session({ completedAt: at(14), durationSeconds: 60 }),
    ];
    // 14:00 holds three sessions to 9:00's two, but they are one minute each.
    // Ranking by count used to return 14 here, which disagreed with the
    // server's mostProductiveHour on identical data.
    expect(getPeakHour(sessions)).toBe(9);
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

describe('formatEstimateDelta', () => {
  it('says over when the task ran long', () => {
    expect(formatEstimateDelta(42 * 60)).toBe('42m over');
  });

  it('says under when the task came in short', () => {
    expect(formatEstimateDelta(-72 * 60)).toBe('1h 12m under');
  });

  it('treats a sub-minute difference as a match, not a near miss', () => {
    expect(formatEstimateDelta(30)).toBe('Matched the estimate');
    expect(formatEstimateDelta(0)).toBe('Matched the estimate');
  });

  it('handles a task with no estimate', () => {
    expect(formatEstimateDelta(null)).toBe('No estimate set');
  });
});

describe('formatLastWorked', () => {
  const now = new Date(2026, 7, 27, 9, 0, 0);

  it('compares calendar days, so last night is yesterday even a few hours ago', () => {
    const lateLastNight = new Date(2026, 7, 26, 23, 30, 0).toISOString();
    expect(formatLastWorked(lateLastNight, now)).toBe('Yesterday');
  });

  it('calls a session earlier the same day today', () => {
    expect(formatLastWorked(new Date(2026, 7, 27, 1, 0, 0).toISOString(), now)).toBe('Today');
  });

  it('counts days, then weeks, then months', () => {
    expect(formatLastWorked(new Date(2026, 7, 23).toISOString(), now)).toBe('4d ago');
    expect(formatLastWorked(new Date(2026, 7, 13).toISOString(), now)).toBe('2w ago');
    expect(formatLastWorked(new Date(2026, 5, 13).toISOString(), now)).toBe('2mo ago');
  });

  it('handles a never-worked task and a corrupt timestamp', () => {
    expect(formatLastWorked(null, now)).toBe('Not started');
    expect(formatLastWorked('not-a-date', now)).toBe('Not started');
  });
});

describe('formatConsistency', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatConsistency(0.6)).toBe('60%');
    expect(formatConsistency(1)).toBe('100%');
  });

  it('renders an em-dash for a task never worked', () => {
    expect(formatConsistency(null)).toBe('—');
  });
});
