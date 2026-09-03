import { describe, it, expect } from 'vitest';
import { dailyFocusTargetSeconds, targetProgress } from './dailyTarget';

const MIN = 60;

describe('dailyFocusTargetSeconds', () => {
  it('multiplies the session target by the session length', () => {
    // 8 sessions x 25 minutes = 200 minutes.
    expect(dailyFocusTargetSeconds(8, 25 * MIN)).toBe(200 * MIN);
  });

  it('rounds the session length to whole minutes, as the Tasks screen does', () => {
    // 1490s is 24.83 minutes; both screens must treat it as 25 or they disagree.
    expect(dailyFocusTargetSeconds(4, 1490)).toBe(4 * 25 * MIN);
  });

  it('returns 0 when no target is set', () => {
    expect(dailyFocusTargetSeconds(0, 25 * MIN)).toBe(0);
  });

  it('returns 0 for a nonsensical session length rather than a negative target', () => {
    expect(dailyFocusTargetSeconds(8, 0)).toBe(0);
    expect(dailyFocusTargetSeconds(8, -60)).toBe(0);
  });
});

describe('targetProgress', () => {
  it('reports no target when none is set', () => {
    expect(targetProgress(0, 0)).toEqual({ kind: 'none' });
  });

  it('reports the full target before any work', () => {
    expect(targetProgress(0, 200 * MIN)).toEqual({ kind: 'remaining', seconds: 200 * MIN });
  });

  it('counts down as focus accumulates', () => {
    expect(targetProgress(155 * MIN, 200 * MIN)).toEqual({ kind: 'remaining', seconds: 45 * MIN });
  });

  it('reports reached exactly on the target', () => {
    expect(targetProgress(200 * MIN, 200 * MIN)).toEqual({ kind: 'reached' });
  });

  it('never reports a negative remainder once the target is passed', () => {
    // The case that only shows up on a good day, which is why it is easy to miss.
    expect(targetProgress(260 * MIN, 200 * MIN)).toEqual({ kind: 'reached' });
  });
});
