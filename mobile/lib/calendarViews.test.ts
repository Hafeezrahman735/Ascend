import { describe, it, expect } from 'vitest';
import type { CalendarItem, Task, TaskGoal, TimelineSession } from '../types';
import { groupItemsByDate } from './calendarItems';
import { planVsActual, plannedBlocksFromCalendar } from './planVsActual';
import {
  axisTicks, importantDeadlines, laneSummary, overdueDeadlineItems, taskFocusOnDay, weekAxis,
  LANE_DEFAULT_END, LANE_DEFAULT_START,
} from './calendarViews';

const TODAY = '2026-11-12';
const WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't', title: 'Task', tags: [], priority: 'medium', isArchived: false, isCompleted: false,
    createdAt: '2026-10-01', sessionsOnTask: 0, totalTimeOnTask: 0, sessionDates: [],
    isRecurring: false, recurringDays: [], isOccurrence: false, startMinutes: null, endMinutes: null,
    ...over,
  } as unknown as Task;
}

function taskItem(date: string, id: string, over: Partial<Task> = {}): CalendarItem {
  return { type: 'task', date, data: task({ id, title: id, ...over }) };
}

function habitItem(date: string, id: string, over: Partial<Task> = {}): CalendarItem {
  return { type: 'habit_instance', date, data: task({ id, title: id, isRecurring: true, isOccurrence: true, ...over }) };
}

function goal(over: Partial<TaskGoal> = {}): TaskGoal {
  return { id: 'g', title: 'Goal', deadline: null, isCompleted: false, isArchived: false, ...over } as unknown as TaskGoal;
}

function goalItem(date: string, id: string, over: Partial<TaskGoal> = {}): CalendarItem {
  return { type: 'goal_deadline', date, data: goal({ id, title: id, deadline: date, ...over }) };
}

function eventItem(date: string, id: string, start: number | null, end: number | null): CalendarItem {
  return { type: 'event', date, data: { id, title: id, date, startMinutes: start, endMinutes: end } } as CalendarItem;
}

function google(date: string, id: string, startTime: string, endTime: string): CalendarItem {
  return { type: 'external_google', date, data: { id, title: id, isAllDay: false, startTime, endTime } } as CalendarItem;
}

function noteItem(date: string, id: string): CalendarItem {
  return { type: 'note', date, data: { id, content: id, date, isTodo: true, isCompleted: false } } as CalendarItem;
}

function session(over: Partial<TimelineSession> = {}): TimelineSession {
  return {
    id: 's1', clientSessionId: null, durationSeconds: 25 * 60, localDate: TODAY, taskId: 'a', taskTitle: 'a',
    goalId: null, startLocalMinutes: 600, endLocalMinutes: 625, ...over,
  };
}

describe('weekAxis', () => {
  it('is 8:00-22:00 for a week with nothing timed', () => {
    const byDate = groupItemsByDate([taskItem(TODAY, 'untimed'), noteItem(TODAY, 'n')]);
    expect(weekAxis(WEEK, byDate)).toEqual({ start: LANE_DEFAULT_START, end: LANE_DEFAULT_END });
  });

  it('widens to the whole week, rounded out to the hour, so every lane shares it', () => {
    const byDate = groupItemsByDate([
      taskItem('2026-11-09', 'early', { startMinutes: 6 * 60 + 30, endMinutes: 7 * 60 }),
      eventItem('2026-11-14', 'late', 22 * 60, 23 * 60 + 15),
    ]);
    expect(weekAxis(WEEK, byDate)).toEqual({ start: 6 * 60, end: 24 * 60 });
  });

  it('ignores days outside the week it is given', () => {
    const byDate = groupItemsByDate([taskItem('2026-11-16', 'next', { startMinutes: 5 * 60, endMinutes: 6 * 60 })]);
    expect(weekAxis(WEEK, byDate).start).toBe(LANE_DEFAULT_START);
  });

  it('stops at midnight for an external event running into the next day', () => {
    const start = new Date(2026, 10, 12, 23, 0).toISOString();
    const end = new Date(2026, 10, 13, 1, 0).toISOString();
    const byDate = groupItemsByDate([google(TODAY, 'overnight', start, end)]);
    expect(weekAxis(WEEK, byDate).end).toBe(24 * 60);
  });
});

describe('axisTicks', () => {
  it('labels every four hours inside the axis, placed as fractions', () => {
    expect(axisTicks({ start: 8 * 60, end: 22 * 60 })).toEqual([
      { minutes: 8 * 60, at: 0 },
      { minutes: 12 * 60, at: 240 / 840 },
      { minutes: 16 * 60, at: 480 / 840 },
      { minutes: 20 * 60, at: 720 / 840 },
    ]);
  });

  it('never puts a label on the right edge, where it would run off the track', () => {
    expect(axisTicks({ start: 6 * 60, end: 24 * 60 }).map((t) => t.minutes)).toEqual([480, 720, 960, 1200]);
  });
});

