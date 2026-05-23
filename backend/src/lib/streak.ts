function toDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function updateStreak(
  lastActiveDate: Date | null,
  currentStreak: number,
  longestStreak: number,
  sessionCompletedAt: Date,
): { streak: number; longestStreak: number; isNewDay: boolean } {
  const today = toDateString(sessionCompletedAt);
  const lastActive = lastActiveDate ? toDateString(lastActiveDate) : null;

  if (lastActive === today) {
    return { streak: currentStreak, longestStreak, isNewDay: false };
  }

  const yesterdayDate = new Date(sessionCompletedAt);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = toDateString(yesterdayDate);

  let newStreak: number;
  if (lastActive === yesterday) {
    newStreak = currentStreak + 1;
  } else {
    newStreak = 1;
  }

  const newLongest = Math.max(longestStreak, newStreak);
  return { streak: newStreak, longestStreak: newLongest, isNewDay: true };
}
