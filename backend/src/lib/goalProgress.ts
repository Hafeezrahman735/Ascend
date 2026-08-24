import { ProgressMode } from '@prisma/client';
import { prisma } from './prisma';
import { eventBus, EventTypes } from '../middleware/eventBus';

/**
 * TaskGoal progress + auto-completion.
 *
 * A goal can be measured on completed tasks, on focus sessions logged against
 * its linked tasks, or on both. Everything that needs a goal's progress reads it
 * from here so the server is the single source of truth — the client no longer
 * recomputes it from its own partial task list.
 */

export interface TaskGoalCounts {
  linkedTaskCount: number;
  completedTaskCount: number;
  actualSessions: number;
  /**
   * Credited focus seconds across every session logged against this goal’s
   * tasks. A session COUNT stopped being a usable measure of effort once
   * blocks could differ in length, so time is tracked beside it. Reporting
   * only, never a progress denominator — see computeProgress.
   */
  totalFocusSeconds: number;
}

export interface TaskGoalProgress extends TaskGoalCounts {
  progressMode: ProgressMode;
  taskProgress: number;
  /** null when the goal has no session target to measure against. */
  sessionProgress: number | null;
  overallProgress: number;
}

/**
 * A goal only claims a sessions component if it actually has a target to measure
 * against. A stored mode of 'sessions'/'both' with no targetSessions would
 * otherwise report progress it cannot compute.
 */
export function resolveProgressMode(
  stored: ProgressMode,
  targetSessions: number | null,
): ProgressMode {
  if (!targetSessions || targetSessions <= 0) return 'tasks';
  return stored;
}

export function computeProgress(
  stored: ProgressMode,
  targetSessions: number | null,
  counts: TaskGoalCounts,
): TaskGoalProgress {
  const progressMode = resolveProgressMode(stored, targetSessions);

  const taskProgress =
    counts.linkedTaskCount > 0 ? counts.completedTaskCount / counts.linkedTaskCount : 0;

  const sessionProgress =
    targetSessions && targetSessions > 0
      ? Math.min(counts.actualSessions / targetSessions, 1)
      : null;

  // Flat 50/50 for 'both'. Deliberately not configurable here — weighted rollups
  // belong to the goal-hierarchy design, not to this.
  const overallProgress =
    progressMode === 'tasks'
      ? taskProgress
      : progressMode === 'sessions'
        ? (sessionProgress ?? 0)
        : (taskProgress + (sessionProgress ?? 0)) / 2;

  return { ...counts, progressMode, taskProgress, sessionProgress, overallProgress };
}

/**
 * Counts for a set of goals, in two queries total regardless of goal count.
 *
 * Both queries are scoped by userId as well as taskGoalId: a task belonging to
 * someone else must never contribute to this user's goal, even if it somehow
 * carries the id.
 */
export async function loadGoalCounts(
  userId: string,
  goalIds: string[],
): Promise<Map<string, TaskGoalCounts>> {
  const counts = new Map<string, TaskGoalCounts>();
  for (const id of goalIds) {
    counts.set(id, { linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0, totalFocusSeconds: 0 });
  }
  if (goalIds.length === 0) return counts;

  // Task counts — grouped, so no task rows cross the wire just to be counted.
  const taskGroups = await prisma.task.groupBy({
    by: ['taskGoalId', 'isCompleted'],
    where: { userId, taskGoalId: { in: goalIds }, isArchived: false },
    _count: { _all: true },
  });

  for (const g of taskGroups) {
    if (!g.taskGoalId) continue;
    const entry = counts.get(g.taskGoalId);
    if (!entry) continue;
    entry.linkedTaskCount += g._count._all;
    if (g.isCompleted) entry.completedTaskCount += g._count._all;
  }

  // Focus sessions logged against any task currently linked to each goal.
  // NOTE: no `isArchived` filter here, unlike the task-count query above.
  // Recurring habits archive yesterday’s instance every day (see
  // POST /tasks/spawn-recurring), and each instance inherits the template’s
  // taskGoalId. Filtering archived tasks out therefore hid every session
  // older than today, so a goal linked to a habit reported near-zero
  // progress forever. Time already spent does not become un-spent when the
  // row it belongs to is archived. The task-count query keeps its filter,
  // where excluding archived instances is correct — they should not inflate
  // linkedTaskCount.
  const sessionGroups = await prisma.session.groupBy({
    by: ['taskId'],
    where: {
      userId,
      type: 'focus',
      task: { userId, taskGoalId: { in: goalIds } },
    },
    _count: { _all: true },
    _sum: { durationSeconds: true },
  });

  if (sessionGroups.length > 0) {
    const taskIds = sessionGroups.map((s) => s.taskId).filter((t): t is string => !!t);
    const taskToGoal = await prisma.task.findMany({
      where: { id: { in: taskIds }, userId },
      select: { id: true, taskGoalId: true },
    });
    const goalByTask = new Map(taskToGoal.map((t) => [t.id, t.taskGoalId]));

    for (const s of sessionGroups) {
      if (!s.taskId) continue;
      const goalId = goalByTask.get(s.taskId);
      if (!goalId) continue;
      const entry = counts.get(goalId);
      if (!entry) continue;
      entry.actualSessions += s._count._all;
      // Prisma types _sum as nullable when a group could be empty.
      entry.totalFocusSeconds += s._sum.durationSeconds ?? 0;
    }
  }

  return counts;
}

