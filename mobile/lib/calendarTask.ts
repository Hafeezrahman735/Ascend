import type { CalendarItem, Task } from '../types';

/**
 * The full task behind a calendar block, for the task details sheet.
 *
 * GET /calendar sends a recurring task's days with deliberately narrow data (no
 * tags, no time on task), which the sheet cannot render, so the task store is
 * the source: one-off tasks from `tasks`, recurring ones from their template.
 * The block's own day state wins for a recurring task, because "done" is per
 * day and the template has no single answer. Null when the store does not
 * have the task (deleted, or not loaded yet); the caller opens nothing.
 */
export function taskForCalendarItem(
  item: CalendarItem,
  tasks: Task[],
  templates: Task[],
): Task | null {
  if (item.type !== 'task' && item.type !== 'habit_instance') return null;
  const id = (item.data as { id?: string } | null)?.id;
  if (!id) return null;
  if (item.type === 'task') return tasks.find((t) => t.id === id) ?? null;

  const template = templates.find((t) => t.id === id) ?? tasks.find((t) => t.id === id);
  if (!template) return null;
  const isCompleted = !!(item.data as { isCompleted?: boolean }).isCompleted;
  return { ...template, isCompleted, isOccurrence: true, occurrenceDate: item.date };
}

export type CompletionToggle =
  | { kind: 'task'; id: string }
  | { kind: 'occurrence'; id: string; date: string; done: boolean };

/**
 * How the sheet's complete toggle is saved from the calendar: a one-off task
 * flips its own flag, a recurring task ticks or un-ticks the shown day.
 */
export function completionToggleFor(task: Task): CompletionToggle {
  if (task.isRecurring && task.occurrenceDate) {
    return { kind: 'occurrence', id: task.id, date: task.occurrenceDate, done: !task.isCompleted };
  }
  return { kind: 'task', id: task.id };
}
