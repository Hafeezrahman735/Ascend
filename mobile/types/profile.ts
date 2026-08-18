export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  studiedToday: boolean;
  thisWeekDays: boolean[];
  streakAtRisk: boolean;
}

// BadgeLevel / CategoryBadge / BADGE_THRESHOLDS were removed with the per-tag
// badge system (2026-08-18). It was a third progression concept alongside Level
// and Rank, computed client-side from task.sessionsOnTask, and it competed
// visually with the achievements row for the same space on the profile.