/**
 * Recompute the given goals and auto-complete any that have crossed 100%.
 *
 * Called after anything that can move progress: a task's completion toggled, a
 * task linked or unlinked, a session logged. Fires TASK_GOAL_COMPLETED only on
 * the false -> true transition, so a goal notifies exactly once no matter how
 * many times progress is recomputed afterwards.
 *
 * A goal is never auto-UNcompleted. Un-checking a task shouldn't silently revoke
 * an achievement the user was already congratulated for; toggleGoalComplete
 * remains available as a manual override.
 */
export async function syncGoalCompletion(userId: string, goalIds: string[]): Promise<void> {
  const ids = [...new Set(goalIds.filter(Boolean))];
  if (ids.length === 0) return;

  const goals = await prisma.taskGoal.findMany({
    where: { id: { in: ids }, userId, isArchived: false },
    select: {
      id: true,
      title: true,
      targetSessions: true,
      progressMode: true,
      isCompleted: true,
    },
  });
  if (goals.length === 0) return;

  const counts = await loadGoalCounts(userId, goals.map((g) => g.id));

  for (const goal of goals) {
    if (goal.isCompleted) continue;

    const c = counts.get(goal.id) ?? {
      linkedTaskCount: 0,
      completedTaskCount: 0,
      actualSessions: 0,
      totalFocusSeconds: 0,
    };

    // A goal with nothing linked and no session target is at 0%, not 100% —
    // guard so an empty goal can't auto-complete itself.
    if (c.linkedTaskCount === 0 && !goal.targetSessions) continue;

    const progress = computeProgress(goal.progressMode, goal.targetSessions, c);
    if (progress.overallProgress < 1) continue;

    // Conditional update: only the transition from not-completed wins, so two
    // concurrent recomputes can't both emit the event.
    const result = await prisma.taskGoal.updateMany({
      where: { id: goal.id, userId, isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    if (result.count === 0) continue;

    // A goal is the largest unit of work in the app, so completing one awards
    // more than any single task. Imported lazily: lib/gamification.ts imports
    // the achievements handler, which would otherwise form an import cycle.
    const { awardXp } = await import('./gamification');
    const { GOAL_COMPLETION_XP } = await import('./xp');
    await awardXp(userId, GOAL_COMPLETION_XP);

    eventBus.emit(EventTypes.FEED_CREATE, {
      userId,
      eventType: 'goal_completed',
      payload: { goalTitle: goal.title, xpEarned: GOAL_COMPLETION_XP },
    });

    eventBus.emit(EventTypes.TASK_GOAL_COMPLETED, {
      userId,
      goalId: goal.id,
      title: goal.title,
      progressMode: progress.progressMode,
      completedTaskCount: progress.completedTaskCount,
      linkedTaskCount: progress.linkedTaskCount,
      actualSessions: progress.actualSessions,
      targetSessions: goal.targetSessions,
    });
  }
}

/**
 * Verify a TaskGoal belongs to this user before a task is attached to it.
 * Returns true for null/undefined (clearing the link is always allowed).
 */
export async function userOwnsGoal(
  userId: string,
  taskGoalId: string | null | undefined,
): Promise<boolean> {
  if (!taskGoalId) return true;
  const goal = await prisma.taskGoal.findFirst({
    where: { id: taskGoalId, userId },
    select: { id: true },
  });
  return !!goal;
}
