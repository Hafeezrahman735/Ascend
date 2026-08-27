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
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export const RANK_ORDER = ['Rookie', 'Steady', 'Elite', 'Legend', 'Champion'] as const;
export type RankTier = (typeof RANK_ORDER)[number];

export const RANK_THRESHOLDS: Record<RankTier, number> = {
  Rookie: 0,
  Steady: 1000,
  Elite: 2500,
  Legend: 5000,
  Champion: 10000,
};

/**
 * Rank icons are Ionicons glyph names, not emoji.
 *
 * Emoji render in whatever the platform's emoji font decides, cannot take a
 * colour or a stroke weight, and announce to VoiceOver as their Unicode name
 * ("seedling") rather than as the rank. The type is imported for its shape
 * only, so this stays a logic module with no runtime UI dependency.
 */
export type RankIcon = ComponentProps<typeof Ionicons>['name'];

export const RANK_META: Record<RankTier, { icon: RankIcon; label: string }> = {
  Rookie: { icon: 'leaf-outline', label: 'Rookie' },
  Steady: { icon: 'trending-up', label: 'Steady' },
  Elite: { icon: 'flash', label: 'Elite' },
  Legend: { icon: 'trophy', label: 'Legend' },
  Champion: { icon: 'diamond', label: 'Champion' },
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
