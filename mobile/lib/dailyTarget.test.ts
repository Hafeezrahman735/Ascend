import { describe, it, expect } from 'vitest';
import {
  clampGoalMinutes,
  stepGoalMinutes,
  migrateDailyGoal,
  targetProgress,
  GOAL_MIN_MINUTES,
  GOAL_MAX_MINUTES,
} from './dailyTarget';

const MIN = 60;
const DEFAULT_WORK = 25 * MIN;

describe('clampGoalMinutes', () => {
  it('leaves an in-bounds goal exactly as it is', () => {
    // Not snapped: a converted goal may sit off the quarter-hour grid, and
    // moving it would change a commitment the user never asked to change.
    expect(clampGoalMinutes(400)).toBe(400);
    expect(clampGoalMinutes(97)).toBe(97);
  });

  it('holds inside the bounds', () => {
    expect(clampGoalMinutes(0)).toBe(GOAL_MIN_MINUTES);
    expect(clampGoalMinutes(-30)).toBe(GOAL_MIN_MINUTES);
    expect(clampGoalMinutes(10_000)).toBe(GOAL_MAX_MINUTES);
  });

  it('falls back to the floor rather than propagating NaN into a stored goal', () => {
    expect(clampGoalMinutes(Number.NaN)).toBe(GOAL_MIN_MINUTES);
  });
});

describe('stepGoalMinutes', () => {
  it('moves a quarter-hour at a time from an on-grid goal', () => {
    expect(stepGoalMinutes(195, 1)).toBe(210);
    expect(stepGoalMinutes(195, -1)).toBe(180);
  });

  it('snaps an off-grid goal onto the grid on the first tap', () => {
    // A migrated 8 x 50m goal is 400 minutes; it should not carry that
    // remainder forever once the user starts adjusting it.
    expect(stepGoalMinutes(400, 1)).toBe(405);
    expect(stepGoalMinutes(400, -1)).toBe(390);
    expect(stepGoalMinutes(200, 1)).toBe(210);
    expect(stepGoalMinutes(200, -1)).toBe(195);
  });

  it('cannot step outside the bounds', () => {
    expect(stepGoalMinutes(GOAL_MIN_MINUTES, -1)).toBe(GOAL_MIN_MINUTES);
    expect(stepGoalMinutes(GOAL_MAX_MINUTES, 1)).toBe(GOAL_MAX_MINUTES);
  });
});

