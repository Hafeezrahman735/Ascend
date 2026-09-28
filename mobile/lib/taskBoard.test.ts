import { describe, it, expect } from 'vitest';
import { buildTaskBoard, compareByUrgency, taskStatus, topTasks, type BoardItem } from './taskBoard';
import type { RecurringTemplate } from './recurringDisplay';
import type { Task } from '../types';

const base = {
  tags: [], isArchived: false, isCompleted: false,
  createdAt: '2026-08-18T00:00:00.000Z', sessionsOnTask: 0, totalTimeOnTask: 0,
  sessionDates: [], isRecurring: false, recurringDays: [], priority: 'medium',
};

const task = (over: Partial<Task> & { id: string }): Task =>
  ({ ...base, title: over.id, ...over } as Task);

const template = (over: Partial<RecurringTemplate> & { id: string }): RecurringTemplate =>
  ({ ...base, isRecurring: true, title: over.id, ...over } as RecurringTemplate);

// 2026-08-18 is a Tuesday.
const NOW = new Date('2026-08-18T12:00:00');

const ids = (items: BoardItem[]) =>
  items.map((i) => (i.kind === 'task' ? i.task.id : `recurring:${i.template.id}`));

describe('taskStatus', () => {
  it('is not started with no sessions', () => {
    expect(taskStatus(task({ id: 'a' }))).toBe('not_started');
  });

  it('is in progress once a session has run', () => {
    expect(taskStatus(task({ id: 'a', sessionsOnTask: 2 }))).toBe('in_progress');
  });

  it('is completed when ticked, whatever the session count', () => {
    expect(taskStatus(task({ id: 'a', isCompleted: true }))).toBe('completed');
    expect(taskStatus(task({ id: 'b', isCompleted: true, sessionsOnTask: 3 }))).toBe('completed');
  });
});

