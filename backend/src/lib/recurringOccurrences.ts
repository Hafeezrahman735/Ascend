import type { Task } from '@prisma/client';
import { isScheduledOn } from './recurrence';
import { utcDateStr } from './localDate';
import { awardXp, type XpAward } from './gamification';
import { syncGoalCompletion } from './goalProgress';
import { taskCompletionXP } from './xp';
import { EventTypes } from '../middleware/eventBus';
import { runInTransaction, type Effects } from './transaction';

/**
 * A recurring task as one rule plus a log of the days it was done.
 *
 * Replaces the daily copies that spawn-recurring creates. During the move
 * (stages 1-4 of docs/designs/recurring-tasks-rule-and-log.md) both exist:
 * the log is the record, and the copy for a day is kept in step with it so an
 * older build on another device shows the same tick.
 */

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The earliest UTC offset on earth. A task created at instant T was created on
 * a local day no earlier than the UTC day of T minus this.
 */
const EARLIEST_UTC_OFFSET_MS = 12 * 60 * 60 * 1000;

/** A real calendar day as 'YYYY-MM-DD' — rejects shapes like 2026-02-30. */
export function isCalendarDate(date: string): boolean {
  if (!YYYY_MM_DD.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && utcDateStr(parsed) === date;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS,
  );
}

/**
 * The earliest local day the task could have been created on, in any zone.
 *
 * The row stores an instant, not the creator's zone, so the exact local day
 * is unknown. Bounding by the westernmost zone never turns away a real tick;
 * at worst it allows one day before creation for a user far east of UTC.
 */
function earliestCreationDay(createdAt: Date): string {
  return utcDateStr(new Date(createdAt.getTime() - EARLIEST_UTC_OFFSET_MS));
}

type CompletionTask = Pick<Task, 'recurringDays' | 'dueDate' | 'createdAt'>;

/**
 * Why `date` cannot be ticked off or un-ticked for this task, or null if it can.
 *
 * `today` is the client's local day. A day may be changed only on that day or
 * the one before: the same 24-hour back-dating limit sessions have
 * (MAX_BACKDATE_MS), so a streak cannot be rebuilt after the fact.
 */
export function completionDateError(task: CompletionTask, date: string, today: string): string | null {
  if (!isCalendarDate(date)) return 'Date must be a valid YYYY-MM-DD day';
  if (date > today) return 'Date is in the future';
  if (daysBetween(date, today) > 1) return 'Date is more than one day ago';
  if (date < earliestCreationDay(task.createdAt)) return 'Date is before the task was created';

  const repeatsUntil = task.dueDate ? utcDateStr(task.dueDate) : null;
  if (repeatsUntil && date > repeatsUntil) return 'Date is after the task stops repeating';
  if (!isScheduledOn(task.recurringDays, date)) return 'Task is not scheduled on this day';
  return null;
}

export interface CompletionChange {
  /** False when the day was already in the requested state: nothing was paid or revoked. */
  changed: boolean;
  reward: XpAward | null;
}

/**
 * Mark one day of a recurring task done or not done, with every side effect.
 *
 * The write decides. Inserting the log row with ON CONFLICT DO NOTHING (or
 * deleting it) reports whether the day actually changed, and only then are XP,
 * tasksCompleted, the day's copy and the goal touched. Reading first and writing
 * after would let two devices ticking at once both see "not done" and both pay.
 *
 * Everything runs in one transaction, so a failure leaves nothing half-applied,
 * and the feed events go out only after it commits. The task row is locked
 * first, so ticks on the same task queue rather than interleave.
 *
 * The caller has already checked the task is the user's, recurring and live,
 * and that `date` passes completionDateError.
 */
export async function applyCompletionChange(
  userId: string,
  taskId: string,
  date: string,
  done: boolean,
): Promise<CompletionChange> {
  return runInTransaction(async (effects) => {
    const { db } = effects;
    await db.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;

    const changed = done
      ? (await db.recurringCompletion.createMany({
          data: [{ userId, taskId, date }],
          skipDuplicates: true,
        })).count === 1
      : (await db.recurringCompletion.deleteMany({ where: { taskId, date } })).count === 1;
    if (!changed) return { changed, reward: null };

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const copyGoalId = await markCopy(effects, taskId, date, done);

    const xp = taskCompletionXP(task.priority);
    const reward = await awardXp(userId, done ? xp : -xp, {
      tasksCompletedDelta: done ? 1 : -1,
      effects,
    });

    if (done) {
      effects.events.emit(EventTypes.FEED_CREATE, {
        userId,
        eventType: 'task_completed',
        payload: { taskTitle: task.title, priority: task.priority, xpEarned: xp },
      });
    }

    await syncGoalCompletion(
      userId,
      [task.taskGoalId, copyGoalId].filter((g): g is string => !!g),
      effects,
    );

    return { changed, reward };
  });
}

/**
 * Keep the day's copy, if spawn-recurring made one, in step with the log, so
 * an older build shows the tick. Archived copies too: yesterday's is archived
 * by this morning's spawn and is still the copy for that day.
 *
 * Returns the copy's goal, which older data may hold instead of the task.
 */
async function markCopy(
  { db }: Effects,
  taskId: string,
  date: string,
  done: boolean,
): Promise<string | null> {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAY_MS);
  const copy = await db.task.findFirst({
    where: { parentTaskId: taskId, dueDate: { gte: start, lt: end } },
    select: { id: true, taskGoalId: true },
  });
  if (!copy) return null;

  await db.task.update({
    where: { id: copy.id },
    data: { isCompleted: done, completedAt: done ? new Date() : null },
  });
  return copy.taskGoalId;
}
