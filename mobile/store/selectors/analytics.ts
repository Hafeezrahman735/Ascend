export interface FocusStatSnapshot {
  totalSessions: number;
  totalMinutes: number;
  currentStreak: number;
  longestStreak: number;
  level: number;
  xp: number;
}

export function calcFocusStats(
  totalSessions: number,
  totalMinutes: number,
  currentStreak: number,
  longestStreak: number,
  level: number,
  xp: number,
): FocusStatSnapshot {
  return {
    totalSessions,
    totalMinutes,
    currentStreak,
    longestStreak,
    level,
    xp,
  };
}
