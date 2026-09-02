import type { Task, TaskGoal } from '../types';
import type { SessionRecord } from '../store/sync';
import { daysUntilDue, getLocalDateString } from '../utils/date';

/**
 * Which hero card the Tasks tab should lead with, and who is eligible for the
 * urgency card.
 *
 * Split out of hooks/useHeroCard.ts so it can be unit-tested. That hook imports
 * expo-router and stores/gamificationStore at module scope, and the mobile
 * vitest project runs under plain Node with react-native imports forbidden, so
 * none of this was reachable from a test where it used to live. The type-only
 * imports above are load-bearing for the same reason: store/sync pulls
 * AsyncStorage at module scope, and only `import type` erases it.
 *
 * The hook keeps the store read, the manual override, and the focus reset. This
 * file holds the decisions.
 */

export type HeroCardType =
  | 'urgency'
  | 'goal_progress'
  | 'time_nudge'
  | 'momentum'
  | 'self_comparison'
  | 'recent_activity';

export const CARD_ORDER: HeroCardType[] = [
  'momentum',
  'goal_progress',
  'time_nudge',
  'self_comparison',
  'recent_activity',
  'urgency',
];

// ─── Pure date helpers ────────────────────────────────────────────────────────

function isTodayLocal(ts: number): boolean {
  return getLocalDateString(new Date(ts)) === getLocalDateString(new Date());
}

function diffMinutes(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 60_000);
}

/**
 * The urgency window, in whole calendar days from today.
 *
 * `lead` is how close something must be for urgency to WIN the rotation;
 * `rotation` is how close it must be for the card to EXIST in it. Two different
 * numbers for two different questions, which is why they were drifting apart in
 * three separate copies of this predicate — one here, one in the availableCards
 * filter, one inside UrgencyCard itself.
 */
export const URGENCY_WINDOW = { lead: 3, rotation: 6 } as const;

/**
 * Whether a task belongs on the urgency card, given how far off it is.
 *
 * `daysUntil` is a parameter rather than recomputed because the caller has
 * already paid for it and because the recurring rule needs it.
 *
 * That recurring rule mirrors getDueChip (taskMetrics.ts:51-53) exactly, and the
 * exactness matters: a past-due recurring instance is a stale row awaiting the
 * next spawn, not a missed deadline, so it is excluded — but a recurring instance
 * due TODAY is a habit you still have time to do, and it stays. Excluding
 * recurring tasks outright would silently drop today's habits from the card.
 * None of the three copies of this predicate had the rule in either form.
 */
export function isUrgencyEligible(task: Task, daysUntil: number): boolean {
  if (task.isCompleted || task.isArchived) return false;
  if (task.parentTaskId && daysUntil < 0) return false;
  return true;
}

/** True when any task falls inside `horizon` days. Shares one rule with the card. */
export function hasUrgentTask(tasks: Task[], now: Date, horizon: number): boolean {
  return tasks.some((t) => {
    const d = daysUntilDue(t.dueDate, now);
    return d !== null && d >= 0 && d <= horizon && isUrgencyEligible(t, d);
  });
}

// ─── Pure selection function — NO store reads ─────────────────────────────────

// Note: 'recent_activity' is deliberately absent from the priority chain below.
// Every other card is a nudge — it asks for an action right now. The activity log
// is a backward-looking record, so it earns a place in the rotation (swipe or tap
// a dot) but never preempts a card that is trying to get the user working.
export function selectHeroCard(params: {
  tasks: Task[];
  goals: TaskGoal[];
  sessionHistory: SessionRecord[];
  currentStreak: number;
  peakHour: number | null;
  now?: Date;
}): HeroCardType {
  const { tasks, goals, sessionHistory, currentStreak, peakHour, now = new Date() } = params;
  const hour = now.getHours();

  // Priority 1 — Urgency. One shared predicate with the rotation filter and the
  // card itself, so the three can no longer disagree about who is urgent.
  if (hasUrgentTask(tasks, now, URGENCY_WINDOW.lead)) return 'urgency';

  // Priority 2 — Time nudge: within ±30 min of peak hour, no session in last 60 min
  if (peakHour !== null && sessionHistory.length >= 5) {
    const nowMins = hour * 60 + now.getMinutes();
    const peakMins = peakHour * 60;
    const diff = Math.min(Math.abs(nowMins - peakMins), 1440 - Math.abs(nowMins - peakMins));
    const withinWindow = diff <= 30;
    const todaySessions = sessionHistory
      .filter((s) => isTodayLocal(s.completedAt))
      .sort((a, b) => b.completedAt - a.completedAt);
    const minsSinceLast = todaySessions[0]
      ? diffMinutes(now, new Date(todaySessions[0].completedAt))
      : Infinity;
    if (withinWindow && minsSinceLast > 60) return 'time_nudge';
  }

  // Priority 3 — Goal progress: 10am–6pm, active goals exist
  const activeGoals = goals.filter((g) => !g.isCompleted && !g.isArchived);
  if (hour >= 10 && hour < 18 && activeGoals.length > 0) return 'goal_progress';

  // Priority 4 — Momentum: morning or Mon/Tue and streak active
  const day = now.getDay();
  if (((hour >= 6 && hour < 10) || day === 1 || day === 2) && currentStreak > 0) {
    return 'momentum';
  }

  return 'self_comparison';
}
