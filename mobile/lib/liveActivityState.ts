/**
 * Pure translation from timer state to Live Activity content.
 *
 * This is the whole "what should the Lock Screen say" rule, kept free of
 * react-native and of the store so it can be unit tested under plain Node — the
 * widget itself can only ever be tested by eye on a device, so everything that
 * *can* be pinned down in a test lives here instead of in the adapter.
 *
 * The Live Activity is a one-way mirror. It never decides anything; in-app state
 * is authoritative, and this function only describes what that state looks like.
 */

import {
  getPhaseDuration,
  elapsedInPhase,
  remainingInPhase,
  type TimerPhase,
  type PhaseDurationSettings,
} from './phaseDuration';

/**
 * ActivityKit ends an Activity after roughly 8 hours no matter what the app
 * wants. Only the stopwatch can realistically reach that; a Pomodoro phase can't.
 * We mark the content stale slightly before the cliff so the card visibly
 * de-emphasises instead of silently vanishing.
 */
export const MAX_ACTIVITY_SECONDS = 8 * 60 * 60;
export const STALE_AFTER_SECONDS = MAX_ACTIVITY_SECONDS - 10 * 60;

/**
 * The props handed to the widget. Flat and JSON-serialisable by necessity —
 * `LiveActivityFactory.start()` puts these through `JSON.stringify`, so Dates
 * would arrive as strings. Epoch milliseconds cross the boundary intact and the
 * widget rebuilds Dates on the other side.
 */
export interface TimerActivityProps {
  /** "Focus" / "Short Break" / "Long Break" — already localised for display. */
  phaseLabel: string;
  /** The task this session is attached to, or null when none is selected. */
  taskLabel: string | null;
  isPaused: boolean;
  /** False for the stopwatch, which counts up and has no end. */
  countsDown: boolean;
  /** The phase window. iOS renders the countdown from this range by itself. */
  rangeStartMs: number;
  rangeEndMs: number;
  /**
   * The instant the timer should appear frozen at, or null while running.
   * SwiftUI's `Text(timerInterval:pauseTime:)` takes this directly — which is
   * why there is one render path here and not a separate static paused branch.
   */
  pausedAtMs: number | null;
  /**
   * Fraction of the phase still remaining, 0..1, only when paused.
   *
   * `ProgressView` accepts `timerInterval` but has no `pauseTime`, so a paused
   * card would keep draining its bar while the text sat still. When paused we
   * hand it a fixed `value` instead and the two agree.
   */
  pausedProgress: number | null;
}

export type TimerActivityStatus = 'idle' | 'running' | 'paused' | 'break';
export type TimerActivityMode = 'pomodoro' | 'stopwatch';

/** Exactly the timer state this translation reads, and nothing else. */
export interface TimerSnapshot {
  status: TimerActivityStatus;
  mode: TimerActivityMode;
  phase: TimerPhase;
  settings: PhaseDurationSettings;
  plannedFocusSeconds: number | null;
  elapsedAtPause: number;
  startedAt: number | null;
  taskLabel: string | null;
}

const PHASE_LABELS: Record<TimerPhase, string> = {
  focus: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break',
};

/**
 * The content for the current state, or null when no card should exist.
 *
 * Null covers two cases that matter: `idle`, and `break` — which in this store
 * means "a break is queued but has not been started", `startedAt` still null. A
 * queued break has a full timeLeft and no clock running, so mirroring it would
 * park a card on the Lock Screen frozen at 5:00 that never moves and that the
 * user never asked for.
 */
export function toActivityProps(snap: TimerSnapshot, now: number): TimerActivityProps | null {
  if (snap.status !== 'running' && snap.status !== 'paused') return null;
  // 'running' with no anchor is not a state the store can reach on its own, but
  // a torn-down session can leave it behind. There is no clock to mirror, so
  // mirroring it would park a full-duration card that never moves.
  if (snap.status === 'running' && snap.startedAt == null) return null;

  const isPaused = snap.status === 'paused';
  const elapsed = elapsedInPhase(snap.elapsedAtPause, snap.startedAt, now);

  if (snap.mode === 'stopwatch') {
    // Counts up from when it started, with no meaningful end — the range only
    // needs an upper bound iOS will never reach before the activity is over.
    return {
      phaseLabel: PHASE_LABELS.focus,
      taskLabel: snap.taskLabel,
      isPaused,
      countsDown: false,
      rangeStartMs: now - elapsed * 1000,
      rangeEndMs: now - elapsed * 1000 + MAX_ACTIVITY_SECONDS * 1000,
      pausedAtMs: isPaused ? now : null,
      pausedProgress: null,
    };
  }

  const duration = getPhaseDuration(snap.phase, snap.settings, snap.plannedFocusSeconds);
  const remaining = remainingInPhase(
    {
      phase: snap.phase,
      settings: snap.settings,
      plannedFocusSeconds: snap.plannedFocusSeconds,
      elapsedAtPause: snap.elapsedAtPause,
      startedAt: snap.startedAt,
    },
    now,
  );

  return {
    phaseLabel: PHASE_LABELS[snap.phase],
    taskLabel: snap.taskLabel,
    isPaused,
    countsDown: true,
    // The real phase window, not just the remainder, so the progress bar drains
    // across the whole phase rather than restarting on every resume.
    rangeStartMs: now - elapsed * 1000,
    rangeEndMs: now + remaining * 1000,
    pausedAtMs: isPaused ? now : null,
    pausedProgress: isPaused && duration > 0 ? remaining / duration : null,
  };
}

/**
 * When the system should start treating this card's content as stale.
 *
 * Only ever reached by a stopwatch left running for most of a day; a Pomodoro
 * phase ends long before it matters.
 */
export function staleDateFor(props: TimerActivityProps): Date {
  return new Date(props.rangeStartMs + STALE_AFTER_SECONDS * 1000);
}

/**
 * Whether a state change is worth pushing to ActivityKit.
 *
 * The countdown itself is rendered by iOS from `rangeEndMs`, so a running card
 * needs no updates at all — pushing every tick would be per-second bridge
 * traffic for a card that already animates on its own. Only a change the OS
 * cannot infer justifies a write.
 *
 * `rangeEndMs` is deliberately compared with a tolerance: it is derived from
 * `Date.now()`, so two consecutive reads of an unchanged session differ by a few
 * milliseconds and a strict comparison would push on every subscriber fire.
 */
export function needsUpdate(
  prev: TimerActivityProps,
  next: TimerActivityProps,
  toleranceMs = 1500,
): boolean {
  return (
    prev.phaseLabel !== next.phaseLabel ||
    prev.taskLabel !== next.taskLabel ||
    prev.isPaused !== next.isPaused ||
    prev.countsDown !== next.countsDown ||
    Math.abs(prev.rangeEndMs - next.rangeEndMs) > toleranceMs
  );
}