describe('migrateDailyGoal', () => {
  it('converts using the default session length', () => {
    // 8 x 25m = 200m, which is the new default, so a default user is unchanged.
    const { settings, changed } = migrateDailyGoal(
      { dailySessionTarget: 8, workDuration: DEFAULT_WORK },
      DEFAULT_WORK,
    );
    expect(changed).toBe(true);
    expect(settings.dailyFocusMinutes).toBe(200);
  });

  it("converts using the user's OWN session length, not the default", () => {
    // The failure this migration exists to avoid: 8 x 50m is a 400-minute
    // commitment, and merging over DEFAULT_SETTINGS would have made it 200 —
    // half the goal, silently, with no prompt.
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 8, workDuration: 50 * MIN },
      DEFAULT_WORK,
    );
    expect(settings.dailyFocusMinutes).toBe(400);
  });

  it('handles a short session length', () => {
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 6, workDuration: 15 * MIN },
      DEFAULT_WORK,
    );
    expect(settings.dailyFocusMinutes).toBe(90);
  });

  it('rounds the session length to whole minutes before converting', () => {
    // 1490s is 24.83 minutes; it must be treated as 25, as both screens did.
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 4, workDuration: 1490 },
      DEFAULT_WORK,
    );
    expect(settings.dailyFocusMinutes).toBe(100);
  });

  it('falls back to the default session length when the blob has none', () => {
    const { settings } = migrateDailyGoal({ dailySessionTarget: 8 }, DEFAULT_WORK);
    expect(settings.dailyFocusMinutes).toBe(200);
  });

  it('keeps a converted goal exactly, even off the quarter-hour grid', () => {
    // 6 x 35m = 210m is on the grid; 5 x 35m = 175m is not, and must survive
    // as 175 rather than being rounded to 180.
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 5, workDuration: 35 * MIN },
      DEFAULT_WORK,
    );
    expect(settings.dailyFocusMinutes).toBe(175);
  });

  it('clamps a converted goal that lands outside the new bounds', () => {
    // The old range reached 50 sessions — ~20 hours at 25m — which does not
    // survive being stated in minutes.
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 50, workDuration: DEFAULT_WORK },
      DEFAULT_WORK,
    );
    expect(settings.dailyFocusMinutes).toBe(GOAL_MAX_MINUTES);
  });

  it('removes the retired field, so no future save can write it back', () => {
    const { settings } = migrateDailyGoal(
      { dailySessionTarget: 8, workDuration: DEFAULT_WORK },
      DEFAULT_WORK,
    );
    expect('dailySessionTarget' in settings).toBe(false);
  });

  it('leaves every other setting untouched', () => {
    const { settings } = migrateDailyGoal(
      {
        dailySessionTarget: 8,
        workDuration: 50 * MIN,
        shortBreakDuration: 300,
        longBreakDuration: 900,
        sessionsUntilLong: 4,
      },
      DEFAULT_WORK,
    );
    expect(settings).toMatchObject({
      workDuration: 50 * MIN,
      shortBreakDuration: 300,
      longBreakDuration: 900,
      sessionsUntilLong: 4,
    });
  });

  it('is idempotent — running it on its own output changes nothing', () => {
    const first = migrateDailyGoal(
      { dailySessionTarget: 8, workDuration: 50 * MIN },
      DEFAULT_WORK,
    );
    const second = migrateDailyGoal(first.settings, DEFAULT_WORK);
    expect(second.changed).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });

  it('leaves an already-migrated blob alone', () => {
    const stored = { dailyFocusMinutes: 315, workDuration: DEFAULT_WORK };
    const { settings, changed } = migrateDailyGoal(stored, DEFAULT_WORK);
    expect(changed).toBe(false);
    expect(settings.dailyFocusMinutes).toBe(315);
  });

  it('drops a stale retired key without overwriting the real goal', () => {
    // Both keys present means the conversion already ran; the user's current
    // goal wins and the leftover key goes.
    const { settings, changed } = migrateDailyGoal(
      { dailyFocusMinutes: 315, dailySessionTarget: 8, workDuration: DEFAULT_WORK },
      DEFAULT_WORK,
    );
    expect(changed).toBe(true);
    expect(settings.dailyFocusMinutes).toBe(315);
    expect('dailySessionTarget' in settings).toBe(false);
  });

  it('does not mutate the object it was given', () => {
    const stored = { dailySessionTarget: 8, workDuration: DEFAULT_WORK };
    migrateDailyGoal(stored, DEFAULT_WORK);
    expect(stored).toEqual({ dailySessionTarget: 8, workDuration: DEFAULT_WORK });
  });

  it('drops a nonsensical stored target rather than inventing a goal from it', () => {
    // No dailyFocusMinutes is written, so the DEFAULT_SETTINGS merge supplies
    // the default — the right outcome when the stored value is unusable.
    const { settings, changed } = migrateDailyGoal(
      { dailySessionTarget: 'eight', workDuration: DEFAULT_WORK },
      DEFAULT_WORK,
    );
    expect(changed).toBe(true);
    expect('dailySessionTarget' in settings).toBe(false);
    expect('dailyFocusMinutes' in settings).toBe(false);
  });

  it('leaves a fresh install alone', () => {
    const { settings, changed } = migrateDailyGoal({ workDuration: DEFAULT_WORK }, DEFAULT_WORK);
    expect(changed).toBe(false);
    expect(settings).toEqual({ workDuration: DEFAULT_WORK });
  });
});

describe('targetProgress', () => {
  it('reports no target when none is set', () => {
    expect(targetProgress(0, 0)).toEqual({ kind: 'none' });
  });

  it('reports the full target before any work', () => {
    expect(targetProgress(0, 200 * MIN)).toEqual({ kind: 'remaining', seconds: 200 * MIN });
  });

  it('counts down as focus accumulates', () => {
    expect(targetProgress(155 * MIN, 200 * MIN)).toEqual({ kind: 'remaining', seconds: 45 * MIN });
  });

  it('reports reached exactly on the target', () => {
    expect(targetProgress(200 * MIN, 200 * MIN)).toEqual({ kind: 'reached' });
  });

  it('never reports a negative remainder once the target is passed', () => {
    // The case that only shows up on a good day, which is why it is easy to miss.
    expect(targetProgress(260 * MIN, 200 * MIN)).toEqual({ kind: 'reached' });
  });

  it('counts a task-sized session at its real length, not a nominal one', () => {
    // The whole point of the change: four 50-minute sessions against a
    // 200-minute goal is done, and no longer reads as "4 sessions left".
    expect(targetProgress(4 * 50 * MIN, 200 * MIN)).toEqual({ kind: 'reached' });
  });
});
