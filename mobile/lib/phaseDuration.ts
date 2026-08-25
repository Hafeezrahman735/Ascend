/**
 * How long the current timer phase runs, in seconds.
 *
 * This lived in three places before: `timerStore.getPhaseDuration`, a verbatim
 * copy in the Focus screen driving the hero progress ring, and a third
 * assumption baked into the live-analytics hook. Three copies of one rule is
 * three chances to disagree — and they would have, the moment a per-task plan
 * made a focus block anything other than `settings.workDuration`: the ring would
 * have started part-consumed and live focus minutes would have jumped the
 * instant Start was pressed.
 *
 * Pure and dependency-free so it can be unit tested without a store, and so the
 * mobile vitest config (which forbids react-native imports) can reach it.
 */

export type TimerPhase = 'focus' | 'shortBreak' | 'longBreak';

/**
 * Only the fields this calculation reads. Deliberately narrower than the store's
 * full `Settings` so a caller can't accidentally couple to the rest of it.
 */
export interface PhaseDurationSettings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
}

/**
 * `plannedFocusSeconds` is the per-task plan overlay: the length of the focus
 * block that is currently loaded, frozen when the session starts so nothing can
 * change it mid-run. Omitted or null means "no plan", and the user's own
 * configured `workDuration` applies — which is the behaviour every caller had
 * before the overlay existed.
 *
 * Breaks deliberately ignore the plan. Break lengths are a user setting, not a
 * property of the task being worked on.
 */
export function getPhaseDuration(
  phase: TimerPhase,
  settings: PhaseDurationSettings,
  plannedFocusSeconds?: number | null,
): number {
  if (phase === 'longBreak') return settings.longBreakDuration;
  if (phase === 'shortBreak') return settings.shortBreakDuration;
  return plannedFocusSeconds ?? settings.workDuration;
}

/**
 * Seconds elapsed in the current phase.
 *
 * `elapsedAtPause` is time already banked by previous start→pause cycles;
 * `startedAt` anchors the segment running right now. A null `startedAt` means no
 * segment is running (paused, or a break queued but not started), so only the
 * banked time counts.
 *
 * `now` is passed in rather than read from `Date.now()` so this stays pure and
 * testable.
 */
export function elapsedInPhase(
  elapsedAtPause: number,
  startedAt: number | null,
  now: number,
): number {
  if (startedAt == null) return elapsedAtPause;
  return elapsedAtPause + Math.floor((now - startedAt) / 1000);
}

export interface RunningPhase {
  phase: TimerPhase;
  settings: PhaseDurationSettings;
  plannedFocusSeconds?: number | null;
  elapsedAtPause: number;
  startedAt: number | null;
}

/**
 * Seconds left in the current phase, clamped at zero.
 *
 * The whole point of this living here is that `pause()`, `tick()` and the
 * force-quit rehydration all used to compute it inline, and three of the four
 * call sites forgot to pass `plannedFocusSeconds` — so a 20-minute planned block
 * started at 20:00 and jumped to 24:59 on the first tick. One function, one
 * signature that cannot be called without the overlay.
 */
export function remainingInPhase(input: RunningPhase, now: number): number {
  const duration = getPhaseDuration(input.phase, input.settings, input.plannedFocusSeconds);
  const elapsed = elapsedInPhase(input.elapsedAtPause, input.startedAt, now);
  return Math.max(0, duration - elapsed);
}
