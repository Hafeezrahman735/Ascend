import { describe, it, expect } from 'vitest';
import { computeProgress } from './goalProgress';

const counts = (linked: number, done: number, sessions: number, focusSeconds = 0) => ({
  linkedTaskCount: linked,
  completedTaskCount: done,
  actualSessions: sessions,
  totalFocusSeconds: focusSeconds,
});

/**
 * A goal is measured on its completed tasks. One unit.
 *
 * The 'sessions' and 'both' modes and `resolveProgressMode` used to live here
 * with a describe block each. They are gone, not skipped: a goal could be set to
 * a session target that the app could no longer measure honestly once sessions
 * stopped being uniformly workDuration long.
 */

describe('computeProgress', () => {
  it('is the completed / linked ratio', () => {
    expect(computeProgress('tasks', null, counts(5, 3, 0)).overallProgress).toBe(0.6);
  });

  it('is 0 — never 1 — when nothing is linked', () => {
    // 0/0 must not read as "complete", or an empty goal would auto-complete itself.
    expect(computeProgress('tasks', null, counts(0, 0, 0)).overallProgress).toBe(0);
  });

  it('reaches 1 when every task is done', () => {
    expect(computeProgress('tasks', null, counts(4, 4, 0)).overallProgress).toBe(1);
  });
});

describe('computeProgress — the retired session inputs are ignored', () => {
  // These are the rows already in the database. Whatever mode they claim and
  // whatever target they carry, progress is the task ratio.

  it('ignores a stored mode of sessions', () => {
    const p = computeProgress('sessions', 12, counts(4, 1, 8));
    expect(p.progressMode).toBe('tasks');
    expect(p.overallProgress).toBe(0.25);
  });

  it('ignores a stored mode of both', () => {
    // Under the old 50/50 blend this was (0.6 + 8/12) / 2 = 0.633.
    const p = computeProgress('both', 12, counts(5, 3, 8));
    expect(p.progressMode).toBe('tasks');
    expect(p.overallProgress).toBe(0.6);
  });

  it('reports sessionProgress as null, always', () => {
    expect(computeProgress('both', 12, counts(5, 3, 8)).sessionProgress).toBeNull();
    expect(computeProgress('sessions', 99, counts(1, 1, 0)).sessionProgress).toBeNull();
    expect(computeProgress('tasks', null, counts(1, 0, 0)).sessionProgress).toBeNull();
  });

  it('a session target can no longer hold a finished goal back', () => {
    // THE migration case. Every task done but only 9 of 10 sessions logged used
    // to be (1.0 + 0.9) / 2 = 0.95 — short of the auto-completion threshold.
    // It is now exactly 1, which is why a one-time silent backfill exists:
    // otherwise this population completes one at a time, each firing XP, a feed
    // event and a notification for work finished weeks ago.
    expect(computeProgress('both', 10, counts(2, 2, 9)).overallProgress).toBe(1);
  });

  it('a session target can no longer complete a goal with unfinished tasks', () => {
    // The opposite direction: sessions overshot, tasks did not. Used to be
    // (0.5 + 1.0) / 2 = 0.75; still short, but for an honest reason now.
    expect(computeProgress('sessions', 10, counts(2, 1, 25)).overallProgress).toBe(0.5);
  });
});

describe('auto-completion threshold', () => {
  // syncGoalCompletion fires on `overallProgress >= 1`; these pin that boundary.
  it('does not complete just below 1', () => {
    expect(computeProgress('tasks', null, counts(100, 99, 0)).overallProgress).toBeLessThan(1);
  });

  it('completes at exactly 1', () => {
    expect(computeProgress('tasks', null, counts(100, 100, 0)).overallProgress).toBe(1);
  });
});

describe('computeProgress — sessions and time are reporting only', () => {
  // Goal progress is task-denominated. Session count and focus time are stats
  // beside it, never denominators. This guards against either quietly becoming
  // one during a later refactor — which is exactly what happened before.
  it('ignores totalFocusSeconds entirely', () => {
    const withoutTime = computeProgress('tasks', null, counts(4, 2, 6, 0));
    const withTime = computeProgress('tasks', null, counts(4, 2, 6, 99_999));

    expect(withTime.overallProgress).toBe(withoutTime.overallProgress);
    expect(withTime.taskProgress).toBe(withoutTime.taskProgress);
  });

  it('ignores actualSessions entirely', () => {
    const none = computeProgress('tasks', null, counts(4, 2, 0));
    const many = computeProgress('tasks', null, counts(4, 2, 500));

    expect(many.overallProgress).toBe(none.overallProgress);
  });

  it('passes both stats through untouched', () => {
    const p = computeProgress('tasks', null, counts(1, 1, 3, 5_400));
    expect(p.totalFocusSeconds).toBe(5_400);
    expect(p.actualSessions).toBe(3);
  });
});
