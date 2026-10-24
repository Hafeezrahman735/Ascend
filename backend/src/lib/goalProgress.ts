import { Prisma, ProgressMode } from '@prisma/client';
import { prisma } from './prisma';
import { SESSION_GOAL_EXPR, SESSION_GOAL_JOIN } from './goalAttribution';
import { eventBus, EventTypes } from '../middleware/eventBus';

/**
 * TaskGoal progress + auto-completion.
 *
 * A goal is measured on its COMPLETED TASKS. One unit, nothing derived.
 * Everything that needs a goal's progress reads it from here so the server is
 * the single source of truth — the client no longer recomputes it from its own
 * partial task list.
 *
 * It used to be measurable on sessions too ('sessions' / 'both' modes, against a
 * `targetSessions` number the user set on the goal). That broke once sessions
 * stopped being uniformly `workDuration` long — lib/sessionPlan.ts sizes blocks
 * to task estimates and the stopwatch records anything — so "12 of 20 sessions"
 * described an amount of work nobody could name. `targetSessions` and
 * `progressMode` still exist on the row and are still accepted on the wire, but
 * nothing here reads them: see accept-and-ignore in modules/taskgoals/routes.ts.
 *
 *   linked tasks ─┐
 *                 ├─► taskProgress = completed / linked ─► overallProgress
 *   completed  ───┘                                             │
 *                                                               ▼
 *   sessions, focus seconds ──► reporting stats only ──► (never a denominator)
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
  /** Always 'tasks'. Kept on the wire; see computeProgress. */
  progressMode: ProgressMode;
  taskProgress: number;
  /**
   * Always null. Retained on the shape rather than removed because the mobile
   * TaskGoal interface is hand-maintained against this one with no runtime
   * validation on either side, and the integration suite asserts the exact key
   * set the client declares.
   */
  sessionProgress: number | null;
  overallProgress: number;
}

/**
 * Progress for one goal.
 *
 * `stored` and `targetSessions` are accepted so callers can keep passing what
 * the row holds, and are deliberately UNUSED: a goal's progress is its completed
 * task ratio whatever the row says its mode is. Dropping the parameters would
 * mean touching every call site to prove the same thing.
 */
export function computeProgress(
  _stored: ProgressMode,
  _targetSessions: number | null,
  counts: TaskGoalCounts,
): TaskGoalProgress {
  // 0/0 is 0, never 1 — otherwise an empty goal auto-completes itself.
  const taskProgress =
    counts.linkedTaskCount > 0 ? counts.completedTaskCount / counts.linkedTaskCount : 0;

  return {
    ...counts,
    progressMode: 'tasks',
    taskProgress,
    // Kept on the shape, permanently null. The mobile TaskGoal interface is
    // hand-maintained against this with no runtime validation on either side
    // (see SerializedGoal in modules/taskgoals/routes.ts), and narrowing the
    // wire is a worse change than leaving a null the client already handles.
    sessionProgress: null,
    overallProgress: taskProgress,
  };
}

/**
 * Counts for a set of goals, in a fixed number of queries regardless of goal count.
 *
 * Every query is scoped by userId as well as taskGoalId: a task belonging to
 * someone else must never contribute to this user's goal, even if it somehow
 * carries the id.
 *
 * A linked HABIT counts as one item, whatever rows represent it — see
 * loadHabitProgress. It used to be counted as its template (never completed,
 * so the goal could not reach 100%) plus today's instance.
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

  // One-off task counts — grouped, so no task rows cross the wire just to be
  // counted. Templates and instances are habits, counted below.
  const taskGroups = await prisma.task.groupBy({
    by: ['taskGoalId', 'isCompleted'],
    where: {
      userId,
      taskGoalId: { in: goalIds },
      isArchived: false,
      isRecurring: false,
      parentTaskId: null,
    },
    _count: { _all: true },
  });

  for (const g of taskGroups) {
    if (!g.taskGoalId) continue;
    const entry = counts.get(g.taskGoalId);
    if (!entry) continue;
    entry.linkedTaskCount += g._count._all;
    if (g.isCompleted) entry.completedTaskCount += g._count._all;
  }

  for (const habit of await loadHabitProgress(userId, goalIds)) {
    const entry = counts.get(habit.goalId);
    if (!entry) continue;
    entry.linkedTaskCount += 1;
    if (habit.done) entry.completedTaskCount += 1;
  }

  // Focus time, by each session's CURRENT goal (lib/goalAttribution.ts): the
  // task's present link, or for a habit instance the template's. Linking an
  // already-worked task brings its past time; moving or unlinking one takes it
  // away. Archived tasks still count, because their time was really spent; the
  // task-count query above is where excluding archived rows is correct.
  const sessionGroups = await prisma.$queryRaw<{ goal_id: string; sessions: number; seconds: number }[]>`
    SELECT ${SESSION_GOAL_EXPR} AS goal_id,
           COUNT(*)::int AS sessions,
           COALESCE(SUM(s.duration_seconds), 0)::int AS seconds
    FROM sessions s
    ${SESSION_GOAL_JOIN}
    WHERE s.user_id = ${userId}::uuid
      AND s.type = 'focus'
      AND ${SESSION_GOAL_EXPR} IN (${Prisma.join(goalIds)})
    GROUP BY 1`;

  for (const g of sessionGroups) {
    const entry = counts.get(g.goal_id);
    if (!entry) continue;
    entry.actualSessions += g.sessions;
    entry.totalFocusSeconds += g.seconds;
  }

  return counts;
}

/**
 * Each active habit linked to one of these goals, and whether it counts as done.
 *
 * A habit has no finish line, so "done" means its most recent scheduled day
 * was completed. That makes a goal reach 100% once every one-off task is done
 * and each habit was kept on its latest day, and holds steady on days the
 * habit is not scheduled (product decision, 2026-10-21).
 *
 * Membership is the template's taskGoalId. A habit linked through its live
 * instance only — what the app wrote before linkHabitCounterparts existed —
 * still counts, through that instance.
 */
