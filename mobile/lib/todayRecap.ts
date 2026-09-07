import { isToday } from './taskMetrics';
import type { Task } from '../types';
import type { SessionRecord } from '../store/sync';

/**
 * The numbers on your own recap card: what today looks like so far.
 *
 * Computed on the device from the local session cache and task list rather than
 * fetched. That is deliberate, and it is what makes the landing screen work for
 * somebody who has just installed the app: the card is there on the first frame,
 * with no request, no spinner and no empty feed — even offline, and even before
 * the server has ever heard of them.
 *
 * The server computes the same four numbers independently for the post other
 * people see (backend src/modules/social/dailyRecapPost.ts). Two derivations of one
 * thing is a real risk — it is exactly how the Tasks screen's category totals
 * once drifted from the server's — so the rule is that this side is only ever
 * used to draw YOUR OWN card, and the server's numbers are what anyone else
 * reads. Neither one is ever corrected against the other.
 */

export interface TodayRecap {
  sessionCount: number;
  focusSeconds: number;
  tasksCompleted: number;
  streakDays: number;
}

export function computeTodayRecap(input: {
  sessionHistory: SessionRecord[];
  tasks: Task[];
  currentStreak: number;
}): TodayRecap {
  const { sessionHistory, tasks, currentStreak } = input;

  let sessionCount = 0;
  let focusSeconds = 0;
  for (const s of sessionHistory) {
    if (s.type !== 'focus') continue;
    if (!isToday(s.completedAt)) continue;
    sessionCount += 1;
    focusSeconds += s.durationSeconds;
  }

  // Archived tasks still count. Finishing something and then filing it away is
  // still having finished it, and dropping it would make the number fall during
  // the day — which reads as the app losing your work.
  let tasksCompleted = 0;
  for (const t of tasks) {
    if (!t.isCompleted || !t.completedAt) continue;
    if (isToday(new Date(t.completedAt).getTime())) tasksCompleted += 1;
  }

  return { sessionCount, focusSeconds, tasksCompleted, streakDays: currentStreak };
}

/** True when nothing has happened yet today — drives the "no recap yet" copy. */
export function isRecapEmpty(recap: TodayRecap): boolean {
  return recap.sessionCount === 0 && recap.tasksCompleted === 0;
}

/**
 * Durations as the cards render them: "25m", "1h", "1h 15m".
 *
 * Never "0h 25m" and never "1h 0m" — the card is a receipt, and a receipt does
 * not print a zero it does not need.
 */
export function formatRecapDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
