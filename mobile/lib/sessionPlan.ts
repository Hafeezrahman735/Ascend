/**
 * Splits the work left on a task into focus blocks.
 *
 * One source of truth for two screens: the task sheet previews the split while
 * you type an estimate, and the Focus screen loads the first block into the
 * timer. If these ever disagreed, the app would promise one thing at creation
 * time and do another when you sat down to work.
 *
 * Deliberately NOT returned: the break types between blocks. Whether a break is
 * short or long is decided by the timer's own global pomodoro count
 * (`sessionsUntilLong`), which this function has no access to — so returning a
 * `breaks` array here would be a guess, and any copy derived from it ("then a
 * 5 minute break") would eventually lie. The UI reads break type from the store.
 */

/** Blocks are whole multiples of this, matching the estimate stepper. */
const GRANULARITY = 5;

/**
 * A block shorter than this is not a focus session, it is a rounding artefact.
 * This is a correctness bound, not a preference: without it, a small `W` drives
 * the block count high enough to produce zero-length blocks, and a zero-length
 * focus phase completes on its own first tick — a runaway loop that fires a
 * network call per iteration.
 */
const MIN_BLOCK_MINUTES = 5;

/**
 * The server rejects any session longer than 6 hours (`MAX_SESSION_SECONDS` in
 * backend/src/lib/sessionCredit.ts), while the estimate stepper allows up to 480
 * minutes. Without this cap a long estimate produces a block the backend refuses
 * with a 400, and the whole session is lost rather than merely mis-sized.
 */
const MAX_BLOCK_MINUTES = 360;

/**
 * How far past the configured block length a single sitting may still run
 * unsplit. Someone who set 25-minute blocks and estimates 30 minutes of work
 * wants one 30-minute sitting, not 25 + a 5-minute stub.
 */
const GRACE_MINUTES = 10;

function roundToGranularity(minutes: number): number {
  return Math.round(minutes / GRANULARITY) * GRANULARITY;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Focus blocks for the work remaining on a task, in minutes.
 *
 * @param remainingMinutes  Estimate minus time already logged. Planning from
 *   what is LEFT rather than the original estimate is what keeps a task that is
 *   80% done from offering a full fresh plan every time it is selected.
 * @param sessionLengthMinutes  The user's own configured block length. Never
 *   hardcode 25 here: someone who deliberately set 50-minute blocks should not
 *   be handed 2 x 25 for a 50-minute task.
 *
 * @returns Blocks summing exactly to the rounded remainder, every one a
 *   multiple of 5 and at least 5 minutes. `null` when there is not enough work
 *   left to be worth a block — callers should fall back to the user's default
 *   rather than rendering "0 blocks".
 */
export function getSessionPlan(
  remainingMinutes: number,
  sessionLengthMinutes: number,
): number[] | null {
  if (!Number.isFinite(remainingMinutes) || !Number.isFinite(sessionLengthMinutes)) return null;

  // The Focus stepper allows a 1-minute block, so W is untrusted input here.
  const blockLength = Math.max(1, Math.floor(sessionLengthMinutes));
  const remaining = roundToGranularity(Math.max(0, remainingMinutes));

  if (remaining < MIN_BLOCK_MINUTES) return null;

  // One sitting, when the remainder fits the configured length plus grace — and
  // still fits in a single loggable session.
  const singleBlockCeiling = Math.min(blockLength + GRACE_MINUTES, MAX_BLOCK_MINUTES);
  if (remaining <= singleBlockCeiling) return [remaining];

  let blockCount = Math.ceil(remaining / blockLength);
  // Never exceed what the server will accept for one session...
  blockCount = Math.max(blockCount, Math.ceil(remaining / MAX_BLOCK_MINUTES));
  // ...and never divide so finely that a block falls under the floor.
  blockCount = clamp(blockCount, 1, Math.floor(remaining / MIN_BLOCK_MINUTES));

  // Largest whole 5-minute block that fits `blockCount` times, then hand the
  // leftover out 5 minutes at a time. Front-loaded on purpose: the UI announces
  // "Session 1 of 3 - 25 min", so the longest block coming first is a promise,
  // not an accident.
  const base = Math.floor(remaining / blockCount / GRANULARITY) * GRANULARITY;
  const extras = (remaining - base * blockCount) / GRANULARITY;

  return Array.from({ length: blockCount }, (_, i) =>
    i < extras ? base + GRANULARITY : base,
  );
}

/**
 * The length the timer should load for the next focus block, in SECONDS, or
 * null when the task has no usable plan and the user's default should stand.
 *
 * This is the single function `start()` and the break-to-focus branch of
 * `complete()` both call, so the value frozen into a running session is derived
 * in exactly one place.
 */
export function nextPlannedFocusSeconds(
  remainingMinutes: number,
  sessionLengthMinutes: number,
): number | null {
  const plan = getSessionPlan(remainingMinutes, sessionLengthMinutes);
  if (!plan || plan.length === 0) return null;
  return plan[0] * 60;
}

export const SESSION_PLAN_BOUNDS = {
  GRANULARITY,
  MIN_BLOCK_MINUTES,
  MAX_BLOCK_MINUTES,
  GRACE_MINUTES,
} as const;
