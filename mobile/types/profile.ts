export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  studiedToday: boolean;
  thisWeekDays: boolean[];
  streakAtRisk: boolean;
}

export type BadgeLevel = 'locked' | 'bronze' | 'silver' | 'gold';

export interface CategoryBadge {
  tag: string;
  icon: string;
  level: BadgeLevel;
  sessionCount: number;
}

export const BADGE_THRESHOLDS = {
  bronze: 10,
  silver: 30,
  gold: 75,
} as const;
