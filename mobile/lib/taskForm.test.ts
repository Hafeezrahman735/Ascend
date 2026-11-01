import { describe, it, expect } from 'vitest';
import type { Task } from '../types';
import { buildSaveData, formDate, initialFields } from './taskForm';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Write case study', description: 'Draft', dueDate: '2026-11-02T00:00:00.000Z',
    tags: ['client'], estimatedMinutes: 60, startMinutes: null, endMinutes: null,
    priority: 'medium', taskGoalId: null, isRecurring: false, recurringDays: [],
    isOccurrence: false, occurrenceDate: null, repeatsUntil: null,
    ...over,
  } as Task;
}

describe('formDate', () => {
  it('trims a full ISO due date to the day', () => {
    expect(formDate(task())).toBe('2026-11-02');
  });

  it('uses repeatsUntil on a recurring day row, never the row’s own day', () => {
    expect(formDate(task({ isOccurrence: true, dueDate: '2026-10-31', repeatsUntil: '2026-12-31' }))).toBe('2026-12-31');
  });

  it('is null for a new task or an undated one', () => {
    expect(formDate(null)).toBeNull();
    expect(formDate(task({ dueDate: null }))).toBeNull();
  });
});

describe('buildSaveData', () => {
  it('sends every field on create, dropping empty optionals', () => {
    const fields = { ...initialFields(null), title: '  Plan Q1  ', tags: ['work'] };
    expect(buildSaveData(null, fields)).toEqual({
      title: 'Plan Q1', description: undefined, dueDate: undefined, tags: ['work'],
      estimatedMinutes: undefined, startMinutes: null, endMinutes: null, priority: 'medium',
      taskGoalId: null, isRecurring: false, recurringDays: [],
    });
  });

  it('an edit with nothing changed sends only the title and the recurring pair', () => {
    const t = task();
    expect(buildSaveData(t, initialFields(t))).toEqual({
      title: 'Write case study', isRecurring: false, recurringDays: [],
    });
  });

  it('sends a changed due date, and null when the date is cleared', () => {
    const t = task();
    expect(buildSaveData(t, { ...initialFields(t), dueDate: '2026-11-05' }).dueDate).toBe('2026-11-05');
    expect(buildSaveData(t, { ...initialFields(t), dueDate: '' }).dueDate).toBeNull();
  });

  it('does not resend an unchanged recurring end date from a day row', () => {
    const row = task({ isRecurring: true, isOccurrence: true, dueDate: '2026-10-31', repeatsUntil: '2026-12-31' });
    expect(buildSaveData(row, initialFields(row))).not.toHaveProperty('dueDate');
  });

  it('sends a new time block and a cleared estimate', () => {
    const t = task();
    const out = buildSaveData(t, { ...initialFields(t), startMinutes: 660, endMinutes: 720, estimatedMinutes: 0 });
    expect(out).toMatchObject({ startMinutes: 660, endMinutes: 720, estimatedMinutes: null });
  });

  it('treats reordered tags as unchanged', () => {
    const t = task({ tags: ['a', 'b'] });
    expect(buildSaveData(t, { ...initialFields(t), tags: ['b', 'a'] })).not.toHaveProperty('tags');
  });
});

describe('initialFields with a prefill', () => {
  const slot = { dueDate: '2026-10-30', startMinutes: 660, endMinutes: 720 };

  it('fills an undated task’s day and time', () => {
    const f = initialFields(task({ dueDate: null }), slot);
    expect(f).toMatchObject({ dueDate: '2026-10-30', startMinutes: 660, endMinutes: 720 });
  });

  it('never overwrites a day or time the task already has', () => {
    const f = initialFields(task({ startMinutes: 540, endMinutes: 600 }), slot);
    expect(f).toMatchObject({ dueDate: '2026-11-02', startMinutes: 540, endMinutes: 600 });
  });

  it('keeps the time block whole: no time without both ends', () => {
    const f = initialFields(task({ dueDate: null }), { dueDate: '2026-10-30', startMinutes: 660 });
    expect(f).toMatchObject({ dueDate: '2026-10-30', startMinutes: null, endMinutes: null });
  });

  it('a prefilled edit sends the new day and block', () => {
    const t = task({ dueDate: null });
    expect(buildSaveData(t, initialFields(t, slot))).toMatchObject({
      dueDate: '2026-10-30', startMinutes: 660, endMinutes: 720,
    });
  });
});
