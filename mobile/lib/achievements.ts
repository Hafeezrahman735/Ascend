import { RANK_ORDER } from './rank';
import type { RankTier } from './rank';

export type AchievementCategory = 'streak' | 'sessions' | 'focus' | 'goals' | 'rank';

export type AchievementMetric =
  | 'currentStreak'
  | 'longestStreak'
  | 'totalSessions'
  | 'totalFocusMinutes'
  | 'dailyGoalsHit'
  | 'sessionsInOneDay'
  | 'rank';

export interface CatalogEntry {
  key: string;
  icon: string;
  name: string;
  description: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  threshold: number | RankTier;
  xpReward: number;
  isGoldTier: boolean;
}

export const ACHIEVEMENT_CATALOGUE: CatalogEntry[] = [
  {
    key: 'streak_30',
    icon: '🔥',
    name: 'On Fire',
    description: 'Maintain a 30-day streak',
    category: 'streak',
    metric: 'longestStreak',
    threshold: 30,
    xpReward: 100,
    isGoldTier: true,
  },
  {
    key: 'streak_7',
    icon: '🌟',
    name: 'Week Warrior',
    description: 'Study 7 days in a row',
    category: 'streak',
    metric: 'currentStreak',
    threshold: 7,
    xpReward: 50,
    isGoldTier: false,
  },
  {
    key: 'power_hour',
    icon: '⚡',
    name: 'Power Hour',
    description: 'Complete 8 sessions in one day',
    category: 'sessions',
    metric: 'sessionsInOneDay',
    threshold: 8,
    xpReward: 100,
    isGoldTier: false,
  },
  {
    key: 'century',
    icon: '💯',
    name: 'Century',
    description: 'Log 100 sessions in a month',
    category: 'sessions',
    metric: 'totalSessions',
    threshold: 100,
    xpReward: 100,
    isGoldTier: false,
  },
  {
    key: 'focus_10h',
    icon: '🎯',
    name: 'Deep Diver',
    description: 'Study 10 hours in one week',
    category: 'focus',
    metric: 'totalFocusMinutes',
    threshold: 600,
    xpReward: 50,
    isGoldTier: false,
  },
  {
    key: 'goals_14',
    icon: '🏹',
    name: 'Sharpshooter',
    description: 'Hit daily goal 14 days in a row',
    category: 'goals',
    metric: 'dailyGoalsHit',
    threshold: 14,
    xpReward: 100,
    isGoldTier: false,
  },
  {
    key: 'rank_legend',
    icon: '🏆',
    name: 'Legend',
    description: 'Reach Legend rank',
    category: 'rank',
    metric: 'rank',
    threshold: 'Legend' as RankTier,
    xpReward: 200,
    isGoldTier: true,
  },
  {
    key: 'rank_champion',
    icon: '👑',
    name: 'Champion',
    description: 'Reach Champion rank',
    category: 'rank',
    metric: 'rank',
    threshold: 'Champion' as RankTier,
    xpReward: 500,
    isGoldTier: true,
  },
  {
    key: 'night_owl',
    icon: '🌙',
    name: 'Night Owl',
    description: 'Complete a session after 10pm',
    category: 'sessions',
    metric: 'sessionsInOneDay',
    threshold: 1,
    xpReward: 25,
    isGoldTier: false,
  },
  {
    key: 'sessions_500',
    icon: '🚀',
    name: 'Rocketship',
    description: 'Complete 500 total sessions',
    category: 'sessions',
    metric: 'totalSessions',
    threshold: 500,
    xpReward: 200,
    isGoldTier: true,
  },
];

export interface ProgressStats {
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusMinutes: number;
  rank: RankTier;
}

export function computeAchievementProgress(entry: CatalogEntry, stats: ProgressStats): number {
  if (entry.metric === 'rank') {
    const currentIdx = RANK_ORDER.indexOf(stats.rank);
    const targetIdx = RANK_ORDER.indexOf(entry.threshold as RankTier);
    if (targetIdx <= 0) return 1;
    return Math.min(1, currentIdx / targetIdx);
  }

  if (typeof entry.threshold !== 'number') return 0;

  switch (entry.metric) {
    case 'currentStreak':    return stats.currentStreak / entry.threshold;
    case 'longestStreak':    return stats.longestStreak / entry.threshold;
    case 'totalSessions':    return stats.totalSessions / entry.threshold;
    case 'totalFocusMinutes': return stats.totalFocusMinutes / entry.threshold;
    default:                 return 0;
  }
}
