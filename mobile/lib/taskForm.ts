import type { DayOfWeek, Task } from '../types';

/**
 * The task form's field logic, kept free of React Native so vitest can reach it.
 *
 * The form is shared by Today and the calendar (components/TaskFormModal.tsx).
 * What it sends on save is the contract both screens depend on, so it lives
 * here and is tested here rather than inside the component.
 */

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

/** What the form hands to its owner on save: a create payload or a partial update. */
export interface FormSaveData {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  // Minutes from local midnight, or null for an untimed task.
  startMinutes?: number | null;
  endMinutes?: number | null;
  priority?: Priority;
  taskGoalId?: string | null;
  isRecurring?: boolean;
  recurringDays?: DayOfWeek[];
}

/** The form's editable state. Empty values use the form's own conventions. */
export interface TaskFormFields {
  title: string;
  description: string;
  /** 'YYYY-MM-DD', or '' for no date. */
  dueDate: string;
  tags: string[];
  /** 0 means "not set". */
  estimatedMinutes: number;
  startMinutes: number | null;
  endMinutes: number | null;
  priority: Priority;
  taskGoalId: string | null;
  isRecurring: boolean;
  /** Empty means every day. */
  recurringDays: DayOfWeek[];
}

/**
 * Values to start the form with, for "Find a slot". Each one is applied only
 * when the matching field is empty, so a prefill never overwrites something the
 * task already has.
 */
export interface TaskFormPrefill {
  dueDate?: string;
  startMinutes?: number;
  endMinutes?: number;
}

/**
 * The form's date field as 'YYYY-MM-DD', or null. On a recurring task it is
 * the last day it repeats, which a day row carries as `repeatsUntil` because
 * its own dueDate is the row's day. Saving the row's day back would end the
 * task today.
 *
 * Substring because dueDate is a Prisma DateTime and arrives as a full ISO
 * string, while parseLocalDate and the date picker expect 'YYYY-MM-DD'.
 */
export function formDate(task: Task | null): string | null {
  if (!task) return null;
  if (task.isOccurrence) return task.repeatsUntil;
  return task.dueDate?.substring(0, 10) ?? null;
}

/**
 * The fields the form opens with.
 *
 * New tasks start with no due date: a date is a commitment the user picks, not
 * a default. Pre-filling today made every task look due today, and a task left
 * on that default read as overdue the next morning. The one exception is a
 * prefill the user asked for by context — + Task on a calendar Day view, where
 * the day is already chosen.
 */
export function initialFields(task: Task | null, prefill?: TaskFormPrefill): TaskFormFields {
  const fields: TaskFormFields = {
    title: task?.title ?? '',
    description: task?.description ?? '',
    dueDate: formDate(task) ?? '',
    tags: task?.tags ?? [],
    estimatedMinutes: task?.estimatedMinutes ?? 0,
    startMinutes: task?.startMinutes ?? null,
    endMinutes: task?.endMinutes ?? null,
    priority: task?.priority ?? 'medium',
    taskGoalId: task?.taskGoalId ?? null,
    isRecurring: task?.isRecurring ?? false,
    recurringDays: task?.recurringDays ?? [],
  };
  if (!prefill) return fields;

  if (!fields.dueDate && prefill.dueDate) fields.dueDate = prefill.dueDate;
  // A time needs a day, and the pair goes in together or not at all: the
  // server rejects a half-open block.
  const timeIsEmpty = fields.startMinutes === null && fields.endMinutes === null;
  if (fields.dueDate && timeIsEmpty
    && prefill.startMinutes !== undefined && prefill.endMinutes !== undefined) {
    fields.startMinutes = prefill.startMinutes;
    fields.endMinutes = prefill.endMinutes;
  }
  return fields;
}

function sameTags(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/**
 * What to send on save.
 *
 * A new task sends every field. An edit sends the title plus only what changed,
 * and always the recurring pair so a task can be switched either way.
 */
export function buildSaveData(task: Task | null, f: TaskFormFields): FormSaveData {
  const title = f.title.trim();
  if (!task) {
    return {
      title,
      description: f.description.trim() || undefined,
      dueDate: f.dueDate || undefined,
      tags: f.tags,
      estimatedMinutes: f.estimatedMinutes > 0 ? f.estimatedMinutes : undefined,
      startMinutes: f.startMinutes,
      endMinutes: f.endMinutes,
      priority: f.priority,
      taskGoalId: f.taskGoalId,
      isRecurring: f.isRecurring,
      recurringDays: f.recurringDays,
    };
  }

  const update: FormSaveData = { title };
  const newDesc = f.description.trim() || null;
  if (newDesc !== (task.description ?? null)) update.description = newDesc;
  const newDue = f.dueDate || null;
  if (newDue !== formDate(task)) update.dueDate = newDue;
  if (!sameTags(f.tags, task.tags ?? [])) update.tags = f.tags;
  const newEst = f.estimatedMinutes > 0 ? f.estimatedMinutes : null;
  if (newEst !== (task.estimatedMinutes ?? null)) update.estimatedMinutes = newEst;
  if (f.startMinutes !== (task.startMinutes ?? null)) update.startMinutes = f.startMinutes;
  if (f.endMinutes !== (task.endMinutes ?? null)) update.endMinutes = f.endMinutes;
  if (f.priority !== task.priority) update.priority = f.priority;
  if (f.taskGoalId !== (task.taskGoalId ?? null)) update.taskGoalId = f.taskGoalId;
  update.isRecurring = f.isRecurring;
  update.recurringDays = f.recurringDays;
  return update;
}
