import { describe, it, expect } from 'vitest';
import { weekTasksToWorkOn, estimatedMinutesRemaining } from './planningTasks';
import type { CalendarItem, Task } from '../types';

const TODAY = '2026-09-03';
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'];

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


/** A spawned recurring instance: a real row, so it carries the full Task shape. */
function habit(date: string, templateId: string, over: Partial<Task> = {}): CalendarItem {
  return {
    type: 'habit_instance',
    date,
    data: task({ id: `${templateId}-${date}`, parentTaskId: templateId, isRecurring: true, ...over }),
  };
}

/**
 * A PROJECTED recurring day, exactly as the server sends it.
 *
 * Deliberately NOT built through task(): the real placeholder carries only
 * id/title/parentTaskId/dueDate/isCompleted/isProjected (backend
 * calendar/routes.ts). Using the full fixture here would hide the very bug
 * these tests exist to pin — missing priority and isRecurring.
 */
function projected(date: string, templateId: string, title = 'Daily reading'): CalendarItem {
  return {
    type: 'habit_instance',
    date,
    data: {
      id: `projected:${templateId}:${date}`,
      title,
      parentTaskId: templateId,
      dueDate: `${date}T00:00:00.000Z`,
      isCompleted: false,
      isProjected: true,
    } as unknown as Task,
  };
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

describe('weekTasksToWorkOn — recurring tasks collapse to one row', () => {
  /**
   * The regression these pin: the calendar projects a template across every
   * scheduled day in the range, so a daily habit arrived as seven separate
   * items and rendered seven rows, three of them labelled "Late". A missed
   * recurrence is not a debt — you cannot do yesterday's reading today.
   */
  it('shows ONE row for a habit scheduled every day of the week', () => {
    const week = ['2026-08-31', '2026-09-01', '2026-09-02', TODAY,
                  '2026-09-04', '2026-09-05', '2026-09-06']
      .map((d) => projected(d, 'tpl-reading'));

    const out = weekTasksToWorkOn(week, TODAY);

    expect(out).toHaveLength(1);
    expect(out[0].dateKey).toBe(TODAY);
  });

  it('never labels a recurring task Late', () => {
    const out = weekTasksToWorkOn([
      projected('2026-09-01', 'tpl-reading'),
      projected('2026-09-02', 'tpl-reading'),
      projected(TODAY, 'tpl-reading'),
    ], TODAY);

    expect(out.every((t) => !t.isOverdue)).toBe(true);
  });

  it('falls through to the next occurrence when today is not scheduled', () => {
    const out = weekTasksToWorkOn([
      projected('2026-09-01', 'tpl-gym'),
      projected('2026-09-05', 'tpl-gym'),
    ], TODAY);

    expect(out).toHaveLength(1);
    expect(out[0].dateKey).toBe('2026-09-05');
    expect(out[0].isToday).toBe(false);
  });

  it('drops a habit entirely when every occurrence this week has passed', () => {
    const out = weekTasksToWorkOn([
      projected('2026-08-31', 'tpl-gym'),
      projected('2026-09-01', 'tpl-gym'),
    ], TODAY);

    expect(out).toEqual([]);
  });

  it('keeps separate habits separate', () => {
    const out = weekTasksToWorkOn([
      projected(TODAY, 'tpl-reading', 'Reading'),
      projected(TODAY, 'tpl-gym', 'Gym'),
    ], TODAY);

    expect(out.map((t) => t.title).sort()).toEqual(['Gym', 'Reading']);
  });

  it('prefers today over a later day for the same habit', () => {
    const out = weekTasksToWorkOn([
      projected('2026-09-05', 'tpl-reading'),
      projected(TODAY, 'tpl-reading'),
    ], TODAY);

    expect(out).toHaveLength(1);
    expect(out[0].dateKey).toBe(TODAY);
  });

  it('shows the next day when today is already done', () => {
    // Ordering is load-bearing: the done-filter runs BEFORE the collapse, so a
    // completed today falls through to tomorrow rather than hiding the habit.
    const out = weekTasksToWorkOn([
      habit(TODAY, 'tpl-reading', { isCompleted: true }),
      projected('2026-09-04', 'tpl-reading'),
    ], TODAY);

    expect(out).toHaveLength(1);
    expect(out[0].dateKey).toBe('2026-09-04');
  });

  it('does NOT collapse one-off tasks that share nothing', () => {
    const out = weekTasksToWorkOn([
      item(TODAY, { title: 'A' }),
      item(TODAY, { title: 'B' }),
    ], TODAY);

    expect(out).toHaveLength(2);
  });
});

describe('weekTasksToWorkOn — one-off tasks keep the opposite rule', () => {
  it('still marks an overdue one-off task Late', () => {
    // The whole point of treating the two kinds differently: a one-off task
    // from Monday is still owed on Thursday. Only recurrences are forgiven.
    const out = weekTasksToWorkOn([item('2026-09-01', { title: 'Stats reading' })], TODAY);

    expect(out).toHaveLength(1);
    expect(out[0].isOverdue).toBe(true);
  });

  it('keeps an overdue one-off alongside a collapsed habit', () => {
    const out = weekTasksToWorkOn([
      item('2026-09-01', { title: 'Stats reading' }),
      projected('2026-09-01', 'tpl-reading'),
      projected(TODAY, 'tpl-reading'),
    ], TODAY);

    expect(out).toHaveLength(2);
    expect(out.find((t) => t.title === 'Stats reading')!.isOverdue).toBe(true);
    expect(out.find((t) => t.title === 'Daily reading')!.isOverdue).toBe(false);
  });
});

describe('weekTasksToWorkOn — projected days are well-formed rows', () => {
  /**
   * The server's projected placeholder omits priority and isRecurring. Reading
   * them straight off item.data (an `as Task` assertion, invisible to tsc) gave
   * the row no repeat icon and made the comparator return NaN. Collapsing turns
   * that from one row in seven into THE row for any habit not yet spawned.
   */
  it('reports a projected occurrence as recurring, so the repeat icon renders', () => {
    const out = weekTasksToWorkOn([projected(TODAY, 'tpl-reading')], TODAY);
    expect(out[0].isRecurring).toBe(true);
  });

  it('gives a projected occurrence a defined priority, so the sort cannot go NaN', () => {
    const out = weekTasksToWorkOn([projected(TODAY, 'tpl-reading')], TODAY);
    expect(out[0].priority).toBeDefined();
    expect(PRIORITY_VALUES).toContain(out[0].priority);
  });

  it('sorts a projected row against a real one without NaN', () => {
    const out = weekTasksToWorkOn([
      projected(TODAY, 'tpl-reading', 'Zzz habit'),
      item(TODAY, { title: 'Aaa task', priority: 'urgent' }),
    ], TODAY);

    // With a NaN comparator the order is undefined; urgent must lead.
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Aaa task');
  });
});
