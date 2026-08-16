import { describe, it, expect } from 'vitest';
import { achievementProgress, type AchievementStats } from './handler';

const stats: AchievementStats = {
  currentStreak: 5,
  totalSessions: 42,
  totalFocusTime: 7200, // 2 hours, in seconds
  level: 6,
  tasksCompleted: 17,
};

/**
 * achievementProgress backs BOTH the unlock decision in checkAchievements and
 * the `currentValue` returned by GET /achievements. One function on purpose — if
 * the progress bar and the unlock rule were written separately they would drift,
 * and a bar could sit at 100% without unlocking.
 */
describe('achievementProgress', () => {
  it('maps each category to its counter', () => {
    expect(achievementProgress('STREAK', stats)).toBe(5);
    expect(achievementProgress('SESSIONS', stats)).toBe(42);
    expect(achievementProgress('LEVEL', stats)).toBe(6);
    expect(achievementProgress('TASKS', stats)).toBe(17);
  });

  it('converts focus time to minutes, matching how thresholds are expressed', () => {
    // FOCUS_TIME thresholds are minutes (focus_60 = "1 hour"), the counter is seconds.
    expect(achievementProgress('FOCUS_TIME', stats)).toBe(120);
  });

  it('covers TASKS — the category that existed in the enum but had no branch', () => {
    expect(achievementProgress('TASKS', { ...stats, tasksCompleted: 0 })).toBe(0);
    expect(achievementProgress('TASKS', { ...stats, tasksCompleted: 500 })).toBe(500);
  });

  it('returns 0 for an unrecognised category rather than throwing', () => {
    expect(achievementProgress('NOT_A_CATEGORY', stats)).toBe(0);
  });

  it('crosses a threshold exactly at the boundary', () => {
    // tasks_10 has threshold 10.
    expect(achievementProgress('TASKS', { ...stats, tasksCompleted: 9 })).toBeLessThan(10);
    expect(achievementProgress('TASKS', { ...stats, tasksCompleted: 10 })).toBeGreaterThanOrEqual(10);
  });
});
