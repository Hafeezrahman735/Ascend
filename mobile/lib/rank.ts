export const RANK_ORDER = ['Rookie', 'Scholar', 'Elite', 'Legend', 'Champion'] as const;
export type RankTier = (typeof RANK_ORDER)[number];

export const RANK_THRESHOLDS: Record<RankTier, number> = {
  Rookie: 0,
  Scholar: 1000,
  Elite: 2500,
  Legend: 5000,
  Champion: 10000,
};

export const RANK_META: Record<RankTier, { icon: string; label: string }> = {
  Rookie: { icon: '🌱', label: 'Rookie' },
  Scholar: { icon: '📖', label: 'Scholar' },
  Elite: { icon: '⚡', label: 'Elite' },
  Legend: { icon: '🏆', label: 'Legend' },
  Champion: { icon: '👑', label: 'Champion' },
};

export function getRank(xp: number): RankTier {
  let rank: RankTier = 'Rookie';
  for (const tier of RANK_ORDER) {
    if (xp >= RANK_THRESHOLDS[tier]) rank = tier;
  }
  return rank;
}

export function getXpToNextRank(xp: number): number {
  const current = getRank(xp);
  const idx = RANK_ORDER.indexOf(current);
  if (idx >= RANK_ORDER.length - 1) return 0;
  return Math.max(0, RANK_THRESHOLDS[RANK_ORDER[idx + 1]] - xp);
}

export function getXpProgressInRank(xp: number): number {
  const current = getRank(xp);
  const idx = RANK_ORDER.indexOf(current);
  if (idx >= RANK_ORDER.length - 1) return 1;
  const tierStart = RANK_THRESHOLDS[current];
  const tierEnd = RANK_THRESHOLDS[RANK_ORDER[idx + 1]];
  if (tierEnd <= tierStart) return 1;
  return Math.min(1, (xp - tierStart) / (tierEnd - tierStart));
}
