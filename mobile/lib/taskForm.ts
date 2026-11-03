import type { DayOfWeek, Task, WorkBlock } from '../types';

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
  // A recurring task's time: minutes from local midnight, or null for untimed.
  startMinutes?: number | null;
  endMinutes?: number | null;
  priority?: Priority;
  taskGoalId?: string | null;
  isRecurring?: boolean;
  recurringDays?: DayOfWeek[];
  /** A one-off task's whole work-block list; the server replaces the old one. */
  blocks?: WorkBlock[];
}

/** The form's editable state. Empty values use the form's own conventions. */
export interface TaskFormFields {
  title: string;
  description: string;
  /** 'YYYY-MM-DD', or '' for no date. The deadline (or a habit's last day). */
  dueDate: string;
  tags: string[];
  /** 0 means "not set". */
  estimatedMinutes: number;
  /** A recurring task's time. One-off tasks plan with `blocks` instead. */
  startMinutes: number | null;
  endMinutes: number | null;
  /** A one-off task's work blocks, sorted by day then start. */
  blocks: WorkBlock[];
  priority: Priority;
  taskGoalId: string | null;
  isRecurring: boolean;
  /** Empty means every day. */
  recurringDays: DayOfWeek[];
}

/**
 * A work block to add when the form opens: "Find a slot" (a timed gap) and
 * + Task on a calendar day (that day, any time, design D10). It is added to the
 * task's own blocks, never in place of them, and never touches the due date.
 */
export interface TaskFormPrefill {
  block: WorkBlock;
}

// ── Work blocks ──────────────────────────────────────────────

/** Day, then start; a day's any-time block after its timed ones. */
export function compareWorkBlocks(a: WorkBlock, b: WorkBlock): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.startMinutes ?? Number.MAX_SAFE_INTEGER) - (b.startMinutes ?? Number.MAX_SAFE_INTEGER);
}

export function sortWorkBlocks(blocks: WorkBlock[]): WorkBlock[] {
  return [...blocks].sort(compareWorkBlocks);
}

/** Whether two lists hold the same blocks, in any order. */
export function sameWorkBlocks(a: WorkBlock[], b: WorkBlock[]): boolean {
  if (a.length !== b.length) return false;
  const key = (x: WorkBlock) => `${x.date}@${x.startMinutes ?? ''}-${x.endMinutes ?? ''}`;
  const left = sortWorkBlocks(a).map(key);
  const right = sortWorkBlocks(b).map(key);
  return left.every((k, i) => k === right[i]);
}

/** Adds a block unless the list already has one on that day at that start. */
export function addWorkBlock(blocks: WorkBlock[], block: WorkBlock): WorkBlock[] {
  const clash = blocks.some((b) => b.date === block.date && b.startMinutes === block.startMinutes);
  return clash ? blocks : sortWorkBlocks([...blocks, block]);
}

/** Total minutes of the timed blocks: the WORK BLOCKS header figure. */
export function timedBlockMinutes(blocks: WorkBlock[]): number {
  return blocks.reduce((sum, b) => (
    b.startMinutes != null && b.endMinutes != null ? sum + Math.max(0, b.endMinutes - b.startMinutes) : sum
  ), 0);
}

/** 'YYYY-MM-DD' plus n days, by calendar parts (no DST drift). */
function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(y, m - 1, d + n);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/** "+ Add work block": the first day from today that has no block yet (D21). */
export function nextFreeBlockDay(blocks: WorkBlock[], todayKey: string): string {
  const taken = new Set(blocks.map((b) => b.date));
  let day = todayKey;
  while (taken.has(day)) day = addDaysKey(day, 1);
  return day;
}

/**
 * The first problem with a block list, mirroring the server's rules so the
 * form can point at the row before saving (design D22): both ends or neither,
 * the end after the start, one any-time block a day, no two starting together.
 */
export function workBlockError(blocks: WorkBlock[]): { index: number; message: string } | null {
  const seen = new Set<string>();
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index];
    const hasStart = b.startMinutes != null;
    const hasEnd = b.endMinutes != null;
    if (hasStart !== hasEnd) return { index, message: 'A work block needs both a start and an end time' };
    if (hasStart && hasEnd && (b.endMinutes as number) <= (b.startMinutes as number)) {
      return { index, message: 'End time must be after start time' };
    }
    const key = `${b.date}@${b.startMinutes ?? 'any'}`;
    if (seen.has(key)) {
      return {
        index,
        message: hasStart ? 'Two work blocks start at the same time on the same day' : 'Only one any-time work block per day',
      };
    }
    seen.add(key);
  }
  return null;
}

