/**
 * The leaderboard tile on You's Community card (design DD13).
 *
 * It shows the user's global all-time position as "#4 on Leaderboard" only when
 * there is one to show. Opted out of the leaderboard, not ranked yet, still
 * loading, or the request failed: the tile reads "Leaderboard" with a trophy
 * and no number. It still opens the Leaderboard tab either way.
 */
export type RankFetch =
  | { status: 'loading' }
  | { status: 'loaded'; position: number | null }
  | { status: 'error' };

/** The position to print on the tile, or null for the plain "Leaderboard" tile. */
export function leaderboardTilePosition(optedOut: boolean, rank: RankFetch): number | null {
  if (optedOut || rank.status !== 'loaded') return null;
  return rank.position != null && rank.position > 0 ? rank.position : null;
}
