/**
 * The daily focus target, derived in one place.
 *
 * Two screens show this number now — the Tasks pill strip and the Focus tab's
 * bottom stats — and they must never disagree about it. A target that reads
 * "45m to goal" on one tab and "1h 10m" on the other is not a rounding
 * curiosity to the person looking at it; it means the app cannot count.
 *
 * The target is expressed in SESSIONS by the user, and the app converts to
 * time. The conversion rounds the session length to whole minutes first, which
 * is what the Tasks screen has always done — a 1500-second block is 25 minutes,
 * not 25.0 — so the two sides agree exactly rather than approximately.
 */

/** Total seconds of focus the user is aiming for today. 0 means no target set. */
export function dailyFocusTargetSeconds(
  dailySessionTarget: number,
  workDurationSeconds: number,
): number {
  if (dailySessionTarget <= 0 || workDurationSeconds <= 0) return 0;
  const sessionLengthMinutes = Math.round(workDurationSeconds / 60);
  return dailySessionTarget * sessionLengthMinutes * 60;
}

export type TargetState =
  /** No target configured, so there is nothing to be short of. */
  | { kind: 'none' }
  /** Target set, work still to do. */
  | { kind: 'remaining'; seconds: number }
  /** Target met or passed. */
  | { kind: 'reached' };

/**
 * How today stands against the target.
 *
 * Returned as a state rather than a bare number so callers cannot accidentally
 * render a negative "-12m left" once the target is passed — the case that is
 * easy to miss precisely because it only appears on a good day.
 */
export function targetProgress(
  focusSecondsToday: number,
  targetSeconds: number,
): TargetState {
  if (targetSeconds <= 0) return { kind: 'none' };
  const remaining = targetSeconds - focusSecondsToday;
  return remaining > 0 ? { kind: 'remaining', seconds: remaining } : { kind: 'reached' };
}
