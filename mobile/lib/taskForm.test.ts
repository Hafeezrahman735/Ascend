import { describe, it, expect } from 'vitest';
import type { Task } from '../types';
import {
  addWorkBlock, buildSaveData, followDate, formDate, initialFields, nextFreeBlockDay, sameWorkBlocks,
  timedBlockMinutes, workBlockError, workBlocksSummary,
} from './taskForm';

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
      estimatedMinutes: undefined, blocks: [], priority: 'medium',
      taskGoalId: null, isRecurring: false, recurringDays: [],
    });
  });

  it('sends a habit its time and no blocks on create', () => {
    const fields = { ...initialFields(null), title: 'Gym', isRecurring: true, startMinutes: 420, endMinutes: 480 };
    const out = buildSaveData(null, fields);
    expect(out).toMatchObject({ startMinutes: 420, endMinutes: 480, isRecurring: true });
    expect(out).not.toHaveProperty('blocks');
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

  it('sends a changed work-block list whole, and a cleared estimate', () => {
    const t = task({ blocks: [{ date: '2026-11-02', startMinutes: null, endMinutes: null }] });
    const blocks = [...t.blocks!, { date: '2026-11-04', startMinutes: 660, endMinutes: 720 }];
    const out = buildSaveData(t, { ...initialFields(t), blocks, estimatedMinutes: 0 });
    expect(out).toMatchObject({ blocks, estimatedMinutes: null });
    expect(out).not.toHaveProperty('startMinutes');
  });

  it('never resends an unchanged block list: a stale copy would delete blocks', () => {
    const t = task({ blocks: [{ date: '2026-11-02', startMinutes: 540, endMinutes: 660 }] });
    expect(buildSaveData(t, { ...initialFields(t), title: 'Renamed' })).not.toHaveProperty('blocks');
  });

  it("sends a habit's changed time, never blocks", () => {
    const habit = task({ isRecurring: true, startMinutes: 420, endMinutes: 480 });
    const out = buildSaveData(habit, { ...initialFields(habit), startMinutes: 360 });
    expect(out).toMatchObject({ startMinutes: 360 });
    expect(out).not.toHaveProperty('blocks');
  });

  it('sends the blocks when a habit becomes one-off, even if the list looks unchanged', () => {
    const habit = task({ isRecurring: true, startMinutes: 420, endMinutes: 480 });
    const out = buildSaveData(habit, { ...initialFields(habit), isRecurring: false });
    expect(out).toMatchObject({ isRecurring: false, blocks: [] });
  });

  it("ignores an older cache's times on a one-off task", () => {
    expect(initialFields(task({ startMinutes: 540, endMinutes: 600 }))).toMatchObject({ startMinutes: null, endMinutes: null });
  });

  it('treats reordered tags as unchanged', () => {
    const t = task({ tags: ['a', 'b'] });
    expect(buildSaveData(t, { ...initialFields(t), tags: ['b', 'a'] })).not.toHaveProperty('tags');
  });
});

describe('initialFields with a prefill (Find a slot, + Task on a day)', () => {
  const slot = { block: { date: '2026-10-30', startMinutes: 660, endMinutes: 720 } };

  it('adds the slot as a work block and never touches the due date (D1)', () => {
    const f = initialFields(task(), slot);
    expect(f.dueDate).toBe('2026-11-02');
    expect(f.blocks).toEqual([slot.block]);
  });

  it("adds to the task's blocks rather than replacing them, sorted", () => {
    const t = task({ blocks: [{ date: '2026-11-01', startMinutes: null, endMinutes: null }] });
    expect(initialFields(t, slot).blocks.map((b) => b.date)).toEqual(['2026-10-30', '2026-11-01']);
  });

  it('gives a new task from a calendar day an any-time block and no due date (D10)', () => {
    const f = initialFields(null, { block: { date: '2026-10-30', startMinutes: null, endMinutes: null } });
    expect(f).toMatchObject({ dueDate: '', blocks: [{ date: '2026-10-30', startMinutes: null, endMinutes: null }] });
  });

  it('a prefilled edit sends the blocks, not a due date', () => {
    const t = task();
    const out = buildSaveData(t, initialFields(t, slot));
    expect(out).toMatchObject({ blocks: [slot.block] });
    expect(out).not.toHaveProperty('dueDate');
  });

  it('never gives a habit work blocks', () => {
    expect(initialFields(task({ isRecurring: true }), slot).blocks).toEqual([]);
  });
});

describe('work block helpers', () => {
  const any = (date: string) => ({ date, startMinutes: null, endMinutes: null });

  it('adds a block unless one starts at the same time that day', () => {
    expect(addWorkBlock([any('2026-11-02')], any('2026-11-02'))).toHaveLength(1);
    expect(addWorkBlock([any('2026-11-02')], { date: '2026-11-02', startMinutes: 540, endMinutes: 600 })).toHaveLength(2);
  });

  it('compares lists in any order', () => {
    expect(sameWorkBlocks([any('2026-11-02'), any('2026-11-03')], [any('2026-11-03'), any('2026-11-02')])).toBe(true);
    expect(sameWorkBlocks([any('2026-11-02')], [{ date: '2026-11-02', startMinutes: 540, endMinutes: 600 }])).toBe(false);
  });

  it('adds up only timed blocks', () => {
    expect(timedBlockMinutes([any('2026-11-02'), { date: '2026-11-03', startMinutes: 540, endMinutes: 660 }])).toBe(120);
  });

  it('suggests the first day from today with no block', () => {
    expect(nextFreeBlockDay([], '2026-11-02')).toBe('2026-11-02');
    expect(nextFreeBlockDay([any('2026-11-02'), any('2026-11-03')], '2026-11-02')).toBe('2026-11-04');
    expect(nextFreeBlockDay([any('2026-12-31')], '2026-12-31')).toBe('2027-01-01');
  });

  it('points at the first broken block, with the server rules', () => {
    expect(workBlockError([any('2026-11-02')])).toBeNull();
    expect(workBlockError([any('2026-11-02'), { date: '2026-11-03', startMinutes: 600, endMinutes: 540 }]))
      .toEqual({ index: 1, message: 'End time must be after start time' });
    expect(workBlockError([any('2026-11-02'), any('2026-11-02')]))
      .toEqual({ index: 1, message: 'Only one any-time work block per day' });
  });

  it('follows the next block from today, else the latest block, else the due date', () => {
    expect(followDate([any('2026-11-01'), any('2026-11-05')], '2026-11-09', '2026-11-03')).toBe('2026-11-05');
    expect(followDate([any('2026-11-01')], '2026-11-09', '2026-11-03')).toBe('2026-11-01');
    expect(followDate([], '2026-11-09', '2026-11-03')).toBe('2026-11-09');
  });

  it("summarises upcoming blocks for the task sheet, three then '+N more' (D24)", () => {
    const time = (m: number) => `${m / 60}h`;
    const blocks = [
      any('2026-11-01'),
      { date: '2026-11-02', startMinutes: 540, endMinutes: 660 },
      any('2026-11-04'), any('2026-11-05'), any('2026-11-06'),
    ];
    const summary = workBlocksSummary(blocks, '2026-11-02', time);
    expect(summary?.minutes).toBe(120);
    expect(summary?.text).toMatch(/9h–11h, .+ any time, .+ any time \+1 more$/);
    expect(workBlocksSummary([any('2026-11-01')], '2026-11-02', time)).toBeNull();
  });
});
