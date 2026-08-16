import { describe, it, expect } from 'vitest';
import {
  MAX_SESSION_SECONDS,
  isCompletionTimeAcceptable,
  creditedSeconds,
} from './sessionCredit';

/**
 * /timer/complete takes the client's word for how long a session ran. Without
 * these bounds a single crafted request could award unlimited XP and top every
 * leaderboard, or fabricate a streak by backdating sessions.
 */
describe('creditedSeconds', () => {
  it('rejects the unbounded-XP exploit by clamping to the max', () => {
    expect(creditedSeconds(999_999_999, null)).toBe(MAX_SESSION_SECONDS);
  });

  it('clamps an over-reported session to its planned duration', () => {
    // Client claims 50 minutes on a 25-minute pomodoro.
    expect(creditedSeconds(3000, 1500)).toBe(1500);
  });

  it('leaves an honest session untouched', () => {
    expect(creditedSeconds(1450, 1500)).toBe(1450);
  });

  it('allows a long stopwatch session with no plan', () => {
    expect(creditedSeconds(3 * 3600, null)).toBe(3 * 3600);
  });

  it('treats a zero plan as no plan rather than crediting nothing', () => {
    expect(creditedSeconds(1200, 0)).toBe(1200);
  });

  it('never credits negative time', () => {
    expect(creditedSeconds(-60, null)).toBe(0);
  });
});

describe('isCompletionTimeAcceptable', () => {
  const now = Date.UTC(2026, 7, 3, 12, 0, 0);

  it('accepts now', () => {
    expect(isCompletionTimeAcceptable(now, now)).toBe(true);
  });

  it('accepts a session finished hours ago (offline retry)', () => {
    expect(isCompletionTimeAcceptable(now - 2 * 3600_000, now)).toBe(true);
  });

  it('tolerates a slightly fast device clock', () => {
    expect(isCompletionTimeAcceptable(now + 60_000, now)).toBe(true);
  });

  it('rejects a backdated session used to fabricate a streak', () => {
    expect(isCompletionTimeAcceptable(now - 30 * 86_400_000, now)).toBe(false);
  });

  it('rejects a far-future timestamp', () => {
    expect(isCompletionTimeAcceptable(now + 365 * 86_400_000, now)).toBe(false);
  });
});
