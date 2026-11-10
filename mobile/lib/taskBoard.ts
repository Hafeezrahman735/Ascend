import type { Task, WorkBlock } from '../types';
import { daysUntilDue, getLocalDateString } from '../utils/date';
import { PRIORITY_RANK } from './planningTasks';
import { daysUntil, templatesWithoutTodayRow, type RecurringTemplate } from './recurringDisplay';

/**
 * How the Today tab orders and groups work.
 *
 * Two surfaces read from here:
 *  - the main tab shows the TOP few open tasks, most pressing first
 *  - "See more" shows every task grouped by progress: Not started, In progress,
 *    Completed
 *
 * Progress is read from session stats, not a stored status. A task nobody has
 * run a focus session on is Not started; one with sessions that is not ticked
 * off is In progress. Completion always wins.
 *
 * Recurring tasks appear exactly once. On a day one is due, its day row is an
 * ordinary task and buckets like one. On any other day there is no row, so the
 * recurring task itself stands in, in Not started, labelled with when it next
 * fires.
 *
 * Pure and free of react-native imports so it can be unit-tested.
 */

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

/** See more's tabs: every group, or one (all-tasks-status-tabs D3-D5). */
export type BoardTab = 'all' | TaskStatus;

export type BoardItem =
  | { kind: 'task'; task: Task }
  | { kind: 'recurring'; template: RecurringTemplate };

export interface TaskBoard {
  notStarted: BoardItem[];
  inProgress: BoardItem[];
  completed: BoardItem[];
}

export function taskStatus(task: Task): TaskStatus {
  if (task.isCompleted) return 'completed';
  return task.sessionsOnTask > 0 ? 'in_progress' : 'not_started';
}

/**
 * Most pressing first: priority, then the closest due date, then newest.
 *
 * Priority leads because it is the user's own call — an urgent task due Friday
 * outranks a low one due today. Undated tasks sort after dated ones within a
 * priority; overdue counts as closest, since negative days sort first.
 */
export function compareByUrgency(a: Task, b: Task, now: Date): number {
  const byPriority = (PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.medium)
    - (PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.medium);
  if (byPriority !== 0) return byPriority;

  const da = daysUntilDue(a.dueDate, now);
  const db = daysUntilDue(b.dueDate, now);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** The open tasks the main tab leads with. */
/**
 * A one-off task's work block today: its earliest timed one, else its any-time
 * one. Null when nothing is planned for it today.
 */
export function workBlockToday(task: Pick<Task, 'blocks' | 'isRecurring'>, todayKey: string): WorkBlock | null {
  if (task.isRecurring) return null;
  const today = (task.blocks ?? []).filter((b) => b.date === todayKey);
  return today.find((b) => b.startMinutes != null)
    ? today.reduce((a, b) => ((b.startMinutes ?? Infinity) < (a.startMinutes ?? Infinity) ? b : a))
    : today[0] ?? null;
}

/**
 * The open tasks the main tab leads with. What you planned for today comes
 * first, in the order its work blocks start (any-time ones after), then the
 * most pressing of the rest (task-due-and-work-blocks D6): planning a task for
 * today is the user saying it matters today, whatever its deadline.
 */
export function topTasks(tasks: Task[], now: Date, limit: number): Task[] {
  const todayKey = getLocalDateString(now);
  const open = tasks.filter((t) => !t.isArchived && !t.isCompleted);
  const planned: { task: Task; start: number }[] = [];
  const rest: Task[] = [];
  for (const task of open) {
    const block = workBlockToday(task, todayKey);
    if (block) planned.push({ task, start: block.startMinutes ?? Number.MAX_SAFE_INTEGER });
    else rest.push(task);
  }
  planned.sort((a, b) => a.start - b.start || compareByUrgency(a.task, b.task, now));
  rest.sort((a, b) => compareByUrgency(a, b, now));
  return [...planned.map((p) => p.task), ...rest].slice(0, limit);
}

/**
 * The day an open board item is next needed, in days from today: a task's due
 * date (negative when overdue), or a stand-in habit's next occurrence. Null
 * when it has none: an undated task, or a habit that has ended.
 */
function itemDay(item: BoardItem, now: Date): number | null {
  return item.kind === 'task'
    ? daysUntilDue(item.task.dueDate, now)
    : daysUntil(item.template.nextOccurrence, now);
}

function itemTask(item: BoardItem): Task {
  return item.kind === 'task' ? item.task : item.template;
}

/**
 * See more's order (all-tasks-status-tabs D7, D19): by when it is needed,
 * so the list reads as a timeline. Overdue first, then today, then later,
 * then undated. A stand-in habit slots in on its next occurrence. Ties go
 * to priority, then a one-off task before a habit, then newest (habits by
 * title).
 *
 * Today's top three keep compareByUrgency: this order is only for the board.
 */
export function compareByWhen(a: BoardItem, b: BoardItem, now: Date): number {
  const da = itemDay(a, now);
  const db = itemDay(b, now);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  const ta = itemTask(a);
  const tb = itemTask(b);
  const byPriority = (PRIORITY_RANK[ta.priority] ?? PRIORITY_RANK.medium)
    - (PRIORITY_RANK[tb.priority] ?? PRIORITY_RANK.medium);
  if (byPriority !== 0) return byPriority;
  if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1;
  if (a.kind === 'recurring') return ta.title.localeCompare(tb.title);
  return tb.createdAt.localeCompare(ta.createdAt);
}

/** Most recently finished first; rows without a completedAt sink. */
function compareCompleted(a: Task, b: Task): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
}

export function buildTaskBoard(params: {
  tasks: Task[];
  templates: RecurringTemplate[];
  now: Date;
}): TaskBoard {
  const { tasks, templates, now } = params;
  const live = tasks.filter((t) => !t.isArchived);

  const byStatus: Record<TaskStatus, Task[]> = { not_started: [], in_progress: [], completed: [] };
  for (const task of live) byStatus[taskStatus(task)].push(task);

  const when = (a: BoardItem, b: BoardItem) => compareByWhen(a, b, now);
  const asTasks = (list: Task[]): BoardItem[] => list.map((task) => ({ kind: 'task', task }));

  // A recurring task with no row today stands in under Not started, unless
  // its whole series was completed: then it is finished work, under Completed.
  const standIns: BoardItem[] = [];
  const completedSeries: BoardItem[] = [];
  for (const template of templatesWithoutTodayRow(templates, live)) {
    (template.isCompleted ? completedSeries : standIns).push({ kind: 'recurring', template });
  }
  const byCompletion = (a: BoardItem, b: BoardItem) => compareCompleted(itemTask(a), itemTask(b));

  return {
    notStarted: [...asTasks(byStatus.not_started), ...standIns].sort(when),
    inProgress: asTasks(byStatus.in_progress).sort(when),
    completed: [...asTasks(byStatus.completed), ...completedSeries].sort(byCompletion),
  };
}
