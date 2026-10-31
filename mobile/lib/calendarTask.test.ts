import { describe, it, expect } from 'vitest';
import type { CalendarItem, Task } from '../types';
import { taskForCalendarItem, completionToggleFor } from './calendarTask';

const DAY = '2026-10-31';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'case-study', title: 'Write case study', tags: ['client'], isCompleted: false,
    isRecurring: false, isOccurrence: false, occurrenceDate: null,
    ...over,
  } as Task;
}

describe('taskForCalendarItem', () => {
  it('finds a one-off task in the task list', () => {
    const t = task();
    const item: CalendarItem = { type: 'task', date: DAY, data: { id: t.id, title: t.title } };
    expect(taskForCalendarItem(item, [t], [])).toBe(t);
  });

  it('builds a recurring day from its template, with the day’s done state and date', () => {
    const template = task({ id: 'inbox', title: 'Inbox zero', isRecurring: true, isCompleted: false });
    const item: CalendarItem = { type: 'habit_instance', date: DAY, data: { id: 'inbox', isCompleted: true } };
    const found = taskForCalendarItem(item, [], [template]);
    expect(found).toMatchObject({
      id: 'inbox', tags: ['client'], isCompleted: true, isOccurrence: true, occurrenceDate: DAY,
    });
  });

  it('opens nothing for a task the store does not have, or for other item types', () => {
    expect(taskForCalendarItem({ type: 'task', date: DAY, data: { id: 'gone' } }, [task()], [])).toBeNull();
    expect(taskForCalendarItem({ type: 'event', date: DAY, data: { id: 'case-study' } }, [task()], [])).toBeNull();
  });
});

describe('completionToggleFor', () => {
  it('flips a one-off task, and ticks or un-ticks the shown day of a recurring one', () => {
    expect(completionToggleFor(task())).toEqual({ kind: 'task', id: 'case-study' });
    expect(completionToggleFor(task({ isRecurring: true, isOccurrence: true, occurrenceDate: DAY, isCompleted: true })))
      .toEqual({ kind: 'occurrence', id: 'case-study', date: DAY, done: false });
  });
});
