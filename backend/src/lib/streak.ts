// All date comparisons use the client-supplied local date string (YYYY-MM-DD)
// so streaks reflect the user's local calendar day, not UTC.

function toLocalDateStr(date: Date): string {
  // date is stored as midnight UTC of the local date, so UTC methods give back the correct date.
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function updateStreak(
  lastActiveDate: Date | null,
  currentStreak: number,
  longestStreak: number,
  localDate: string, // YYYY-MM-DD in the user's local timezone
): { streak: number; longestStreak: number; isNewDay: boolean } {
  const lastActive = lastActiveDate ? toLocalDateStr(lastActiveDate) : null;

  if (lastActive === localDate) {
    return { streak: currentStreak, longestStreak, isNewDay: false };
  }

  const yesterday = addDays(localDate, -1);

  let newStreak: number;
  if (lastActive === yesterday) {
    newStreak = currentStreak + 1;
  } else {
    newStreak = 1;
  }

  const newLongest = Math.max(longestStreak, newStreak);
  return { streak: newStreak, longestStreak: newLongest, isNewDay: true };
}
