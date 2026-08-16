import { describe, it, expect } from 'vitest';
import { computeProgress, resolveProgressMode } from './goalProgress';

const counts = (linked: number, done: number, sessions: number) => ({
  linkedTaskCount: linked,
  completedTaskCount: done,
  actualSessions: sessions,
});

describe('resolveProgressMode', () => {
  // A goal cannot claim a sessions component with no target to measure against —
  // it would report progress it has no way to compute.
  it('degrades to tasks when there is no session target', () => {
    expect(resolveProgressMode('sessions', null)).toBe('tasks');
    expect(resolveProgressMode('both', 0)).toBe('tasks');
  });

  it('keeps the stored mode when a target exists', () => {
    expect(resolveProgressMode('both', 12)).toBe('both');
    expect(resolveProgressMode('sessions', 12)).toBe('sessions');
  });
});

describe('computeProgress — tasks mode', () => {
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

describe('computeProgress — sessions mode', () => {
  it('is the logged / target ratio', () => {
    expect(computeProgress('sessions', 12, counts(0, 0, 8)).overallProgress).toBe(8 / 12);
  });

  it('clamps overshoot to 1', () => {
    expect(computeProgress('sessions', 10, counts(0, 0, 25)).overallProgress).toBe(1);
  });

  it('reports null sessionProgress with no target', () => {
    expect(computeProgress('sessions', null, counts(2, 1, 5)).sessionProgress).toBeNull();
  });
});

describe('computeProgress — both mode', () => {
  it('blends the two components 50/50', () => {
    const p = computeProgress('both', 12, counts(5, 3, 8));
    expect(p.taskProgress).toBe(0.6);
    expect(p.sessionProgress).toBe(8 / 12);
    expect(p.overallProgress).toBe((0.6 + 8 / 12) / 2);
  });

  it('is not complete while either component is short', () => {
    // All tasks done but sessions only 90% — must not auto-complete.
    expect(computeProgress('both', 10, counts(2, 2, 9)).overallProgress).toBeLessThan(1);
  });

  it('completes only when both components are full', () => {
    expect(computeProgress('both', 10, counts(2, 2, 10)).overallProgress).toBe(1);
  });

  it('normalises a stored mode that lies about its target', () => {
    // Stored as 'both' but no targetSessions — sessions must be ignored entirely.
    const p = computeProgress('both', null, counts(4, 2, 99));
    expect(p.progressMode).toBe('tasks');
    expect(p.overallProgress).toBe(0.5);
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
