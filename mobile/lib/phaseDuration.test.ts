import { describe, it, expect } from 'vitest';
import {
  getPhaseDuration,
  elapsedInPhase,
  remainingInPhase,
  type PhaseDurationSettings,
} from './phaseDuration';

const settings: PhaseDurationSettings = {
  workDuration: 1500,      // 25:00
  shortBreakDuration: 300, // 5:00
  longBreakDuration: 900,  // 15:00
};

describe('getPhaseDuration', () => {
  it('uses the configured work duration when there is no plan', () => {
    expect(getPhaseDuration('focus', settings)).toBe(1500);
    expect(getPhaseDuration('focus', settings, null)).toBe(1500);
  });

  it('lets a per-task plan override the focus length', () => {
    expect(getPhaseDuration('focus', settings, 1200)).toBe(1200);
  });

  it('never lets a plan change a break — break length is a user setting', () => {
    expect(getPhaseDuration('shortBreak', settings, 1200)).toBe(300);
    expect(getPhaseDuration('longBreak', settings, 1200)).toBe(900);
  });
});

describe('elapsedInPhase', () => {
  it('counts only banked time when no segment is running', () => {
    expect(elapsedInPhase(120, null, 1_000_000)).toBe(120);
  });

  it('adds the running segment to the banked time', () => {
    expect(elapsedInPhase(120, 1_000_000, 1_030_000)).toBe(150);
  });

  it('floors partial seconds so the countdown never reads ahead of itself', () => {
    expect(elapsedInPhase(0, 1_000_000, 1_000_999)).toBe(0);
  });
});

describe('remainingInPhase', () => {
  const plannedBlock = {
    phase: 'focus' as const,
    settings,
    plannedFocusSeconds: 1200, // a 20-minute planned block
    elapsedAtPause: 0,
    startedAt: 1_000_000,
  };

  /**
   * The regression this whole change exists for. pause(), tick(), the hero ring
   * and live analytics all measured a planned block against workDuration, so a
   * 20-minute block started at 20:00 and jumped to 24:59 one second later.
   */
  it('does not jump above the planned length on the first tick', () => {
    const atStart = remainingInPhase({ ...plannedBlock, startedAt: null }, 1_000_000);
    const oneSecondLater = remainingInPhase(plannedBlock, 1_001_000);

    expect(atStart).toBe(1200);
    expect(oneSecondLater).toBe(1199);
    expect(oneSecondLater).toBeLessThan(atStart);
  });

  it('measures an unplanned block against the configured work duration', () => {
    expect(
      remainingInPhase({ ...plannedBlock, plannedFocusSeconds: null }, 1_001_000),
    ).toBe(1499);
  });

  it('survives a pause and resume without gaining time', () => {
    // Ran 300s, paused (banked), then resumed and ran another 60s.
    const resumed = remainingInPhase(
      { ...plannedBlock, elapsedAtPause: 300, startedAt: 2_000_000 },
      2_060_000,
    );
    expect(resumed).toBe(1200 - 360);
  });

  it('clamps at zero once the deadline has passed', () => {
    // App was force-quit and relaunched well after the block should have ended.
    expect(remainingInPhase(plannedBlock, 1_000_000 + 5_000_000)).toBe(0);
  });

  it('ignores the plan for breaks', () => {
    expect(
      remainingInPhase({ ...plannedBlock, phase: 'shortBreak' }, 1_060_000),
    ).toBe(300 - 60);
  });
});
