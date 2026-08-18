/**
 * Rank — the public, social-facing tier derived from a user's XP.
 *
 * This is the backend's single definition. It was previously inlined in
 * modules/social/routes.ts, which stamps `authorRank` onto every post and
 * leaderboard row, while mobile/lib/rank.ts carried a second copy of the same
 * five thresholds. Two copies of one table meant a user could see one rank on
 * their profile and a different one on their own post.
 *
 * The client copy still exists, because the client renders the whole ladder
 * (tier chips, "next rank" cost) and there is no shared module between the two
 * packages. What stops them drifting now is rank.drift.test.ts, which reads
 * mobile/lib/rank.ts and fails if the numbers disagree. Making the server
 * authoritative and deleting the client table is the real fix; it needs the
 * ladder in the profile payload and touches five screens, so it is deliberately
 * separate work.
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

/** Highest tier whose threshold the user has reached. */
export function getRankTitle(xp: number): RankTier {
  let rank: RankTier = 'Rookie';
  for (const tier of RANK_ORDER) {
    if (xp >= RANK_THRESHOLDS[tier]) rank = tier;
  }
  return rank;
}
