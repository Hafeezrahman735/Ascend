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
 * Built from the same CalendarItem[] the day strip counts. Deriving it a second
 * time from the task store would mean two answers to "what is in this week".
 *
 * The list does NOT match those counts one-for-one, and that is deliberate. The
 * strip counts per-day LOAD, so a daily habit legitimately adds one to every day
 * it is scheduled. This list answers "what do I still have to do", where that
 * same habit is ONE commitment. See the recurring rules below.
 *
 * Recurring tasks are included: `habit_instance` is the wire name for a spawned
 * recurring TASK, not a separate "habits" feature (see TYPE_META). Goal
 * deadlines are not — a deadline is a date you are working toward, not a thing
 * you sit down and do.
 *
 * ── Why recurring tasks are treated differently ──────────────────────────────
 *
 * Two subsystems hold opposite, individually-correct rules. The Tasks tab
 * archives every instance not due today (spawn-recurring), so a habit exists
 * only for today and a missed day leaves no row. The calendar PROJECTS the
 * template across the whole requested range (backend recurringProjection.ts) so
 * day and week views can draw the habit on every scheduled day.
 *
 * Reading those projections as a to-do list produced exactly the thing the
 * product is designed to avoid: a daily habit rendered seven rows in one week,
 * three of them labelled "Late". A missed recurrence is not a debt. You cannot
 * do yesterday's reading today.
 *
 * So a habit collapses to ONE row at its next occurrence, and past occurrences
 * are dropped. One-off tasks keep the opposite rule — overdue means still owed,
 * and they stay Late until done.
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
 * Turns one calendar item into a row.
 *
 * `item.data` is cast, not validated, so a field the server did not send is
 * `undefined` here and TypeScript cannot see it. That matters: a projected
 * recurring day carries only id/title/parentTaskId/dueDate/isCompleted, so
 * reading `priority` and `isRecurring` straight off it silently produced a row
 * with no repeat icon and `PRIORITY_RANK[undefined] - PRIORITY_RANK[undefined]`
 * = NaN in the comparator. Both are defaulted here rather than at the call site
 * so every row is well-formed however it was built.
 *
 * `isRecurring` comes from the item TYPE, not the field. The type is the thing
 * the server guarantees; the field is the thing it sometimes omits.
 */
function toWeekTask(item: CalendarItem, todayKey: string): WeekTask {
  const task = item.data as Task;
  return {
    key: calendarItemKey(item),
    title: itemTitle(item),
    dateKey: item.date,
    isOverdue: item.date < todayKey,
    isToday: item.date === todayKey,
    startMinutes: task.startMinutes ?? null,
    estimatedMinutes: task.estimatedMinutes ?? null,
    priority: task.priority ?? 'medium',
    isRecurring: item.type === 'habit_instance' || !!task.isRecurring,
    task,
  };
}

/** The template a recurring occurrence belongs to, real or projected. */
function templateIdOf(item: CalendarItem): string | null {
  const parent = (item.data as Task).parentTaskId;
  return parent ?? null;
}

/**
 * Incomplete work in the given items, ordered the way you would work through it:
 * what is already late, then today, then the rest of the week.
 *
 * Completed items are dropped rather than struck through, and that ordering is
 * load-bearing: because the done-filter runs BEFORE a habit is collapsed, a
 * habit already done today falls through to its next occurrence this week
 * rather than disappearing. Move the filter and you change that behaviour.
 *
 * One-off tasks: one row each, overdue stays overdue.
 * Recurring tasks: ONE row per template, at its next occurrence. Occurrences
 * before today are dropped, and a habit with none left this week does not
 * appear at all.
 */
export function weekTasksToWorkOn(items: CalendarItem[], todayKey: string): WeekTask[] {
  const out: WeekTask[] = [];
  // Earliest not-yet-past occurrence per recurring template.
  const nextByTemplate = new Map<string, WeekTask>();

  for (const item of items) {
    if (!isTaskItem(item)) continue;
    if (itemIsDone(item)) continue;

    if (item.type === 'habit_instance') {
      // A missed recurrence is gone, not owed. Dropping it here is what stops
      // the list becoming a growing pile of days you cannot act on any more.
      if (item.date < todayKey) continue;

      const templateId = templateIdOf(item);
      const row = toWeekTask(item, todayKey);
      if (!templateId) {
        // No parent to group by — treat it as a standalone row rather than
        // silently swallowing it.
        out.push(row);
        continue;
      }
      const existing = nextByTemplate.get(templateId);
      if (!existing || row.dateKey < existing.dateKey) {
        nextByTemplate.set(templateId, row);
      }
      continue;
    }

    out.push(toWeekTask(item, todayKey));
  }

  return [...out, ...nextByTemplate.values()].sort(compareWeekTasks);
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
