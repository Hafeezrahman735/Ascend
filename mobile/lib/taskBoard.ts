import type { Task } from '../types';
import { daysUntilDue } from '../utils/date';
import { PRIORITY_RANK } from './planningTasks';
import { daysUntil, templatesWithoutInstance, type RecurringTemplate } from './recurringDisplay';

/**
 * How the Tasks tab orders and groups work.
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
 * Recurring tasks appear exactly once. On a day a habit is scheduled its
 * instance is an ordinary task and buckets like one. On any other day there is
 * no instance, so the template stands in, in Not started, labelled with when it
 * next fires. Before this a habit on an unscheduled day showed only under the
 * All filter, and the main tab had a single slot for them.
 *
 * Pure and free of react-native imports so it can be unit-tested.
 */

export type TaskStatus = 'not_started' | 'in_progress' | 'completed';

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
export function topTasks(tasks: Task[], now: Date, limit: number): Task[] {
  return tasks
    .filter((t) => !t.isArchived && !t.isCompleted)
    .sort((a, b) => compareByUrgency(a, b, now))
    .slice(0, limit);
}

/** Templates standing in for a habit: soonest next occurrence first. */
function compareTemplates(a: RecurringTemplate, b: RecurringTemplate, now: Date): number {
  const da = daysUntil(a.nextOccurrence, now) ?? Number.MAX_SAFE_INTEGER;
  const db = daysUntil(b.nextOccurrence, now) ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return a.title.localeCompare(b.title);
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

  const urgency = (a: Task, b: Task) => compareByUrgency(a, b, now);
  const asTasks = (list: Task[]): BoardItem[] => list.map((task) => ({ kind: 'task', task }));

  const standIns: BoardItem[] = templatesWithoutInstance(templates, live)
    .sort((a, b) => compareTemplates(a, b, now))
    .map((template) => ({ kind: 'recurring', template }));

  return {
    notStarted: [...asTasks(byStatus.not_started.sort(urgency)), ...standIns],
    inProgress: asTasks(byStatus.in_progress.sort(urgency)),
    completed: asTasks(byStatus.completed.sort(compareCompleted)),
  };
}
