export function calculateXP(elapsedSeconds: number, currentStreak: number): number {
  const baseXP = Math.floor(elapsedSeconds / 60) * 10;

  let multiplier: number;
  if (currentStreak >= 30) multiplier = 2.0;
  else if (currentStreak >= 14) multiplier = 1.75;
  else if (currentStreak >= 7) multiplier = 1.5;
  else if (currentStreak >= 3) multiplier = 1.25;
  else multiplier = 1.0;

  return Math.floor(baseXP * multiplier);
}

/**
 * XP for finishing a task, scaled by priority.
 *
 * Until now XP came only from /timer/complete, so the app rewarded *time spent*
 * and never *things finished* — odd for a task-and-goal centred product. These
 * are deliberately modest next to session XP (a 25-minute session is 250 XP at
 * 1x): completing work should feel acknowledged without making it more
 * efficient to churn trivial tasks than to actually focus.
 */
export const TASK_COMPLETION_XP: Record<string, number> = {
  low: 10,
  medium: 20,
  high: 35,
  urgent: 50,
};

export function taskCompletionXP(priority: string): number {
  return TASK_COMPLETION_XP[priority] ?? TASK_COMPLETION_XP.medium;
}

/**
 * XP for completing a goal. Larger than any single task because a goal
 * represents the whole body of work underneath it.
 */
export const GOAL_COMPLETION_XP = 150;
