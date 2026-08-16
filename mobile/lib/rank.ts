/**
 * Rank — the PUBLIC, social-facing tier.
 *
 * Rank and Level are not competing progressions: both are derived from the same
 * single `User.xp` number, at different resolutions and for different audiences.
 *
 *   Level (lib/xp.ts on the backend) — fine-grained, 1..N, private. "You are
 *   level 7." It is what the XP bar fills toward.
 *
 *   Rank (this file)                 — five coarse tiers, public. It is what
 *   other people see next to your name on posts and leaderboards.
 *
 * Think "Level 47, Gold division": one number, two readouts. The thresholds here
 * MUST stay identical to getRankTitle() in backend/src/modules/social/routes.ts —
 * that function stamps the rank onto every post and leaderboard row, so if the
 * two drift a user sees one rank on their profile and a different one on their
 * own post.
 */
export const RANK_ORDER = ['Rookie', 'Steady', 'Elite', 'Legend', 'Champion'] as const;
export type RankTier = (typeof RANK_ORDER)[number];

export const RANK_THRESHOLDS: Record<RankTier, number> = {
  Rookie: 0,
  Steady: 1000,
  Elite: 2500,
  Legend: 5000,
  Champion: 10000,
};

export const RANK_META: Record<RankTier, { icon: string; label: string }> = {
  Rookie: { icon: '🌱', label: 'Rookie' },
  Steady: { icon: '📈', label: 'Steady' },
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
