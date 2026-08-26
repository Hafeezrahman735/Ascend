import { describe, it, expect } from 'vitest';
import {
  toActivityProps,
  needsUpdate,
  staleDateFor,
  STALE_AFTER_SECONDS,
  type TimerSnapshot,
} from './liveActivityState';

const T0 = 1_700_000_000_000;

const settings = {
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
};

const running: TimerSnapshot = {
  status: 'running',
  mode: 'pomodoro',
  phase: 'focus',
  settings,
  plannedFocusSeconds: null,
  elapsedAtPause: 0,
  startedAt: T0,
  taskLabel: 'Write the RFC',
};

describe('toActivityProps — when a card should exist at all', () => {
  it('shows nothing when idle', () => {
    expect(toActivityProps({ ...running, status: 'idle', startedAt: null }, T0)).toBeNull();
  });

  /**
   * 'break' in this store means "a break is queued but not started" — startedAt
   * is null and nothing is counting. Mirroring it would park a card frozen at
   * 5:00 that never moves and that the user never started.
   */
  it('shows nothing for a queued break that has not been started', () => {
    expect(
      toActivityProps({ ...running, status: 'break', phase: 'shortBreak', startedAt: null }, T0),
    ).toBeNull();
  });

  it('shows nothing for a running session with no clock anchor', () => {
    expect(toActivityProps({ ...running, startedAt: null }, T0)).toBeNull();
  });
});

describe('toActivityProps — running pomodoro', () => {
  it('ends the range at the real end of the phase', () => {
    const props = toActivityProps(running, T0)!;
    expect(props.rangeEndMs).toBe(T0 + 1500 * 1000);
    expect(props.countsDown).toBe(true);
    expect(props.isPaused).toBe(false);
    expect(props.pausedAtMs).toBeNull();
  });

  it('spans the whole phase, not just the remainder, so the bar drains once', () => {
    // 10 minutes in.
    const props = toActivityProps(running, T0 + 600_000)!;
    expect(props.rangeStartMs).toBe(T0);
    expect(props.rangeEndMs).toBe(T0 + 1500 * 1000);
  });

  /**
   * The reason the getPhaseDuration fix had to land first: endDate derives from
   * exactly the values that were being computed against workDuration.
   */
  it('sizes a planned block from the plan, not the default work duration', () => {
    const props = toActivityProps({ ...running, plannedFocusSeconds: 1200 }, T0)!;
    expect(props.rangeEndMs).toBe(T0 + 1200 * 1000);
  });

  it('labels the phase', () => {
    expect(toActivityProps(running, T0)!.phaseLabel).toBe('Focus');
    expect(toActivityProps({ ...running, phase: 'shortBreak' }, T0)!.phaseLabel).toBe('Short Break');
    expect(toActivityProps({ ...running, phase: 'longBreak' }, T0)!.phaseLabel).toBe('Long Break');
  });

  it('carries the task label, and tolerates having none', () => {
    expect(toActivityProps(running, T0)!.taskLabel).toBe('Write the RFC');
    expect(toActivityProps({ ...running, taskLabel: null }, T0)!.taskLabel).toBeNull();
  });
});

describe('toActivityProps — paused', () => {
  const paused: TimerSnapshot = {
    ...running,
    status: 'paused',
    startedAt: null,
    elapsedAtPause: 300, // 5 minutes done of 25
  };

  it('freezes the countdown at the moment of pause', () => {
    const props = toActivityProps(paused, T0 + 999_999)!;
    expect(props.isPaused).toBe(true);
    expect(props.pausedAtMs).toBe(T0 + 999_999);
    // 20 minutes still to run, measured from the pause instant.
    expect(props.rangeEndMs - props.pausedAtMs!).toBe(1200 * 1000);
  });

  /**
   * ProgressView takes timerInterval but has no pauseTime, so a paused card
   * would keep draining its bar while the text stood still.
   */
  it('supplies a fixed progress value so the bar cannot disagree with the text', () => {
    const props = toActivityProps(paused, T0)!;
    expect(props.pausedProgress).toBeCloseTo(1200 / 1500, 5);
  });

  it('leaves progress unset while running', () => {
    expect(toActivityProps(running, T0)!.pausedProgress).toBeNull();
  });
});