describe('laneSummary', () => {
  const axis = { start: 8 * 60, end: 22 * 60 };

  it('places timed items on the axis and counts what the track cannot draw', () => {
    const summary = laneSummary([
      taskItem(TODAY, 'a', { startMinutes: 10 * 60, endMinutes: 11 * 60 + 30 }),
      eventItem(TODAY, 'b', 15 * 60, 16 * 60),
      taskItem(TODAY, 'anytime'),
      goalItem(TODAY, 'due'),
      noteItem(TODAY, 'n'),
    ], axis);
    expect(summary.segments).toEqual([
      { key: 'task:2026-11-12:a', type: 'task', left: 120 / 840, width: 90 / 840 },
      { key: 'event:2026-11-12:b', type: 'event', left: 420 / 840, width: 60 / 840 },
    ]);
    expect(summary).toMatchObject({ bookedMinutes: 150, anytimeCount: 2, noteCount: 1 });
  });

  it('keeps overlapping items as separate segments (drawn see-through, D11)', () => {
    const summary = laneSummary([
      taskItem(TODAY, 'a', { startMinutes: 9 * 60, endMinutes: 11 * 60 }),
      eventItem(TODAY, 'b', 10 * 60, 10 * 60 + 30),
    ], axis);
    expect(summary.segments).toHaveLength(2);
  });

  it('draws nothing for an all-day event but still counts it as anytime', () => {
    expect(laneSummary([eventItem(TODAY, 'all', null, null)], axis)).toMatchObject({ segments: [], anytimeCount: 1 });
  });
});

describe('taskFocusOnDay', () => {
  const items = [taskItem(TODAY, 'a', { startMinutes: 600, endMinutes: 690 })];

  it('reports focus against the planned block', () => {
    const plan = planVsActual(TODAY, plannedBlocksFromCalendar(items), [session({ durationSeconds: 52 * 60 })]);
    expect(taskFocusOnDay(plan, 'a')).toEqual({ seconds: 52 * 60, sessions: 1, plannedMinutes: 90 });
  });

  it('reports unplanned focus with no plan length', () => {
    const plan = planVsActual(TODAY, [], [session({ taskId: 'b' }), session({ id: 's2', taskId: 'b' })]);
    expect(taskFocusOnDay(plan, 'b')).toEqual({ seconds: 50 * 60, sessions: 2, plannedMinutes: null });
  });

  it('is null for a task with neither a block nor focus', () => {
    expect(taskFocusOnDay(planVsActual(TODAY, [], []), 'a')).toBeNull();
  });
});

describe('importantDeadlines', () => {
  it('keeps goal deadlines and high or urgent one-off tasks, nothing else', () => {
    const list = importantDeadlines([
      goalItem('2026-11-20', 'portfolio'),
      taskItem('2026-11-14', 'urgent', { priority: 'urgent' }),
      taskItem('2026-11-15', 'high', { priority: 'high' }),
      taskItem('2026-11-15', 'medium', { priority: 'medium' }),
      taskItem('2026-11-15', 'low', { priority: 'low' }),
      habitItem('2026-11-16', 'weekly', { priority: 'urgent' }),
      eventItem('2026-11-16', 'event', 600, 660),
      noteItem('2026-11-16', 'note'),
    ], TODAY);
    expect(list.map((d) => (d.item.data as { id: string }).id)).toEqual(['urgent', 'high', 'portfolio']);
  });

  it('drops completed items', () => {
    const list = importantDeadlines([
      goalItem('2026-11-20', 'done', { isCompleted: true }),
      taskItem('2026-11-14', 'done-task', { priority: 'urgent', isCompleted: true }),
    ], TODAY);
    expect(list).toEqual([]);
  });

  it('marks open items before today as late, and today is not late', () => {
    const list = importantDeadlines([
      taskItem('2026-11-02', 'old', { priority: 'high' }),
      taskItem(TODAY, 'today', { priority: 'high' }),
    ], TODAY);
    expect(list.map((d) => d.isLate)).toEqual([true, false]);
  });

  it('orders by date, then priority, then title', () => {
    const list = importantDeadlines([
      taskItem('2026-11-20', 'b-high', { priority: 'high' }),
      taskItem('2026-11-20', 'a-high', { priority: 'high' }),
      taskItem('2026-11-20', 'z-urgent', { priority: 'urgent' }),
      taskItem('2026-11-18', 'earliest', { priority: 'high' }),
    ], TODAY);
    expect(list.map((d) => (d.item.data as { id: string }).id)).toEqual(['earliest', 'z-urgent', 'a-high', 'b-high']);
  });

  it('puts overdue items from before the month first, late, and lists a duplicate once', () => {
    const overdue = [taskItem('2026-10-30', 'missed', { priority: 'urgent' })];
    const list = importantDeadlines([...overdue, goalItem('2026-11-20', 'g')], TODAY, overdue);
    expect(list.map((d) => [(d.item.data as { id: string }).id, d.isLate])).toEqual([['missed', true], ['g', false]]);
  });
});

describe('overdueDeadlineItems', () => {
  it('builds items for open important tasks and goals due before the month', () => {
    const items = overdueDeadlineItems(
      [
        task({ id: 'missed', priority: 'urgent', dueDate: '2026-10-30T00:00:00.000Z' }),
        task({ id: 'in-month', priority: 'urgent', dueDate: '2026-11-03T00:00:00.000Z' }),
        task({ id: 'medium', priority: 'medium', dueDate: '2026-10-30T00:00:00.000Z' }),
        task({ id: 'archived', priority: 'urgent', isArchived: true, dueDate: '2026-10-30T00:00:00.000Z' }),
        task({ id: 'recurring', priority: 'urgent', isRecurring: true, dueDate: '2026-10-30T00:00:00.000Z' }),
        task({ id: 'no-date', priority: 'urgent' }),
      ],
      [
        goal({ id: 'late-goal', deadline: '2026-10-25' }),
        goal({ id: 'done-goal', deadline: '2026-10-25', isCompleted: true }),
        goal({ id: 'archived-goal', deadline: '2026-10-25', isArchived: true }),
      ],
      '2026-11-01',
    );
    expect(items.map((i) => [i.type, i.date, (i.data as { id: string }).id])).toEqual([
      ['task', '2026-10-30', 'missed'],
      ['goal_deadline', '2026-10-25', 'late-goal'],
    ]);
  });
});
