import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { RANK_ORDER, RANK_THRESHOLDS, getRankTitle } from './rank';

/**
 * Rank thresholds exist twice: here, and in mobile/lib/rank.ts. The client owns
 * a copy because it renders the whole ladder (tier chips, "next rank" cost) and
 * the two packages share no module.
 *
 * mobile/lib/rank.ts has always carried a comment saying the two "MUST stay
 * identical" — enforced by nothing. If they drift, a user sees one rank on their
 * profile and a different one stamped on their own post, and no test, type or
 * log catches it.
 *
 * This reads the client file and fails on divergence. It is a drift detector,
 * not single-sourcing: the real fix is to serve the ladder from the profile
 * payload and delete the client table.
 */
const CLIENT_RANK_PATH = path.resolve(__dirname, '../../../mobile/lib/rank.ts');

function parseClientThresholds(source: string): Record<string, number> {
  // Matches the RANK_THRESHOLDS object literal body, then each `Name: 1234,` pair.
  const block = source.match(/RANK_THRESHOLDS[^=]*=\s*\{([^}]*)\}/);
  if (!block) throw new Error('Could not find RANK_THRESHOLDS in mobile/lib/rank.ts');

  const out: Record<string, number> = {};
  for (const [, name, value] of block[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) {
    out[name] = Number(value);
  }
  return out;
}

function parseClientOrder(source: string): string[] {
  const block = source.match(/RANK_ORDER\s*=\s*\[([^\]]*)\]/);
  if (!block) throw new Error('Could not find RANK_ORDER in mobile/lib/rank.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('rank thresholds stay in sync with the mobile client', () => {
  const source = readFileSync(CLIENT_RANK_PATH, 'utf8');

  it('finds the client table (guards against a silent parse failure)', () => {
    // If mobile/lib/rank.ts is restructured, this test must fail loudly rather
    // than quietly comparing an empty object and passing.
    expect(Object.keys(parseClientThresholds(source))).toHaveLength(RANK_ORDER.length);
  });

  it('has the same tiers in the same order', () => {
    expect(parseClientOrder(source)).toEqual([...RANK_ORDER]);
  });

  it('has identical thresholds', () => {
    expect(parseClientThresholds(source)).toEqual(RANK_THRESHOLDS);
  });
});

describe('getRankTitle', () => {
  it('returns the tier at each exact threshold', () => {
    expect(getRankTitle(0)).toBe('Rookie');
    expect(getRankTitle(1000)).toBe('Steady');
    expect(getRankTitle(2500)).toBe('Elite');
    expect(getRankTitle(5000)).toBe('Legend');
    expect(getRankTitle(10000)).toBe('Champion');
  });

  it('stays on the lower tier one point below each threshold', () => {
    expect(getRankTitle(999)).toBe('Rookie');
    expect(getRankTitle(2499)).toBe('Steady');
    expect(getRankTitle(9999)).toBe('Legend');
  });

  it('handles zero and absurd values', () => {
    expect(getRankTitle(0)).toBe('Rookie');
    expect(getRankTitle(-100)).toBe('Rookie');
    expect(getRankTitle(10_000_000)).toBe('Champion');
  });
});