describe('toActivityProps — stopwatch', () => {
  const stopwatch: TimerSnapshot = { ...running, mode: 'stopwatch', elapsedAtPause: 0 };

  it('counts up instead of down', () => {
    const props = toActivityProps(stopwatch, T0 + 60_000)!;
    expect(props.countsDown).toBe(false);
    expect(props.rangeStartMs).toBe(T0);
  });

  it('has no progress bar, having nothing to measure against', () => {
    expect(toActivityProps(stopwatch, T0)!.pausedProgress).toBeNull();
  });

  it('bounds the range at the ActivityKit ceiling', () => {
    const props = toActivityProps(stopwatch, T0)!;
    expect(props.rangeEndMs - props.rangeStartMs).toBe(8 * 60 * 60 * 1000);
  });
});

describe('needsUpdate', () => {
  /**
   * The core performance claim of the whole feature: a running countdown costs
   * nothing, because iOS renders it from the end date it already has. If this
   * test fails, the feature is pushing per-second bridge traffic.
   */
  it('does not push while a session simply runs', () => {
    const first = toActivityProps(running, T0)!;
    for (const offset of [1, 500, 1000, 30_000, 600_000]) {
      const later = toActivityProps(running, T0 + offset)!;
      expect(needsUpdate(first, later)).toBe(false);
    }
  });

  it('pushes when the session pauses', () => {
    const before = toActivityProps(running, T0 + 60_000)!;
    const after = toActivityProps(
      { ...running, status: 'paused', startedAt: null, elapsedAtPause: 60 },
      T0 + 60_000,
    )!;
    expect(needsUpdate(before, after)).toBe(true);
  });

  it('pushes when the phase changes', () => {
    const focus = toActivityProps(running, T0)!;
    const breakPhase = toActivityProps({ ...running, phase: 'shortBreak' }, T0)!;
    expect(needsUpdate(focus, breakPhase)).toBe(true);
  });

  it('pushes when the attached task changes', () => {
    const before = toActivityProps(running, T0)!;
    const after = toActivityProps({ ...running, taskLabel: 'Something else' }, T0)!;
    expect(needsUpdate(before, after)).toBe(true);
  });

  /**
   * The phase end is derived from `settings`, not stored, so editing the work
   * duration mid-session moves it. `useTimerLiveActivity` therefore has to watch
   * `settings` — this pins the half of that which can be tested without a store.
   */
  it('pushes when the work duration is edited mid-session', () => {
    const before = toActivityProps(running, T0)!;
    const after = toActivityProps(
      { ...running, settings: { ...settings, workDuration: 3000 } },
      T0,
    )!;
    expect(after.rangeEndMs).toBe(T0 + 3000 * 1000);
    expect(needsUpdate(before, after)).toBe(true);
  });

  it('pushes when a resume moves the end of the session', () => {
    const before = toActivityProps(running, T0)!;
    // Paused for two minutes, then resumed: the end date has moved out.
    const after = toActivityProps(
      { ...running, startedAt: T0 + 120_000, elapsedAtPause: 0 },
      T0 + 120_000,
    )!;
    expect(needsUpdate(before, after)).toBe(true);
  });
});

describe('staleDateFor', () => {
  /**
   * The case this exists for: the phone is locked when the phase ends. `tick()`
   * only runs on the foreground Timer screen, so `complete()` does not fire and
   * nothing ends the card — it would sit at 00:00 insisting a finished session is
   * still running. The stale date is the only lever iOS gives us with no app.
   */
  it('marks a running countdown stale the moment its phase ends', () => {
    const props = toActivityProps(running, T0)!;
    expect(staleDateFor(props).getTime()).toBe(props.rangeEndMs);
    expect(staleDateFor(props).getTime()).toBe(T0 + 1500 * 1000);
  });

  it('does not stale a paused card, which stays correct however long it sits', () => {
    const props = toActivityProps(
      { ...running, status: 'paused', startedAt: null, elapsedAtPause: 300 },
      T0,
    )!;
    expect(staleDateFor(props).getTime()).toBeGreaterThan(props.rangeEndMs);
  });

  it('falls back to the ActivityKit ceiling for the endless stopwatch', () => {
    const props = toActivityProps({ ...running, mode: 'stopwatch' }, T0)!;
    expect(staleDateFor(props).getTime()).toBe(T0 + STALE_AFTER_SECONDS * 1000);
    expect(STALE_AFTER_SECONDS).toBeLessThan(8 * 60 * 60);
  });
});
