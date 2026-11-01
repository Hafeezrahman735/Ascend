import { describe, it, expect } from 'vitest';
import type { CalendarItem, Task } from '../types';
import { bookedMinutes, groupItemsByDate } from './calendarItems';
import { weekTasksToWorkOn } from './planningTasks';
import {
  alsoToday, findSlot, nextUp, weekBreakdown, weekPosition, weekRows, DEFAULT_SLOT_MINUTES,
} from './planScreen';

const TODAY = '2026-10-29';
const WEEK = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't', title: 'Task', tags: [], priority: 'medium', isArchived: false, isCompleted: false,
    createdAt: '2026-10-01', sessionsOnTask: 0, totalTimeOnTask: 0, sessionDates: [],
    isRecurring: false, recurringDays: [], isOccurrence: false, startMinutes: null, endMinutes: null,
    ...over,
  } as unknown as Task;
}

function timedTask(date: string, id: string, start: number | null, end: number | null, over: Partial<Task> = {}): CalendarItem {
  return { type: 'task', date, data: task({ id, title: id, startMinutes: start, endMinutes: end, ...over }) };
}

function habitDay(date: string, id: string, start: number, end: number): CalendarItem {
  return {
    type: 'habit_instance', date,
    data: task({ id, title: id, isRecurring: true, isOccurrence: true, occurrenceDate: date, startMinutes: start, endMinutes: end }),
  };
}

function event(date: string, id: string, start: number | null, end: number | null): CalendarItem {
  return { type: 'event', date, data: { id, title: id, date, startMinutes: start, endMinutes: end } } as CalendarItem;
}

function google(date: string, id: string, startTime: string, endTime: string): CalendarItem {
  return { type: 'external_google', date, data: { id, title: id, isAllDay: false, startTime, endTime } } as CalendarItem;
}

function note(date: string, id: string): CalendarItem {
  return { type: 'note', date, data: { id, content: id, date, isTodo: true, isCompleted: false } } as CalendarItem;
}

describe('weekBreakdown', () => {
  it('splits booked minutes by kind, and the parts sum to bookedMinutes', () => {
    const items = [
      timedTask(TODAY, 'a', 540, 660),
      habitDay(TODAY, 'gym', 480, 525),
      event(TODAY, 'call', 780, 840),
      google(TODAY, 'sync', new Date(2026, 9, 29, 15, 0).toISOString(), new Date(2026, 9, 29, 15, 30).toISOString()),
    ];
    const b = weekBreakdown(items);
    expect(b).toEqual({ total: 120 + 45 + 60 + 30, tasks: 120, recurring: 45, events: 90 });
    expect(b.tasks + b.recurring + b.events).toBe(bookedMinutes(items));
  });

  it('counts nothing for untimed tasks, all-day events and notes', () => {
    expect(weekBreakdown([timedTask(TODAY, 'u', null, null), event(TODAY, 'e', null, null), note(TODAY, 'n')]).total).toBe(0);
  });
});

describe('nextUp', () => {
  const fallback = task({ id: 'urgent', title: 'Urgent untimed' });

  it('picks the first open timed task that has not ended, by start', () => {
    const items = [timedTask(TODAY, 'late', 840, 900), timedTask(TODAY, 'early', 600, 660), timedTask(TODAY, 'over', 480, 540)];
    const n = nextUp(items, 590, fallback);
    expect(n).toMatchObject({ kind: 'timed', taskId: 'early' });
  });

  it('includes a recurring day, and skips done items and events', () => {
    const items = [
      event(TODAY, 'call', 600, 630),
      timedTask(TODAY, 'done', 600, 660, { isCompleted: true }),
      habitDay(TODAY, 'gym', 700, 745),
    ];
    expect(nextUp(items, 590, fallback)).toMatchObject({ kind: 'timed', taskId: 'gym' });
  });

  it('falls back to Today’s pick when nothing timed is left, and is null with nothing at all', () => {
    const items = [timedTask(TODAY, 'over', 480, 540)];
    expect(nextUp(items, 600, fallback)).toEqual({ kind: 'fallback', task: fallback });
    expect(nextUp(items, 600, null)).toBeNull();
  });
});

