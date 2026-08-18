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

  it('converts focus time to HOURS, matching how thresholds are expressed', () => {
    // This test previously asserted minutes and was encoding a live bug.
    //
    // The seeded thresholds are hours, not minutes: focus_60 is titled
    // "Accumulate 1 hour" and carries `threshold: 1`; focus_6000 is
    // "One Hundred Hours" and carries `threshold: 100`. Only the KEY names are
    // in minutes, which is what misled the original assertion. Comparing
    // minutes against an hours threshold unlocked "One Hundred Hours" after
    // 100 minutes.
    //
    // Fixed in the code rather than the seed because seeding does not run on
    // deploy (railway.json preDeployCommand is `prisma db push` only), so the
    // rows already in production carry the hour values and the comparison has
    // to match them.
    expect(achievementProgress('FOCUS_TIME', stats)).toBe(2);
  });

  it('does not credit a partial hour', () => {
    // 59 minutes 59 seconds is still zero hours — the boundary that decides
    // whether "First Hour" unlocks a minute early.
    expect(achievementProgress('FOCUS_TIME', { ...stats, totalFocusTime: 3599 })).toBe(0);
    expect(achievementProgress('FOCUS_TIME', { ...stats, totalFocusTime: 3600 })).toBe(1);
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
