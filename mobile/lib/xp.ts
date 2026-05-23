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

export function progressToNextLevel(totalXP: number): number {
  const currentLevel = calculateLevel(totalXP);
  const currentThreshold = xpForLevel(currentLevel);
  const nextThreshold = xpForLevel(currentLevel + 1);
  if (nextThreshold <= currentThreshold) return 1;
  return Math.min(1, (totalXP - currentThreshold) / (nextThreshold - currentThreshold));
}
