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
