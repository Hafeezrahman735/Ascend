/**
 * Everything a goal's stats surface says, derived from the goal alone.
 *
 * Pure and free of react-native imports so the Node-only vitest config can
 * reach it — the same reason `calendarItems.ts` and `phaseDuration.ts` exist.
 * The modal is a rendering of these functions and holds no logic of its own.
 *
 * The content rules, which are the actual feature:
 *
 *   1. Every line carries a number from THIS goal. Generic praise reads as a
 *      fortune cookie by the second time you see it.
 *   2. No adjectives about the user. Never "great", never "crushing it", never
 *      an exclamation mark. The numbers are allowed to be good; we are not
 *      allowed to say so.
 *   3. Below 25% progress, or past the deadline, the line ends in an ACTION and
 *      never an assessment. A struggling user needs something to do, not a
 *      measurement of how badly it is going.
 *
 * Rule 3 is why this file can be trusted on a failing goal. A stats screen that
 * only knows how to report is cruel to exactly the people it most needs to
 * reach.
 */

import type { TaskGoal } from '../types';

/** A week, in days. Named because it appears in three different thresholds. */
const DAYS_PER_WEEK = 7;

/** A goal is "stalled" once this many days pass with no session logged. */
export const STALLED_AFTER_DAYS = 7;

/** Below this, the encouragement line must offer an action, not a verdict. */
export const STRUGGLING_BELOW_PROGRESS = 0.25;

/** A goal must be this share of lifetime focus before the stat is worth showing. */
export const SHARE_OF_LIFE_FLOOR = 0.1;

/**
 * Duration for display. Moved here from `tasks.tsx` so the modal and the task
 * row cannot drift apart, and so it is covered by a test.
 *
 * Non-finite input returns '0m' rather than the string "NaNm". That is not
 * hypothetical: goals are hydrated from an unvalidated AsyncStorage cache, so
 * a cache written before a field existed hands `undefined` straight to a
 * formatter. `goalStore.normaliseCachedGoal` is the real fix; this is the
 * backstop for the next field somebody adds.
 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Whole days from `now` until a 'YYYY-MM-DD' deadline. Negative once passed.
 *
 * Deliberately not `utils/date.daysUntilLocalDate`, which reads the clock
 * itself: every branch below is time-dependent, and a helper that cannot be
 * pinned to an instant cannot be tested. Both compare UTC midnights so the
 * subtraction is exact whole days and never crosses a DST boundary.
 */
