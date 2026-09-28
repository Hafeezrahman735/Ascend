import type { Task } from '../types';

/**
 * Composition rules for showing recurring tasks in the Tasks tab.
 *
 * A recurring task is a template plus a per-day instance. The instance is the
 * only thing GET /tasks returns, and spawn-recurring archives every instance not
 * due today, so on days a template is not scheduled it had no representation at
 * all and vanished from the app.
 *
 * When a template has no instance to stand in for it, the list shows the
 * template itself, labelled with when it next fires (`nextOccurrence`, answered
 * by the server on GET /tasks/recurring). How those rows are bucketed lives in
 * lib/taskBoard.ts.
 *
 * Pure and free of react-native imports so it can be unit-tested; component
 * rendering is out of scope in this project (see mobile/vitest.config.mts), so
 * this file is where the behaviour has to live to be covered at all.
 */

/** A recurring template as returned by GET /tasks/recurring. */
export type RecurringTemplate = Task & {
  scheduledToday?: boolean;
  /** 'YYYY-MM-DD' of the next occurrence, or null if no valid day is set. */
  nextOccurrence?: string | null;
};

/**
 * Templates with no live instance today, which the list must show on their own.
 *
 * Every recurring task has to appear somewhere. This used to also drop templates
 * the server said were scheduled today, on the theory that their instance was
 * only moments from spawning. In practice the spawner could skip a habit for
 * good (a never-spawned template was invisible to its query), and dropping it
 * here is exactly how a recurring task vanished from the app with no trace.
 */
export function templatesWithoutInstance(
  templates: RecurringTemplate[],
  tasks: Task[],
): RecurringTemplate[] {
  const withLiveInstance = new Set(
    tasks.filter((t) => !!t.parentTaskId && !t.isArchived).map((t) => t.parentTaskId as string),
  );
  return templates.filter((t) => !t.isArchived && !withLiveInstance.has(t.id));
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
