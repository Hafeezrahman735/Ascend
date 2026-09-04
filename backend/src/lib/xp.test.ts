import { describe, it, expect } from 'vitest';
import {
  taskCompletionXP,
  TASK_COMPLETION_XP,
  GOAL_COMPLETION_XP,
  calculateXP,
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
