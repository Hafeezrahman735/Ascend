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

export function calculateLevel(totalXP: number): number {
  if (totalXP < 100) return 1;
  if (totalXP < 250) return 2;
  if (totalXP < 500) return 3;
  if (totalXP < 1000) return 4;
  if (totalXP < 2000) return 5;
  if (totalXP < 3500) return 6;
  if (totalXP < 5500) return 7;
  if (totalXP < 8000) return 8;
  if (totalXP < 12000) return 9;

  let level = 10;
  let threshold = 12000;
  while (true) {
    const nextThreshold = threshold + (level + 1) * 1500;
    if (totalXP < nextThreshold) return level;
    level++;
    threshold = nextThreshold;
  }
}

export function xpForLevel(level: number): number {
  const thresholds = [0, 0, 100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000];
  if (level <= 10) return thresholds[level] ?? 0;
  let prev = 12000;
  for (let l = 10; l < level; l++) {
    prev = prev + (l + 1) * 1500;
  }
  return prev;
}

export function xpForNextLevel(totalXP: number): number {
  const currentLevel = calculateLevel(totalXP);
  return xpForLevel(currentLevel + 1);
}

export function getLevelTitle(level: number): string {
  const titles: Record<number, string> = {
    1: 'Beginner', 2: 'Novice', 3: 'Apprentice', 4: 'Focused',
    5: 'Committed', 6: 'Dedicated', 7: 'Expert', 8: 'Master',
    9: 'Elite', 10: 'Legend',
  };
  if (level >= 11) return 'Grandmaster';
  return titles[level] || 'Beginner';
}

export function progressToNextLevel(totalXP: number): number {
  const currentLevel = calculateLevel(totalXP);
  const currentThreshold = xpForLevel(currentLevel);
  const nextThreshold = xpForLevel(currentLevel + 1);
  if (nextThreshold <= currentThreshold) return 1;
  return Math.min(1, (totalXP - currentThreshold) / (nextThreshold - currentThreshold));
}
