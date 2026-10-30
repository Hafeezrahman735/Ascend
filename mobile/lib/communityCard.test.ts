import { describe, expect, it } from 'vitest';
import { leaderboardTilePosition } from './communityCard';

describe('leaderboardTilePosition', () => {
  it('shows the position when ranked', () => {
    expect(leaderboardTilePosition(false, { status: 'loaded', position: 4 })).toBe(4);
  });

  it('shows no number while loading', () => {
    expect(leaderboardTilePosition(false, { status: 'loading' })).toBeNull();
  });

  it('never shows a number to someone opted out of the leaderboard', () => {
    expect(leaderboardTilePosition(true, { status: 'loaded', position: 4 })).toBeNull();
  });

  it('shows no number before the user has a position', () => {
    expect(leaderboardTilePosition(false, { status: 'loaded', position: null })).toBeNull();
    expect(leaderboardTilePosition(false, { status: 'loaded', position: 0 })).toBeNull();
  });

  it('shows no number when the request failed', () => {
    expect(leaderboardTilePosition(false, { status: 'error' })).toBeNull();
  });
});
