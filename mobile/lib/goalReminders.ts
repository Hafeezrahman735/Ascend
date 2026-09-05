import type { TaskGoal } from '../types';
import { parseLocalDate } from '../utils/date';

/**
 * Which goal reminders should be pending, and when each one fires.
 *
 * Pure and free of react-native imports so the Node-only vitest config can
 * reach it — the same reason `calendarItems.ts` and `goalStats.ts` exist. The
 * notification service is the effectful half and holds no rules of its own.
 *
 * Three things here are load-bearing and none of them are obvious:
 *
 * 1. A goal deadline is a CALENDAR DAY (`@db.Date`, 'YYYY-MM-DD'), not an
 *    instant. Turning it into a fire time means building a LOCAL date — a
 *    deadline of Aug 10 means Aug 10 wherever the user is standing. Parsing it
 *    as an instant and reading local fields is a day early west of UTC, which
 *    is the bug class already recorded against `Task.dueDate`.
 *
 * 2. iOS keeps at most 64 PENDING local notifications per app and silently
 *    drops the rest. That budget is shared with the daily reminder and the two
 *    timer alarms, so goals get a cap well under it and take the soonest.
 *
 * 3. Every notification identifier here starts with the same prefix, so the
 *    service can find the ones it owns among everything else scheduled. The app
 *    has only ever used three FIXED identifiers; these are dynamic, one per
 *    goal, and without a prefix there would be no way to tell them apart from
 *    the timer's.
 */

/** Local hour the reminder fires. One place to change the whole feature. */
export const GOAL_REMINDER_HOUR = 9;

/**
 * How many days before the due date to fire.
 *
 * One, not zero: a deadline warning is only useful while there is still time to
 * act on it. "This was due today" delivered on the due date is a status report,
 * and the overdue state already covers that case in the app itself.
 */
export const GOAL_REMINDER_DAYS_BEFORE = 1;

/**
 * How many goal reminders may be pending at once. Deliberately far below the
 * iOS 64 cap because that budget is shared: the daily reminder holds one, and
 * the focus and break alarms hold one each while a session runs.
 */
export const MAX_GOAL_REMINDERS = 10;

const ID_PREFIX = 'ascend-goal-due-';

/** Stable per goal, so rescheduling replaces rather than duplicates. */
export function goalReminderId(goalId: string): string {
  return `${ID_PREFIX}${goalId}`;
}

/** True for identifiers this feature owns, and nothing else the app schedules. */
export function isGoalReminderId(identifier: string): boolean {
  return identifier.startsWith(ID_PREFIX);
}

/**
 * When a goal's reminder should fire, or null if that moment has passed.
 *
 * Built in LOCAL time on purpose — see note 1 above. Day arithmetic goes
 * through the Date constructor rather than millisecond subtraction so a DST
 * boundary between now and the deadline cannot shift the hour.
 */
export function reminderFireDate(
  deadline: string | null | undefined,
  now: Date,
): Date | null {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;

  const day = parseLocalDate(deadline);
  if (Number.isNaN(day.getTime())) return null;

  const fireAt = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - GOAL_REMINDER_DAYS_BEFORE,
    GOAL_REMINDER_HOUR,
    0,
    0,
    0,
  );

  // Already gone. Scheduling a past trigger either fires immediately or is
  // dropped, depending on platform; neither is what anyone wants.
  return fireAt.getTime() > now.getTime() ? fireAt : null;
}

export interface GoalReminder {
  identifier: string;
  goalId: string;
  fireAt: Date;
  title: string;
  body: string;
}

/**
 * The reminder body.
 *
 * Carries a number from THIS goal, matching the content rule the stats surface
 * already follows: generic encouragement reads as a fortune cookie by the
 * second time you see it. A goal with nothing linked says so, because "0 of 0
 * tasks done" is a worse sentence than the truth.
 */
function reminderBody(goal: TaskGoal): string {
  if (goal.linkedTaskCount === 0) return 'Due tomorrow, with no tasks linked yet.';
  const left = goal.linkedTaskCount - goal.completedTaskCount;
  if (left === 0) return 'Due tomorrow. Every task is done — close it out.';
  return `Due tomorrow. ${left} of ${goal.linkedTaskCount} task${goal.linkedTaskCount === 1 ? '' : 's'} still open.`;
}

/**
 * Every goal reminder that should be pending right now, soonest first and
 * capped.
 *
 * Completed and archived goals are excluded rather than filtered downstream:
 * finishing a goal early should silence it, and that only happens if the set
 * this returns is the whole truth about what should exist.
 */
export function goalRemindersToSchedule(goals: TaskGoal[], now: Date): GoalReminder[] {
  const due: GoalReminder[] = [];

  for (const goal of goals) {
    if (goal.isCompleted || goal.isArchived) continue;
    const fireAt = reminderFireDate(goal.deadline, now);
    if (!fireAt) continue;

    due.push({
      identifier: goalReminderId(goal.id),
      goalId: goal.id,
      fireAt,
      title: goal.title,
      body: reminderBody(goal),
    });
  }

  due.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return due.slice(0, MAX_GOAL_REMINDERS);
}
