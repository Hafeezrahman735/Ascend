import type { Task } from '../types';

/**
 * Composition rules for showing recurring tasks in the Tasks tab.
 *
 * GET /tasks lists a recurring task as a day row only on days it is due. On
 * any other day it has no row, so the list shows the recurring task itself,
 * labelled with when it next fires (`nextOccurrence`, answered by the server on
 * GET /tasks/recurring). How those rows are bucketed lives in lib/taskBoard.ts.
 *
 * Pure and free of react-native imports so it can be unit-tested; component
 * rendering is out of scope in this project (see mobile/vitest.config.mts), so
 * this file is where the behaviour has to live to be covered at all.
 */

/** A recurring task as returned by GET /tasks/recurring. */
export type RecurringTemplate = Task & {
  scheduledToday?: boolean;
  /** 'YYYY-MM-DD' of the next occurrence, or null if no valid day is set. */
  nextOccurrence?: string | null;
};

/**
 * Recurring tasks with no day row today, which the list must show on their own.
 * Every recurring task has to appear somewhere.
 */
export function templatesWithoutTodayRow(
  templates: RecurringTemplate[],
  tasks: Task[],
): RecurringTemplate[] {
  const listedToday = new Set(tasks.filter((t) => t.isOccurrence).map((t) => t.id));
  return templates.filter((t) => !t.isArchived && !listedToday.has(t.id));
}

/** Whole days from today to an ISO date, 0 = today. Null if absent. */
export function daysUntil(dateStr: string | null | undefined, from: Date = new Date()): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return null;
  const base = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - base) / 86_400_000);
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Short human label for when a dormant template comes back.
 *
 * `nextOccurrence` is null for two different reasons and they need different
 * copy. A template with no weekdays ticked has never had a next date. A
 * template whose repeat END has passed had plenty and will not have another —
 * telling that user "No days selected" would send them to look for a setting
 * that is not the problem. The template's own dueDate separates the two.
 */
export function nextOccurrenceLabel(
  template: RecurringTemplate,
  from: Date = new Date(),
): string {
  const endedDays = daysUntil(template.dueDate ? template.dueDate.slice(0, 10) : null, from);
  if (endedDays !== null && endedDays < 0) return 'Finished repeating';

  const days = daysUntil(template.nextOccurrence, from);
  if (days === null) return 'No days selected';
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Next: tomorrow';
  const target = new Date(`${template.nextOccurrence}T00:00:00.000Z`);
  return `Next: ${WEEKDAY[target.getUTCDay()]}`;
}
