/**
 * The daily focus goal, held in one place.
 *
 * The goal is set and counted in ONE unit: minutes of focus. It used to be set
 * in sessions and counted in time, bridged by multiplying the session target by
 * the DEFAULT session length — which only holds if every session is that
 * length. Sessions are sized to task estimates (lib/sessionPlan.ts splits an
 * estimate into 5-minute blocks) and the stopwatch records arbitrary durations,
 * so they routinely are not. A goal of 8 x 25m read "goal reached" on one screen
 * and "4 sessions left" on another for the same day's work.
 *
 * Nothing here derives the goal from anything else. That is the point: a derived
 * goal is a second number to keep in sync, and it drifted.
 */

/** Goals are set in whole quarter-hours — the unit people use for focus blocks. */
export const GOAL_STEP_MINUTES = 15;
/** Floor: below a quarter-hour a daily commitment is not one. */
export const GOAL_MIN_MINUTES = 15;
/** Ceiling: 8h is beyond a full day of deep work, so it bounds without binding. */
export const GOAL_MAX_MINUTES = 480;

/**
 * Holds a goal inside the bounds. The single gate on the stored value.
 *
 * Deliberately does NOT snap to the step. A goal converted from the old
 * session-based one can land off the quarter-hour grid — 8 x 50m is 400
 * minutes — and rounding it would silently move someone's commitment, which is
 * the exact failure this change exists to prevent. Snapping is the stepper's
 * job, where the user is the one asking for the change.
 */
export function clampGoalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return GOAL_MIN_MINUTES;
  return Math.max(GOAL_MIN_MINUTES, Math.min(GOAL_MAX_MINUTES, Math.round(minutes)));
}

/**
 * Moves the goal one step, snapping onto the quarter-hour grid on the way.
 *
 * From an off-grid value the first tap lands on the grid and every tap after
 * stays on it, so a migrated 400-minute goal steps to 405 or 390 rather than
 * carrying its remainder forever.
 */
export function stepGoalMinutes(current: number, direction: 1 | -1): number {
  const steps =
    direction === 1
      ? Math.floor(current / GOAL_STEP_MINUTES) + 1
      : Math.ceil(current / GOAL_STEP_MINUTES) - 1;
  return clampGoalMinutes(steps * GOAL_STEP_MINUTES);
}

/** A settings blob as it comes off disk — untrusted, possibly of the old shape. */
type StoredSettings = Record<string, unknown>;

const asPositiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/**
 * Converts a stored settings blob from the session-based goal to the time-based
 * one, in place on a copy.
 *
 * This MUST run on the raw parsed object, BEFORE it is merged over
 * DEFAULT_SETTINGS. The old blob holds `dailySessionTarget` and no
 * `dailyFocusMinutes`, so the merge would fill in the default — a user on
 * 50-minute sessions with a target of 8 has a real goal of 400 minutes and would
 * silently wake up with 200.
 *
 * Three details carry the weight:
 *  - `workDuration` is read from the STORED object, so the conversion uses the
 *    user's own session length rather than the default;
 *  - the old field is DELETED, because object spread does not respect the
 *    narrowed TS type and the retired key would otherwise survive every future
 *    save;
 *  - `changed` tells the caller to persist immediately, which is what makes the
 *    migration run exactly once.
 */
export function migrateDailyGoal(
  parsed: StoredSettings,
  defaultWorkDurationSeconds: number,
): { settings: StoredSettings; changed: boolean } {
  if (!('dailySessionTarget' in parsed)) return { settings: parsed, changed: false };

  const migrated: StoredSettings = { ...parsed };
  delete migrated.dailySessionTarget;

  // A blob holding both keys has already been migrated; the stale key just
  // lingers. Drop it and keep the goal the user is actually on.
  if (!('dailyFocusMinutes' in parsed)) {
    const sessions = asPositiveNumber(parsed.dailySessionTarget);
    const workDuration =
      asPositiveNumber(parsed.workDuration) ?? defaultWorkDurationSeconds;
    if (sessions !== null) {
      const sessionLengthMinutes = Math.round(workDuration / 60);
      migrated.dailyFocusMinutes = clampGoalMinutes(sessions * sessionLengthMinutes);
    }
  }

  return { settings: migrated, changed: true };
}

export type TargetState =
  /** No goal configured, so there is nothing to be short of. */
  | { kind: 'none' }
  /** Goal set, work still to do. */
  | { kind: 'remaining'; seconds: number }
  /** Goal met or passed. */
  | { kind: 'reached' };

/**
 * How today stands against the goal.
 *
 * Returned as a state rather than a bare number so callers cannot accidentally
 * render a negative "-12m left" once the goal is passed — the case that is easy
 * to miss precisely because it only appears on a good day.
 *
 * `kind: 'none'` is unreachable through the UI, since the goal clamps to a
 * minimum of 15 minutes. It is kept deliberately: this function also runs
 * against values read off disk, which no clamp guards.
 */
export function targetProgress(
  focusSecondsToday: number,
  targetSeconds: number,
): TargetState {
  if (targetSeconds <= 0) return { kind: 'none' };
  const remaining = targetSeconds - focusSecondsToday;
  return remaining > 0 ? { kind: 'remaining', seconds: remaining } : { kind: 'reached' };
}
