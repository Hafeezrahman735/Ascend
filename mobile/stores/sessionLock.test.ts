import { describe, expect, it } from 'vitest';
import { canSelectTask, isFocusSessionLocked } from './sessionLock';

describe('isFocusSessionLocked', () => {
  it('locks a running or paused focus phase', () => {
    expect(isFocusSessionLocked('running', 'focus')).toBe(true);
    expect(isFocusSessionLocked('paused', 'focus')).toBe(true);
  });

  it('does not lock a running or paused break, which reports status running/paused', () => {
    expect(isFocusSessionLocked('running', 'shortBreak')).toBe(false);
    expect(isFocusSessionLocked('paused', 'longBreak')).toBe(false);
  });

  it('does not lock when idle or when a break is ready to start', () => {
    expect(isFocusSessionLocked('idle', 'focus')).toBe(false);
    expect(isFocusSessionLocked('break', 'shortBreak')).toBe(false);
  });
});

describe('canSelectTask', () => {
  it('refuses a switch to another task while locked', () => {
    expect(canSelectTask(true, 'a', 'b')).toBe(false);
    expect(canSelectTask(true, 'a', null)).toBe(false);
  });

  it('allows re-selecting the same task while locked', () => {
    expect(canSelectTask(true, 'a', 'a')).toBe(true);
  });

  it('allows any switch when not locked', () => {
    expect(canSelectTask(false, 'a', 'b')).toBe(true);
    expect(canSelectTask(false, null, 'b')).toBe(true);
  });
});
