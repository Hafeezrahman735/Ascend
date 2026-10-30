import { describe, expect, it } from 'vitest';
import { focusButtonState, type FocusButtonInput } from './startFocusTarget';

const task = (id: string, isCompleted = false) => ({ id, title: `Task ${id}`, isCompleted });

const base: FocusButtonInput = {
  topOpenTasks: [task('a'), task('b')],
  hasAnyTasks: true,
  hasLoaded: true,
  loadFailed: false,
  status: 'idle',
  phase: 'focus',
  sessionTaskTitle: null,
};

describe('focusButtonState', () => {
  it('targets the first open task', () => {
    expect(focusButtonState(base)).toEqual({ kind: 'target', taskId: 'a', title: 'Task a' });
  });

  it('skips a ticked-off row, such as a recurring task already done today', () => {
    expect(focusButtonState({ ...base, topOpenTasks: [task('a', true), task('b')] }))
      .toEqual({ kind: 'target', taskId: 'b', title: 'Task b' });
  });

  it('opens the timer empty when tasks exist but none is open', () => {
    expect(focusButtonState({ ...base, topOpenTasks: [] })).toEqual({ kind: 'openTimer' });
  });

  it('offers to add the first task when the user has none', () => {
    expect(focusButtonState({ ...base, topOpenTasks: [], hasAnyTasks: false })).toEqual({ kind: 'addFirstTask' });
  });

  it('shows loading, not the first-run prompt, before tasks have loaded', () => {
    expect(focusButtonState({ ...base, topOpenTasks: [], hasAnyTasks: false, hasLoaded: false }))
      .toEqual({ kind: 'loading' });
  });

  it('never shows the first-run prompt when the first load failed', () => {
    expect(focusButtonState({ ...base, topOpenTasks: [], hasAnyTasks: false, hasLoaded: false, loadFailed: true }))
      .toEqual({ kind: 'openTimer' });
  });

  it('points back to a running or paused focus session instead of a new target', () => {
    expect(focusButtonState({ ...base, status: 'running', sessionTaskTitle: 'Task b' }))
      .toEqual({ kind: 'session', status: 'running', taskTitle: 'Task b' });
    expect(focusButtonState({ ...base, status: 'paused', sessionTaskTitle: null }))
      .toEqual({ kind: 'session', status: 'paused', taskTitle: null });
  });

  it('shows a break, not a focus session, while a break runs or is paused', () => {
    expect(focusButtonState({ ...base, status: 'running', phase: 'shortBreak' }))
      .toEqual({ kind: 'break', status: 'running' });
    expect(focusButtonState({ ...base, status: 'paused', phase: 'longBreak' }))
      .toEqual({ kind: 'break', status: 'paused' });
  });

  it('treats a break that is ready but not started as idle', () => {
    expect(focusButtonState({ ...base, status: 'break', phase: 'shortBreak' }))
      .toEqual({ kind: 'target', taskId: 'a', title: 'Task a' });
  });
});
