import { describe, it, expect } from 'vitest';
import {
  taskCompletionXP,
  TASK_COMPLETION_XP,
  GOAL_COMPLETION_XP,
  calculateXP,
  calculateLevel,
  xpForLevel,
} from './xp';

describe('taskCompletionXP', () => {
  it('scales with priority', () => {
    expect(taskCompletionXP('low')).toBeLessThan(taskCompletionXP('medium'));
    expect(taskCompletionXP('medium')).toBeLessThan(taskCompletionXP('high'));
    expect(taskCompletionXP('high')).toBeLessThan(taskCompletionXP('urgent'));
  });

  it('falls back to medium for an unknown priority', () => {
    expect(taskCompletionXP('nonsense')).toBe(TASK_COMPLETION_XP.medium);
  });

  // Completing tasks must not out-earn actually focusing, or the incentive
  // inverts and churning trivial tasks beats doing the work.
  it('is worth less than a single 25-minute focus session', () => {
    const pomodoroXP = calculateXP(25 * 60, 0);
    expect(taskCompletionXP('urgent')).toBeLessThan(pomodoroXP);
  });

  it('a goal is worth more than any single task', () => {
    expect(GOAL_COMPLETION_XP).toBeGreaterThan(taskCompletionXP('urgent'));
  });
});

describe('calculateLevel — shared by session, task and goal XP paths', () => {
  it('starts at level 1', () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(99)).toBe(1);
  });

  it('advances at the published thresholds', () => {
    expect(calculateLevel(100)).toBe(2);
    expect(calculateLevel(250)).toBe(3);
    expect(calculateLevel(12000)).toBe(10);
  });

  it('never decreases as XP grows', () => {
    let previous = 0;
    for (let xp = 0; xp <= 60_000; xp += 500) {
      const level = calculateLevel(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('agrees with xpForLevel at each boundary', () => {
    for (let level = 2; level <= 15; level++) {
      const threshold = xpForLevel(level);
      expect(calculateLevel(threshold)).toBe(level);
      expect(calculateLevel(threshold - 1)).toBe(level - 1);
    }
  });
});

describe('calculateXP — session streak multiplier', () => {
  it('pays a flat rate with no streak', () => {
    expect(calculateXP(25 * 60, 0)).toBe(250);
  });

  it('increases with streak tiers and never decreases', () => {
    const tiers = [0, 3, 7, 14, 30].map((s) => calculateXP(25 * 60, s));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]);
    }
    expect(tiers[tiers.length - 1]).toBeGreaterThan(tiers[0]);
  });

  it('pays nothing for a session under a minute', () => {
    expect(calculateXP(59, 10)).toBe(0);
  });
});
