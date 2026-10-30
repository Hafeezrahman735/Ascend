/**
 * Whether the selected task is locked to a running focus session.
 *
 * A finished focus phase is credited to the task selected when it COMPLETES
 * (timerStore.complete). Changing the selection mid-session would therefore move
 * the whole session's time to another task, silently. So while a focus phase is
 * running or paused, taskStore.selectTask refuses to switch.
 *
 * Breaks are not locked: nothing is credited for a break, and picking the next
 * task during one is exactly what the break is for. Note that a running break
 * reports `status: 'running'` (the `'break'` status only means a break is ready
 * to start), which is why the phase is part of the rule.
 *
 * Dependency-free on purpose. timerStore already imports taskStore, so taskStore
 * importing timerStore back would close a cycle (the kind `initTaskStore` exists
 * to avoid). timerStore writes the lock on every change; taskStore reads it.
 */
import type { TimerPhase } from '../lib/phaseDuration';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'break';

export function isFocusSessionLocked(status: TimerStatus, phase: TimerPhase): boolean {
  return (status === 'running' || status === 'paused') && phase === 'focus';
}

/** A switch to a different task is refused while locked; re-selecting the same task is not a switch. */
export function canSelectTask(locked: boolean, currentId: string | null, nextId: string | null): boolean {
  return !locked || currentId === nextId;
}

let locked = false;

export function setSessionLocked(value: boolean): void {
  locked = value;
}

export function isSessionLocked(): boolean {
  return locked;
}