export function daysUntil(deadline: string | null, now: Date): number | null {
  if (!deadline) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * This goal's share of every minute the user has ever focused, 0..1.
 *
 * Note the unit conversion. `totalFocusSeconds` is SECONDS and
 * `gamificationStore.totalFocusMinutes` is MINUTES — dividing one by the other
 * directly is wrong by a factor of 60, which is exactly the bug the first draft
 * of this feature shipped in its spec.
 *
 * Returns null when there is nothing to compare against (a new account has zero
 * lifetime focus, and x/0 is not a percentage) or when the share is too small
 * to be worth the space.
 */
export function shareOfLifetimeFocus(
  goal: TaskGoal,
  totalFocusMinutes: number,
): number | null {
  if (!Number.isFinite(totalFocusMinutes) || totalFocusMinutes <= 0) return null;
  const goalMinutes = goal.totalFocusSeconds / 60;
  const share = goalMinutes / totalFocusMinutes;
  if (!Number.isFinite(share) || share < SHARE_OF_LIFE_FLOOR) return null;
  return Math.min(1, share);
}

export interface GoalPace {
  daysLeft: number;
  /** True when the current rate finishes before the deadline. */
  onTrack: boolean;
  /** Units per week needed to land on time, at least 1. */
  perWeekNeeded: number;
  /** What `perWeekNeeded` counts, so the copy can name it honestly. */
  unit: 'session' | 'task';
}

/**
 * Whether the current rate lands this goal before its deadline.
 *
 * Returns null whenever a projection would be dishonest rather than merely
 * pessimistic: no deadline to measure against, no elapsed time to derive a rate
 * from, or no progress at all. A goal created today has `elapsedDays === 0`,
 * and dividing by it yields Infinity — that is the day-one state of every goal
 * ever made, so it is the guard that matters most.
 */
export function goalPace(goal: TaskGoal, now: Date): GoalPace | null {
  const daysLeft = daysUntil(goal.deadline, now);
  if (daysLeft === null || daysLeft <= 0) return null;
  if (goal.elapsedDays < 1) return null;
  if (goal.overallProgress <= 0 || goal.overallProgress >= 1) return null;

  const progressPerDay = goal.overallProgress / goal.elapsedDays;
  if (progressPerDay <= 0) return null;
  const daysNeeded = (1 - goal.overallProgress) / progressPerDay;

  // Count in whatever this goal actually measures. Converting tasks into
  // sessions would mean inventing a rate the data does not contain.
  const useSessions = goal.targetSessions != null && goal.progressMode !== 'tasks';
  const remaining = useSessions
    ? Math.max(0, (goal.targetSessions ?? 0) - goal.actualSessions)
    : Math.max(0, goal.linkedTaskCount - goal.completedTaskCount);

  const weeksLeft = Math.max(daysLeft / DAYS_PER_WEEK, 1 / DAYS_PER_WEEK);

  return {
    daysLeft,
    onTrack: daysNeeded <= daysLeft,
    perWeekNeeded: Math.max(1, Math.ceil(remaining / weeksLeft)),
    unit: useSessions ? 'session' : 'task',
  };
}

export type GoalStatusAction = 'link-task' | 'change-deadline' | 'start-session';

export interface GoalStatusLine {
  text: string;
  /** Rendered as an inline button. Present whenever rule 3 applies. */
  action?: GoalStatusAction;
}

export interface GoalStatsContext {
  now: Date;
  /** Lifetime focus MINUTES, from `gamificationStore.totalFocusMinutes`. */
  totalFocusMinutes: number;
  /** Epoch ms of the newest session on this goal's tasks, or null if unknown. */
  lastSessionAt: number | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The one sentence at the top of the modal, chosen by priority — first match
 * wins.
 *
 * Order is the design, not an implementation detail. The two that must outrank
 * the cheerful branches are `deadline passed` and `stalled`: a user who is
 * one session in AND three weeks past their deadline should be offered a way
 * out, not congratulated on having started. "First session logged, that's the
 * hardest one" is true and warm and would read as mockery in that state, so it
 * sits below both.
 */
export function goalStatusLine(goal: TaskGoal, ctx: GoalStatsContext): GoalStatusLine {
  const done = goal.completedTaskCount;
  const total = goal.linkedTaskCount;
  const focus = formatSeconds(goal.totalFocusSeconds);
  const daysLeft = daysUntil(goal.deadline, ctx.now);

  // 1. Finished. The only branch allowed to look backwards, and the only one
  //    that may show elapsedDays.
  if (goal.isCompleted) {
    const span = goal.elapsedDays === 0 ? 'in a day' : `in ${plural(goal.elapsedDays, 'day')}`;
    return { text: `Done ${span}. ${plural(total, 'task')}, ${plural(goal.actualSessions, 'session')}, ${focus} of focus.` };
  }

  // 2. Nothing linked. The goal cannot track anything yet, so this is a setup
  //    problem and no number would mean anything.
  if (total === 0 && goal.actualSessions === 0) {
    return {
      text: 'Nothing linked yet — link a task and this starts tracking.',
      action: 'link-task',
    };
  }

  // 3. Linked but never worked on.
  if (goal.actualSessions === 0) {
    return {
      text: `${plural(total, 'task')} waiting. One session gets this moving.`,
      action: 'start-session',
    };
  }

  // 4. Past the deadline. Outranks every encouraging branch below.
  if (daysLeft !== null && daysLeft < 0) {
    return {
      text: `Past the deadline, ${done} of ${total} done. Move the date or cut the scope.`,
      action: 'change-deadline',
    };
  }

  // 5. Stalled. Names the gap without characterising it, then points forward.
  if (ctx.lastSessionAt !== null) {
    const idleDays = Math.floor((ctx.now.getTime() - ctx.lastSessionAt) / 86_400_000);
    if (idleDays >= STALLED_AFTER_DAYS) {
      return {
        text: `Last session ${plural(idleDays, 'day')} ago. ${done} of ${total} done, ${Math.max(0, total - done)} to go.`,
        action: 'start-session',
      };
    }
  }

  // 6. Exactly one session in, and not in trouble by any measure above.
  if (goal.actualSessions === 1) {
    return { text: "First session logged. That's the hardest one." };
  }

  // 7 & 8. On or behind pace. Both name the same two numbers; only the second
  //        half differs, and neither half praises.
  const pace = goalPace(goal, ctx.now);
  if (pace) {
    if (pace.onTrack) {
      return { text: `${done} of ${total} done with ${plural(pace.daysLeft, 'day')} left — this pace finishes early.` };
    }
    return {
      text: `${done} of ${total} done, ${plural(pace.daysLeft, 'day')} left. ${plural(pace.perWeekNeeded, pace.unit)} a week closes it.`,
      action: goal.overallProgress < STRUGGLING_BELOW_PROGRESS ? 'start-session' : undefined,
    };
  }

  // 9. No deadline, or too early to project. State the effort and stop.
  return { text: `${focus} banked across ${plural(goal.actualSessions, 'session')}.` };
}

/**
 * When this goal's tasks were last worked on, epoch ms, or null.
 *
 * Structurally typed rather than importing `Task` and `SessionRecord`, because
 * `store/sync` pulls in AsyncStorage and this file has to stay reachable from
 * the Node-only test runner.
 *
 * KNOWN GAP, and the reason this only ever feeds the "stalled" branch: the join
 * runs through the client's task list, which excludes ARCHIVED tasks. Recurring
 * habits archive yesterday's instance every day, so sessions logged against
 * those instances are invisible here — the server's `totalFocusSeconds` counts
 * them and this does not. A goal driven entirely by a habit can therefore look
 * stalled while its focus time is still climbing. Acceptable for choosing one
 * sentence; NOT acceptable for anything numeric, which is why no displayed
 * total is derived from this.
 */
export function lastSessionOnGoal(
  goalId: string | null,
  tasks: { id: string; taskGoalId?: string | null }[],
  sessions: { taskId: string | null; completedAt: number; type: 'focus' | 'break' }[],
): number | null {
  if (!goalId) return null;

  const taskIds = new Set(
    tasks.filter((t) => t.taskGoalId === goalId).map((t) => t.id),
  );
  if (taskIds.size === 0) return null;

  let newest: number | null = null;
  for (const s of sessions) {
    if (s.type !== 'focus' || !s.taskId || !taskIds.has(s.taskId)) continue;
    if (newest === null || s.completedAt > newest) newest = s.completedAt;
  }
  return newest;
}

export interface GoalStatCell {
  key: 'tasks' | 'sessions' | 'avgSession' | 'shareOfLife';
  label: string;
  value: string;
  sub?: string;
}

/**
 * The 2-4 supporting cells, gated by `progressMode`.
 *
 * The gating mirrors `goalSubMetrics` in `tasks.tsx` exactly, and must keep
 * doing so. A fixed grid regresses it in both directions: a sessions-only goal
 * renders "0/0 tasks", and a goal with no session target renders "4/null
 * sessions". Neither is a number anybody can act on.
 */
export function goalStatCells(goal: TaskGoal, ctx: GoalStatsContext): GoalStatCell[] {
  const cells: GoalStatCell[] = [];

  if (goal.progressMode !== 'sessions') {
    cells.push({
      key: 'tasks',
      label: 'TASKS',
      value: `${goal.completedTaskCount}/${goal.linkedTaskCount}`,
      sub: 'completed',
    });
  }

  if (goal.progressMode !== 'tasks' && goal.targetSessions) {
    cells.push({
      key: 'sessions',
      label: 'SESSIONS',
      value: `${goal.actualSessions}/${goal.targetSessions}`,
      sub: 'toward target',
    });
  } else if (goal.actualSessions > 0) {
    // No target to measure against, but the count is still worth showing.
    cells.push({ key: 'sessions', label: 'SESSIONS', value: String(goal.actualSessions) });
  }

  if (goal.actualSessions > 0) {
    cells.push({
      key: 'avgSession',
      label: 'AVG SESSION',
      value: formatSeconds(Math.round(goal.totalFocusSeconds / goal.actualSessions)),
    });
  }

  const share = shareOfLifetimeFocus(goal, ctx.totalFocusMinutes);
  if (share !== null) {
    cells.push({
      key: 'shareOfLife',
      label: 'OF ALL FOCUS',
      value: `${Math.round(share * 100)}%`,
      sub: 'you have ever logged',
    });
  }

  return cells;
}