/** Upcoming blocks named in the task sheet's line before "+N more" (D24). */
const SUMMARY_BLOCKS = 3;

/**
 * The task sheet's "Work blocks" line (D24): upcoming blocks only, as
 * "Mon 9:00 AM–11:00 AM, Wed any time" with "+N more" past three, and the
 * timed minutes they add up to. Null when nothing is planned from today on.
 */
export function workBlocksSummary(
  blocks: WorkBlock[],
  todayKey: string,
  formatTime: (minutes: number) => string,
): { text: string; minutes: number } | null {
  const upcoming = sortWorkBlocks(blocks).filter((b) => b.date >= todayKey);
  if (upcoming.length === 0) return null;
  const parts = upcoming.slice(0, SUMMARY_BLOCKS).map((b) => {
    const [y, m, d] = b.date.split('-').map(Number);
    const day = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
    const when = b.startMinutes != null && b.endMinutes != null
      ? `${formatTime(b.startMinutes)}–${formatTime(b.endMinutes)}`
      : 'any time';
    return `${day} ${when}`;
  });
  const more = upcoming.length - SUMMARY_BLOCKS;
  return {
    text: more > 0 ? `${parts.join(', ')} +${more} more` : parts.join(', '),
    minutes: timedBlockMinutes(upcoming),
  };
}

/** The day a save should take the calendar to: the earliest block from today, else the due date. */
export function followDate(blocks: WorkBlock[], dueDate: string | null, todayKey: string): string | null {
  return sortWorkBlocks(blocks).find((b) => b.date >= todayKey)?.date ?? blocks[blocks.length - 1]?.date ?? dueDate;
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
 * New tasks start with no due date: a deadline is a commitment the user picks,
 * not a default. Context (+ Task on a calendar day, Find a slot) plans a work
 * block instead, which is what choosing a day on a calendar means (D10).
 */
export function initialFields(task: Task | null, prefill?: TaskFormPrefill): TaskFormFields {
  const fields: TaskFormFields = {
    title: task?.title ?? '',
    description: task?.description ?? '',
    dueDate: formDate(task) ?? '',
    tags: task?.tags ?? [],
    estimatedMinutes: task?.estimatedMinutes ?? 0,
    // A one-off task's own times are ignored: an older build's cache may still
    // carry them, and the server refuses them now.
    startMinutes: task?.isRecurring ? task.startMinutes ?? null : null,
    endMinutes: task?.isRecurring ? task.endMinutes ?? null : null,
    blocks: sortWorkBlocks(task?.blocks ?? []),
    priority: task?.priority ?? 'medium',
    taskGoalId: task?.taskGoalId ?? null,
    isRecurring: task?.isRecurring ?? false,
    recurringDays: task?.recurringDays ?? [],
  };
  // A habit has no work blocks; its day comes from its repeat rule.
  if (prefill && !fields.isRecurring) fields.blocks = addWorkBlock(fields.blocks, prefill.block);
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
 *
 * Work blocks go only on a one-off task, and on an edit only when the list
 * changed: the server replaces the whole list, so an untouched form must not
 * resend it (a stale copy would delete blocks). Times go only on a habit.
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
      ...(f.isRecurring
        ? { startMinutes: f.startMinutes, endMinutes: f.endMinutes }
        : { blocks: f.blocks }),
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
  if (f.isRecurring) {
    if (f.startMinutes !== (task.startMinutes ?? null)) update.startMinutes = f.startMinutes;
    if (f.endMinutes !== (task.endMinutes ?? null)) update.endMinutes = f.endMinutes;
  } else if (task.isRecurring || !sameWorkBlocks(f.blocks, task.blocks ?? [])) {
    update.blocks = f.blocks;
  }
  if (f.priority !== task.priority) update.priority = f.priority;
  if (f.taskGoalId !== (task.taskGoalId ?? null)) update.taskGoalId = f.taskGoalId;
  update.isRecurring = f.isRecurring;
  update.recurringDays = f.recurringDays;
  return update;
}
