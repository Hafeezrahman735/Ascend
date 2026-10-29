import { isScheduledOn } from './recurrence';
import { utcDateStr } from './localDate';
import { repeatsUntil, type Rule } from './recurringStats';
import { awardXp, type XpAward } from './gamification';
import { syncGoalCompletion } from './goalProgress';
import { taskCompletionXP } from './xp';
import { EventTypes } from '../middleware/eventBus';
import { runInTransaction } from './transaction';

/**
 * Ticking off a day of a recurring task: which days may be changed, and the
 * change itself with its side effects. The calculations live in
 * lib/recurringStats.ts.
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

/**
 * Why `date` cannot be ticked off or un-ticked for this task, or null if it can.
 *
 * `today` is the client's local day. A day may be changed only on that day or
 * the one before: the same 24-hour back-dating limit sessions have
 * (MAX_BACKDATE_MS), so a streak cannot be rebuilt after the fact.
 */
export function completionDateError(task: Rule, date: string, today: string): string | null {
  if (!isCalendarDate(date)) return 'Date must be a valid YYYY-MM-DD day';
  if (date > today) return 'Date is in the future';
  if (daysBetween(date, today) > 1) return 'Date is more than one day ago';
  if (date < earliestCreationDay(task.createdAt)) return 'Date is before the task was created';

  const lastDay = repeatsUntil(task);
  if (lastDay && date > lastDay) return 'Date is after the task stops repeating';
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
 * tasksCompleted and the goal touched. Reading first and writing after would
 * let two devices ticking at once both see "not done" and both pay.
 *
 * Everything runs in one transaction, so a failure leaves nothing half-applied,
 * and the feed events go out only after it commits. The task row is locked
 * first, so ticks on the same task queue rather than interleave.
 *
 * The caller has already checked the task is the user's, recurring and live,
 * and that `date` passes completionDateError. `today` is the client's local
 * day, which decides the goal's progress.
 */
export async function applyCompletionChange(
  userId: string,
  taskId: string,
  date: string,
  done: boolean,
  today: string,
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

    if (task.taskGoalId) await syncGoalCompletion(userId, [task.taskGoalId], { effects, today });

    return { changed, reward };
  });
}