describe('compareByUrgency', () => {
  const sort = (list: Task[]) => [...list].sort((a, b) => compareByUrgency(a, b, NOW)).map((t) => t.id);

  it('puts higher priority first, even when due later', () => {
    expect(sort([
      task({ id: 'low-today', priority: 'low', dueDate: '2026-08-18' }),
      task({ id: 'urgent-fri', priority: 'urgent', dueDate: '2026-08-21' }),
      task({ id: 'high', priority: 'high' }),
    ])).toEqual(['urgent-fri', 'high', 'low-today']);
  });

  it('orders by closest due date within a priority, overdue first, undated last', () => {
    expect(sort([
      task({ id: 'none' }),
      task({ id: 'fri', dueDate: '2026-08-21' }),
      task({ id: 'overdue', dueDate: '2026-08-16' }),
      task({ id: 'today', dueDate: '2026-08-18' }),
    ])).toEqual(['overdue', 'today', 'fri', 'none']);
  });

  it('breaks a full tie by newest first', () => {
    expect(sort([
      task({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z' }),
      task({ id: 'new', createdAt: '2026-08-17T00:00:00.000Z' }),
    ])).toEqual(['new', 'old']);
  });

  it('reads a full ISO due date the same as a date-only one', () => {
    // The server sends Prisma DateTimes; an optimistic create holds 'YYYY-MM-DD'.
    expect(sort([
      task({ id: 'iso-fri', dueDate: '2026-08-21T00:00:00.000Z' }),
      task({ id: 'plain-wed', dueDate: '2026-08-19' }),
    ])).toEqual(['plain-wed', 'iso-fri']);
  });
});

describe('topTasks', () => {
  it('returns the most pressing open tasks, capped', () => {
    const list = [
      task({ id: 'm' }),
      task({ id: 'u', priority: 'urgent' }),
      task({ id: 'h', priority: 'high' }),
      task({ id: 'l', priority: 'low' }),
    ];
    expect(topTasks(list, NOW, 3).map((t) => t.id)).toEqual(['u', 'h', 'm']);
  });

  it('skips completed and archived tasks', () => {
    const list = [
      task({ id: 'done', priority: 'urgent', isCompleted: true }),
      task({ id: 'gone', priority: 'urgent', isArchived: true }),
      task({ id: 'open' }),
    ];
    expect(topTasks(list, NOW, 3).map((t) => t.id)).toEqual(['open']);
  });

  it('ranks a recurring instance like any other task', () => {
    const list = [
      task({ id: 'one-off' }),
      task({ id: 'habit', parentTaskId: 'tpl', priority: 'high', dueDate: '2026-08-18' }),
    ];
    expect(topTasks(list, NOW, 3).map((t) => t.id)).toEqual(['habit', 'one-off']);
  });
});

describe('buildTaskBoard', () => {
  it('buckets tasks by session stats and completion', () => {
    const board = buildTaskBoard({
      tasks: [
        task({ id: 'fresh' }),
        task({ id: 'worked', sessionsOnTask: 1 }),
        task({ id: 'done', isCompleted: true, completedAt: '2026-08-18T09:00:00.000Z' }),
      ],
      templates: [],
      now: NOW,
    });
    expect(ids(board.notStarted)).toEqual(['fresh']);
    expect(ids(board.inProgress)).toEqual(['worked']);
    expect(ids(board.completed)).toEqual(['done']);
  });

  it('leaves archived tasks out entirely', () => {
    const board = buildTaskBoard({ tasks: [task({ id: 'gone', isArchived: true })], templates: [], now: NOW });
    expect([...board.notStarted, ...board.inProgress, ...board.completed]).toEqual([]);
  });

  it("buckets a habit scheduled today by its instance's progress", () => {
    const board = buildTaskBoard({
      tasks: [task({ id: 'inst', parentTaskId: 'tpl', sessionsOnTask: 1 })],
      templates: [template({ id: 'tpl', scheduledToday: true })],
      now: NOW,
    });
    expect(ids(board.inProgress)).toEqual(['inst']);
    expect(ids(board.notStarted)).toEqual([]);
  });

  it('shows a habit with no instance today in Not started, after real tasks', () => {
    const board = buildTaskBoard({
      tasks: [task({ id: 'real' })],
      templates: [template({ id: 'wed', scheduledToday: false, nextOccurrence: '2026-08-19' })],
      now: NOW,
    });
    expect(ids(board.notStarted)).toEqual(['real', 'recurring:wed']);
  });

  it('never lists a habit twice once its instance is completed', () => {
    const board = buildTaskBoard({
      tasks: [task({ id: 'inst', parentTaskId: 'tpl', isCompleted: true })],
      templates: [template({ id: 'tpl', scheduledToday: true })],
      now: NOW,
    });
    expect(ids(board.completed)).toEqual(['inst']);
    expect(ids(board.notStarted)).toEqual([]);
  });

  it('orders stand-in habits by soonest next occurrence, ended ones last', () => {
    const board = buildTaskBoard({
      tasks: [],
      templates: [
        template({ id: 'ended', nextOccurrence: null }),
        template({ id: 'fri', nextOccurrence: '2026-08-21' }),
        template({ id: 'wed', nextOccurrence: '2026-08-19' }),
      ],
      now: NOW,
    });
    expect(ids(board.notStarted)).toEqual(['recurring:wed', 'recurring:fri', 'recurring:ended']);
  });

  it('shows the most recently completed first', () => {
    const board = buildTaskBoard({
      tasks: [
        task({ id: 'morning', isCompleted: true, completedAt: '2026-08-18T08:00:00.000Z' }),
        task({ id: 'evening', isCompleted: true, completedAt: '2026-08-18T20:00:00.000Z' }),
      ],
      templates: [],
      now: NOW,
    });
    expect(ids(board.completed)).toEqual(['evening', 'morning']);
  });

  it('is empty for no tasks and no templates', () => {
    expect(buildTaskBoard({ tasks: [], templates: [], now: NOW }))
      .toEqual({ notStarted: [], inProgress: [], completed: [] });
  });
});
