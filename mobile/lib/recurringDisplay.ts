import type { Task } from '../types';

/**
 * Composition rules for showing recurring tasks in the Tasks tab.
 *
 * A recurring task is a template plus a per-day instance. The instance is the
 * only thing GET /tasks returns, and spawn-recurring archives every instance not
 * due today, so on days a template is not scheduled it had no representation at
 * all and vanished from the app.
 *
 * Whether a template is scheduled today is answered by the SERVER
 * (`scheduledToday` on GET /tasks/recurring). The client used to infer it from
 * the absence of an instance row, which is also what a failed spawn, a
 * cold-start race and a deleted instance look like — in those states it showed
 * today's habit dimmed and uncompletable while labelling it "Due today".
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

export type ListItem =
  | { kind: 'task'; task: Task }
  | { kind: 'dormant'; template: RecurringTemplate };

/**
 * Templates to show as "not scheduled today".
 *
 * Only templates the server says are NOT due today. A template that IS due but
 * has no instance yet is pending-spawn, not dormant — showing it here is what
 * produced an uncompletable row labelled "Due today".
 */
export function dormantTemplates(
  templates: RecurringTemplate[],
  tasks: Task[],
): RecurringTemplate[] {
  const withLiveInstance = new Set(
    tasks.filter((t) => !!t.parentTaskId && !t.isArchived).map((t) => t.parentTaskId as string),
  );

  return templates.filter((t) => {
    if (t.isArchived) return false;
    // Undefined means an older server that does not send the field. Treat it as
    // scheduled so nothing is wrongly greyed out and made uncompletable.
    if (t.scheduledToday !== false) return false;
    return !withLiveInstance.has(t.id);
  });
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

/**
 * The list the Tasks tab renders: real tasks first, dormant recurring last.
 *
 * Dormant rows appear under the `all` filter only. `pending` means work owed
 * today and a Wednesday habit on a Monday is not owed; `done` would be untrue;
 * `active` is the single focused task. The caller keeps its empty state keyed on
 * real tasks so "Nothing planned yet" is still reachable for someone whose only
 * items are unscheduled habits.
 */
export function composeTaskList(params: {
  tasks: Task[];
  templates: RecurringTemplate[];
  filter: 'all' | 'active' | 'pending' | 'done';
  from?: Date;
  limitDormant?: number;
}): { items: ListItem[]; dormantTotal: number; dormantHidden: number } {
  const { tasks, templates, filter, from = new Date(), limitDormant } = params;

  const items: ListItem[] = tasks.map((task) => ({ kind: 'task', task }));

  if (filter !== 'all') return { items, dormantTotal: 0, dormantHidden: 0 };

  const dormant = dormantTemplates(templates, tasks).sort((a, b) => {
    const da = daysUntil(a.nextOccurrence, from) ?? Number.MAX_SAFE_INTEGER;
    const db = daysUntil(b.nextOccurrence, from) ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.title.localeCompare(b.title);
  });

  const shown = typeof limitDormant === 'number' ? dormant.slice(0, limitDormant) : dormant;

  return {
    items: [...items, ...shown.map((template) => ({ kind: 'dormant' as const, template }))],
    dormantTotal: dormant.length,
    dormantHidden: dormant.length - shown.length,
  };
}