describe('alsoToday', () => {
  const items = [
    timedTask('2026-10-27', 'invoice', null, null),
    timedTask(TODAY, 'prep', 840, 900),
    timedTask(TODAY, 'reply', null, null),
    timedTask('2026-10-30', 'friday', null, null),
  ];
  const week = weekTasksToWorkOn(items, TODAY);

  it('lists late one-off tasks first, then today’s others, never the Next up task', () => {
    const next = nextUp(items.filter((i) => i.date === TODAY), 600, null);
    expect(alsoToday(week, next).map((t) => t.task.id)).toEqual(['invoice', 'reply']);
  });

  it('drops the fallback task when that is Next up', () => {
    const reply = (items[2].data as Task);
    expect(alsoToday(week, { kind: 'fallback', task: reply }).map((t) => t.task.id)).toEqual(['invoice', 'prep']);
  });
});

describe('weekPosition and weekRows', () => {
  it('knows past, current and future weeks', () => {
    expect(weekPosition(WEEK, TODAY)).toBe('current');
    expect(weekPosition(WEEK, '2026-11-05')).toBe('past');
    expect(weekPosition(WEEK, '2026-10-20')).toBe('future');
  });

  it('this week lists the days after today, scaled to the busiest of them', () => {
    const byDate = groupItemsByDate([
      timedTask('2026-10-30', 'f', 600, 840),
      timedTask('2026-10-31', 's', 600, 660),
      note('2026-11-01', 'n'),
      timedTask(TODAY, 't', 0, 600),
    ]);
    const rows = weekRows(WEEK, byDate, TODAY);
    expect(rows.map((r) => r.key)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(rows.map((r) => r.barFraction)).toEqual([1, 0.25, 0]);
    // A notes-only day has no load but still has items to expand.
    expect(rows[2]).toMatchObject({ booked: 0, loadCount: 0 });
    expect(rows[2].items).toHaveLength(1);
  });

  it('another week lists all seven days, and an empty week draws empty bars', () => {
    const rows = weekRows(WEEK, new Map(), '2026-11-10');
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.barFraction === 0)).toBe(true);
  });
});

describe('findSlot', () => {
  it('finds the first gap between two bookings that fits the estimate', () => {
    const byDate = groupItemsByDate([timedTask('2026-10-30', 'a', 540, 600), event('2026-10-30', 'b', 720, 780)]);
    expect(findSlot(WEEK, byDate, 60, TODAY, 0)).toEqual({ date: '2026-10-30', startMinutes: 600, endMinutes: 660 });
  });

  it('offers nothing on a day with fewer than two bookings', () => {
    const byDate = groupItemsByDate([timedTask('2026-10-30', 'a', 540, 600)]);
    expect(findSlot(WEEK, byDate, 30, TODAY, 0)).toBeNull();
  });

  it('merges overlapping bookings before looking for gaps', () => {
    const byDate = groupItemsByDate([
      timedTask('2026-10-30', 'a', 540, 660),
      event('2026-10-30', 'b', 600, 720),
      event('2026-10-30', 'c', 750, 800),
    ]);
    expect(findSlot(WEEK, byDate, 30, TODAY, 0)).toEqual({ date: '2026-10-30', startMinutes: 720, endMinutes: 750 });
  });

  it('today only offers time after now, rounded up to the quarter hour', () => {
    const byDate = groupItemsByDate([timedTask(TODAY, 'a', 540, 600), timedTask(TODAY, 'b', 720, 780)]);
    expect(findSlot(WEEK, byDate, 30, TODAY, 607)).toEqual({ date: TODAY, startMinutes: 615, endMinutes: 645 });
    expect(findSlot(WEEK, byDate, 30, TODAY, 700)).toBeNull();
  });

  it('skips days before today, uses 30 minutes without an estimate, and counts external events', () => {
    const byDate = groupItemsByDate([
      timedTask('2026-10-27', 'old1', 540, 600), timedTask('2026-10-27', 'old2', 720, 780),
      google('2026-10-31', 'g1', new Date(2026, 9, 31, 9, 0).toISOString(), new Date(2026, 9, 31, 10, 0).toISOString()),
      timedTask('2026-10-31', 'x', 640, 700),
    ]);
    expect(findSlot(WEEK, byDate, null, TODAY, 0)).toEqual({
      date: '2026-10-31', startMinutes: 600, endMinutes: 600 + DEFAULT_SLOT_MINUTES,
    });
  });
});
