import type { CalendarItem, Task } from '../types';
import { calendarItemKey, itemIsDone, itemTitle } from './calendarItems';

/**
 * The week's actual workload, for the Planning tab.
 *
 * Planning could show you the week's events and the week's notes, but not the
 * week's WORK — tasks fed the per-day load counts at the top of the tab and then
 * appeared in no list at all. The only task section was "Unscheduled", which
 * means something much narrower than it sounds: tasks with no due date. Anyone
 * who dates their tasks saw it read 0 forever and had no list of what the week
 * actually holds.
 *
 * Built from the same CalendarItem[] the day strip counts, deliberately. Deriving
 * it a second time from the task store instead would let the list and the counts
 * above it disagree about the same week, which is the failure this codebase has
 * hit before and keeps warning about.
 *
 * Recurring tasks are included: `habit_instance` is the wire name for a spawned
 * recurring TASK, not a separate "habits" feature (see TYPE_META). Goal
 * deadlines are not — a deadline is a date you are working toward, not a thing
 * you sit down and do.
 */

const PRIORITY_RANK: Record<Task['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface WeekTask {
  key: string;
  title: string;
  /** 'YYYY-MM-DD' the task is due on. */
  dateKey: string;
  /** Due before today and still open — this week, but already late. */
  isOverdue: boolean;
  isToday: boolean;
  /** Minutes from local midnight when the task is scheduled, if it is. */
  startMinutes: number | null;
  estimatedMinutes: number | null;
  priority: Task['priority'];
  isRecurring: boolean;
  task: Task;
}

function isTaskItem(item: CalendarItem): boolean {
  return item.type === 'task' || item.type === 'habit_instance';
}

/**
 * Incomplete tasks in the given items, ordered the way you would work through
 * them: what is already late, then today, then the rest of the week.
 *
 * Completed tasks are dropped rather than struck through. This section answers
 * "what still needs doing", and a finished task is not an answer to it — the
 * count in the header is meant to be the size of the remaining pile.
 */
export function weekTasksToWorkOn(items: CalendarItem[], todayKey: string): WeekTask[] {
  const out: WeekTask[] = [];

  for (const item of items) {
    if (!isTaskItem(item)) continue;
    if (itemIsDone(item)) continue;

    const task = item.data as Task;
    out.push({
      key: calendarItemKey(item),
      title: itemTitle(item),
      dateKey: item.date,
      isOverdue: item.date < todayKey,
      isToday: item.date === todayKey,
      startMinutes: task.startMinutes ?? null,
      estimatedMinutes: task.estimatedMinutes ?? null,
      priority: task.priority,
      isRecurring: task.isRecurring,
      task,
    });
  }

  return out.sort(compareWeekTasks);
}

/**
 * Date first, because the week is the axis this tab thinks in. Within a day, a
 * task with a time comes before one without: the timed ones have a place to be
 * and the untimed ones are what you fit around them.
 */
function compareWeekTasks(a: WeekTask, b: WeekTask): number {
  if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;

  const aTimed = a.startMinutes != null;
  const bTimed = b.startMinutes != null;
  if (aTimed !== bTimed) return aTimed ? -1 : 1;
  if (aTimed && bTimed && a.startMinutes !== b.startMinutes) {
    return (a.startMinutes as number) - (b.startMinutes as number);
  }

  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;

  return a.title.localeCompare(b.title);
}

/** Total estimated minutes across the week's remaining tasks. 0 when none carry an estimate. */
export function estimatedMinutesRemaining(weekTasks: WeekTask[]): number {
  return weekTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
}