async function loadHabitProgress(
  userId: string,
  goalIds: string[],
): Promise<{ goalId: string; done: boolean }[]> {
  const [linkedTemplates, linkedInstances] = await Promise.all([
    prisma.task.findMany({
      where: { userId, isRecurring: true, isArchived: false, taskGoalId: { in: goalIds } },
      select: { id: true, taskGoalId: true },
    }),
    prisma.task.findMany({
      where: { userId, parentTaskId: { not: null }, isArchived: false, taskGoalId: { in: goalIds } },
      select: { parentTaskId: true, taskGoalId: true },
    }),
  ]);

  const goalByTemplate = new Map<string, string>();
  for (const t of linkedTemplates) goalByTemplate.set(t.id, t.taskGoalId!);

  const instanceOnly = linkedInstances.filter((i) => !goalByTemplate.has(i.parentTaskId!));
  if (instanceOnly.length > 0) {
    // Only habits that still exist: an instance of a deleted habit is archived
    // with it, but the template check keeps this independent of that.
    const active = await prisma.task.findMany({
      where: {
        userId,
        id: { in: instanceOnly.map((i) => i.parentTaskId!) },
        isRecurring: true,
        isArchived: false,
      },
      select: { id: true },
    });
    const activeIds = new Set(active.map((t) => t.id));
    for (const i of instanceOnly) {
      if (activeIds.has(i.parentTaskId!)) goalByTemplate.set(i.parentTaskId!, i.taskGoalId!);
    }
  }
  if (goalByTemplate.size === 0) return [];

  // The newest instance of each habit, archived or not: on a day the habit is
  // not scheduled, yesterday's instance is already archived and is still the
  // day that decides.
  const latest = await prisma.task.findMany({
    where: { userId, parentTaskId: { in: [...goalByTemplate.keys()] } },
    orderBy: [{ parentTaskId: 'asc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
    distinct: ['parentTaskId'],
    select: { parentTaskId: true, isCompleted: true },
  });
  const doneByTemplate = new Map(latest.map((i) => [i.parentTaskId!, i.isCompleted]));

  return [...goalByTemplate].map(([templateId, goalId]) => ({
    goalId,
    done: doneByTemplate.get(templateId) ?? false,
  }));
}

/**
 * A habit is linked to a goal as a unit: its template and its live instance.
 *
 * The app links whichever row it is showing, which for a habit is today's
 * instance. Instances inherit the TEMPLATE's goal when they spawn, so linking
 * only the instance dropped the habit off its goal the next morning. Every
 * write of taskGoalId goes through this to reach both rows.
 *
 * Returns the given ids plus each habit's template and live instance.
 * Archived instances are left as they were: they are history, and their
 * sessions belong to the goal they were worked under.
 */
export async function linkHabitCounterparts(userId: string, taskIds: string[]): Promise<string[]> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return ids;

  const rows = await prisma.task.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, isRecurring: true, parentTaskId: true },
  });
  const templateIds = new Set<string>();
  for (const r of rows) {
    if (r.isRecurring) templateIds.add(r.id);
    if (r.parentTaskId) templateIds.add(r.parentTaskId);
  }
  if (templateIds.size === 0) return ids;

  const live = await prisma.task.findMany({
    where: { userId, parentTaskId: { in: [...templateIds] }, isArchived: false },
    select: { id: true },
  });
  return [...new Set([...ids, ...templateIds, ...live.map((t) => t.id)])];
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

    // A goal with nothing linked is at 0%, not 100% — guard so an empty goal
    // can't auto-complete itself. This used to also spare goals carrying a
    // session target; with progress task-denominated, having a target changes
    // nothing, and keeping the clause read as though it might.
    if (c.linkedTaskCount === 0) continue;

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
      completedTaskCount: progress.completedTaskCount,
      linkedTaskCount: progress.linkedTaskCount,
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

/**
 * Verify EVERY task in the set belongs to this user, before any of them is
 * written. The mirror image of userOwnsGoal, for the bulk link/unlink endpoint.
 *
 * All-or-nothing on purpose: a partial link that silently skipped the ids it did
 * not like would leave the client believing it saved something it did not. One
 * count query regardless of set size.
 *
 * Duplicate ids in the input are deduped first, so `['a','a']` cannot fail the
 * count check against a single real row.
 */
export async function userOwnsTasks(
  userId: string,
  taskIds: string[],
): Promise<boolean> {
  const unique = [...new Set(taskIds)];
  if (unique.length === 0) return true;
  const found = await prisma.task.count({ where: { id: { in: unique }, userId } });
  return found === unique.length;
}
