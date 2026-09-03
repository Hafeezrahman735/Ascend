import { describe, it, expect } from 'vitest';
import { weekTasksToWorkOn, estimatedMinutesRemaining } from './planningTasks';
import type { CalendarItem, Task } from '../types';

const TODAY = '2026-09-03';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'A task', tags: [], priority: 'medium',
    isArchived: false, isCompleted: false, createdAt: '2026-09-01',
    sessionsOnTask: 0, totalTimeOnTask: 0, sessionDates: [],
    isRecurring: false, recurringDays: [], lastSpawnedDate: null, parentTaskId: null,
    ...over,
  } as unknown as Task;
}

function item(date: string, over: Partial<Task> = {}, type: 'task' | 'habit_instance' = 'task'): CalendarItem {
  return { type, date, data: task({ id: `${date}-${over.title ?? 'x'}`, ...over }) };
}

describe('weekTasksToWorkOn', () => {
  it('returns nothing for an empty week', () => {
    expect(weekTasksToWorkOn([], TODAY)).toEqual([]);
  });

  it('includes tasks due across the week', () => {
    const out = weekTasksToWorkOn([
      item('2026-09-03', { title: 'Today thing' }),
      item('2026-09-05', { title: 'Friday thing' }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Today thing', 'Friday thing']);
  });

  it('includes recurring tasks — habit_instance is a task, not a separate feature', () => {
    const out = weekTasksToWorkOn([
      item('2026-09-03', { title: 'Daily reading', isRecurring: true }, 'habit_instance'),
    ], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].isRecurring).toBe(true);
  });

  it('drops completed tasks — the header count is the size of the remaining pile', () => {
    const out = weekTasksToWorkOn([
      item('2026-09-03', { title: 'Done', isCompleted: true }),
      item('2026-09-03', { title: 'Not done' }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Not done']);
  });

  it('ignores events, notes and goal deadlines', () => {
    // A deadline is a date you work toward, not a thing you sit down and do.
    const items: CalendarItem[] = [
      { type: 'event', date: TODAY, data: { id: 'e1', title: 'Lab meeting' } },
      { type: 'note', date: TODAY, data: { id: 'n1', content: 'Remember' } },
      { type: 'goal_deadline', date: TODAY, data: { id: 'g1', title: 'Thesis' } },
      item(TODAY, { title: 'Real task' }),
    ];
    expect(weekTasksToWorkOn(items, TODAY).map((t) => t.title)).toEqual(['Real task']);
  });

  it('flags a task due earlier in the week as overdue', () => {
    const out = weekTasksToWorkOn([item('2026-09-01', { title: 'Late' })], TODAY);
    expect(out[0].isOverdue).toBe(true);
    expect(out[0].isToday).toBe(false);
  });

  it('does not flag today or later as overdue', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'Today' }),
      item('2026-09-06', { title: 'Later' }),
    ], TODAY);
    expect(out.map((t) => t.isOverdue)).toEqual([false, false]);
    expect(out[0].isToday).toBe(true);
  });

  it('orders overdue first, then by day', () => {
    const out = weekTasksToWorkOn([
      item('2026-09-06', { title: 'Sunday' }),
      item('2026-09-01', { title: 'Overdue' }),
      item(TODAY, { title: 'Today' }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Overdue', 'Today', 'Sunday']);
  });

  it('puts timed tasks before untimed ones on the same day', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'Whenever' }),
      item(TODAY, { title: 'At nine', startMinutes: 540, endMinutes: 600 }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['At nine', 'Whenever']);
  });

  it('orders timed tasks by their start time', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'Afternoon', startMinutes: 840, endMinutes: 900 }),
      item(TODAY, { title: 'Morning', startMinutes: 540, endMinutes: 600 }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Morning', 'Afternoon']);
  });

  it('breaks a same-day untimed tie by priority', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'Low one', priority: 'low' }),
      item(TODAY, { title: 'Urgent one', priority: 'urgent' }),
      item(TODAY, { title: 'Medium one', priority: 'medium' }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Urgent one', 'Medium one', 'Low one']);
  });

  it('falls back to title so the order is stable rather than arbitrary', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'Beta', priority: 'high' }),
      item(TODAY, { title: 'Alpha', priority: 'high' }),
    ], TODAY);
    expect(out.map((t) => t.title)).toEqual(['Alpha', 'Beta']);
  });

  it('gives every row a distinct key', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'One' }),
      item('2026-09-04', { title: 'Two' }),
    ], TODAY);
    expect(new Set(out.map((t) => t.key)).size).toBe(2);
  });
});

describe('estimatedMinutesRemaining', () => {
  it('is 0 with no tasks', () => {
    expect(estimatedMinutesRemaining([])).toBe(0);
  });

  it('sums the estimates it has', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'A', estimatedMinutes: 50 }),
      item('2026-09-04', { title: 'B', estimatedMinutes: 25 }),
    ], TODAY);
    expect(estimatedMinutesRemaining(out)).toBe(75);
  });

  it('treats a task with no estimate as 0 rather than skipping the rest', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'A', estimatedMinutes: 50 }),
      item(TODAY, { title: 'B' }),
    ], TODAY);
    expect(estimatedMinutesRemaining(out)).toBe(50);
  });
});
