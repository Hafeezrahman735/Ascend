/**
 * Bounds on how much focus time a single /timer/complete request can credit.
 *
 * The client reports its own elapsed time, so these decide what the server is
 * willing to believe. They are deliberately generous — the goal is to make
 * forgery bounded, not to second-guess honest sessions.
 *
 * Extracted from the route handler so the rules can be tested directly; the
 * route now just applies them.
 */

/** A single session can never credit more than six hours. */
export const MAX_SESSION_SECONDS = 6 * 60 * 60;

/** How far back a session may be reported — covers offline use and retries. */
export const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;

/** Tolerance for a device clock running slightly ahead of the server. */
export const MAX_FUTUREDATE_MS = 5 * 60 * 1000;

/**
 * Is this completion timestamp inside the window we accept?
 *
 * Rejecting out-of-window timestamps is what stops streaks being fabricated by
 * backdating sessions across previous days.
 */
export function isCompletionTimeAcceptable(completedAt: number, now: number = Date.now()): boolean {
  return completedAt <= now + MAX_FUTUREDATE_MS && completedAt >= now - MAX_BACKDATE_MS;
}

/**
 * Seconds to actually credit for a session.
 *
 * A session never credits more than it was planned for. The client already
 * clamps this; doing it here makes it a guarantee rather than a convention.
 * A missing or zero plan (the stopwatch) is uncapped beyond MAX_SESSION_SECONDS,
 * which the request schema enforces.
 */
export function creditedSeconds(
  actualElapsedSeconds: number,
  plannedDurationSeconds: number | null | undefined,
): number {
  const actual = Math.max(0, Math.min(actualElapsedSeconds, MAX_SESSION_SECONDS));
  if (!plannedDurationSeconds || plannedDurationSeconds <= 0) return actual;
  return Math.min(actual, plannedDurationSeconds);
}
