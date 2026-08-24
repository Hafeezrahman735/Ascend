import { describe, it, expect } from 'vitest';
import { getSessionPlan, nextPlannedFocusSeconds, SESSION_PLAN_BOUNDS } from './sessionPlan';

const { GRANULARITY, MIN_BLOCK_MINUTES, MAX_BLOCK_MINUTES } = SESSION_PLAN_BOUNDS;

/**
 * The property test below is the one that matters most. The worked examples
 * came from the spec and only cover W = 25; the property sweep is what caught
 * the case where a 1-minute configured block length drives the block count high
 * enough to produce zero-length blocks — and a zero-length focus phase completes
 * on its own first tick, firing a network call per iteration forever.
 */
describe('getSessionPlan — invariants across the whole input space', () => {
  const blockLengths = [1, 5, 15, 25, 50, 90, 480];

  it('holds every invariant for every reachable input', () => {
    // Violations are collected and asserted once at the end rather than through
    // ~20k individual expect() calls. Each expect builds its failure message
    // eagerly, which made the sweep take longer than the 5s test timeout — the
    // assertions were the slow part, not the function under test.
    const violations: string[] = [];

    for (const W of blockLengths) {
      for (let remaining = 0; remaining <= 480; remaining += 1) {
        const at = `W=${W} r=${remaining}`;
        const plan = getSessionPlan(remaining, W);
        const rounded = Math.round(remaining / GRANULARITY) * GRANULARITY;

        if (rounded < MIN_BLOCK_MINUTES) {
          if (plan !== null) violations.push(`${at}: expected null, got ${JSON.stringify(plan)}`);
          continue;
        }

        if (plan === null) {
          violations.push(`${at}: expected a plan, got null`);
          continue;
        }
        if (plan.length === 0) {
          violations.push(`${at}: empty plan`);
          continue;
        }

        const sum = plan.reduce((a, b) => a + b, 0);
        if (sum !== rounded) violations.push(`${at}: sums to ${sum}, expected ${rounded}`);

        for (const block of plan) {
          if (block % GRANULARITY !== 0) violations.push(`${at}: block ${block} is not a multiple of ${GRANULARITY}`);
          if (block < MIN_BLOCK_MINUTES) violations.push(`${at}: block ${block} is under the ${MIN_BLOCK_MINUTES}min floor`);
          if (block > MAX_BLOCK_MINUTES) violations.push(`${at}: block ${block} exceeds the ${MAX_BLOCK_MINUTES}min server cap`);
        }
      }
    }

    expect(violations.slice(0, 20)).toEqual([]);
  });

  it('is front-loaded — longer blocks come first', () => {
    // The UI announces "Session 1 of 3 - 25 min", so ordering is a contract.
    for (const W of blockLengths) {
      for (let remaining = 0; remaining <= 480; remaining += 5) {
        const blocks = getSessionPlan(remaining, W);
        if (!blocks) continue;
        for (let i = 1; i < blocks.length; i += 1) {
          expect(blocks[i], `W=${W} r=${remaining} not descending`).toBeLessThanOrEqual(blocks[i - 1]);
        }
      }
    }
  });
});

describe('getSessionPlan — the worked examples from the spec', () => {
  const W = 25;

  it('does not split below the configured length', () => {
    expect(getSessionPlan(20, W)).toEqual([20]);
  });

  it('does not split inside the grace zone', () => {
    expect(getSessionPlan(30, W)).toEqual([30]);
    expect(getSessionPlan(35, W)).toEqual([35]); // upper edge
  });

  it('splits evenly past the grace zone rather than leaving a stub', () => {
    // The whole point: 40 is NOT 25 + 15.
    expect(getSessionPlan(40, W)).toEqual([20, 20]);
    expect(getSessionPlan(50, W)).toEqual([25, 25]);
  });

  it('distributes an uneven remainder front-first', () => {
    // The spec table said "3 x ~22", which is unbuildable under round-to-5.
    // 25+20+20 sums to exactly 65 and every block is a multiple of 5.
    expect(getSessionPlan(65, W)).toEqual([25, 20, 20]);
  });

  it('handles a long estimate', () => {
    expect(getSessionPlan(100, W)).toEqual([25, 25, 25, 25]);
  });
});

describe('getSessionPlan — respects the user configured block length', () => {
  it('does not hand a 50-minute worker two 25s', () => {
    // Regression guard: hardcoding 25 would silently overrule a setting the
    // user went and changed.
    expect(getSessionPlan(50, 50)).toEqual([50]);
    expect(getSessionPlan(100, 50)).toEqual([50, 50]);
  });

  it('scales the grace zone with the configured length', () => {
    expect(getSessionPlan(60, 50)).toEqual([60]); // 50 + 10 grace
    expect(getSessionPlan(65, 50)).toEqual([35, 30]); // past grace, split
  });
});

describe('getSessionPlan — boundaries that would break something', () => {
  it('never produces a zero-length block at a 1-minute configured length', () => {
    // A zero-length focus phase completes on its own first tick: a runaway
    // loop that POSTs to the server every iteration.
    const blocks = getSessionPlan(60, 1);
    expect(blocks).not.toBeNull();
    for (const block of blocks as number[]) {
      expect(block).toBeGreaterThanOrEqual(MIN_BLOCK_MINUTES);
    }
    expect((blocks as number[]).reduce((a, b) => a + b, 0)).toBe(60);
  });

  it('never produces a block the server would reject', () => {
    // MAX_SESSION_SECONDS is 6h; the estimate stepper goes to 480 minutes.
    const blocks = getSessionPlan(480, 480);
    expect(blocks).not.toBeNull();
    for (const block of blocks as number[]) {
      expect(block).toBeLessThanOrEqual(MAX_BLOCK_MINUTES);
    }
    expect((blocks as number[]).reduce((a, b) => a + b, 0)).toBe(480);
  });

  it('returns null when there is no work left', () => {
    expect(getSessionPlan(0, 25)).toBeNull();
    expect(getSessionPlan(-30, 25)).toBeNull(); // over the estimate
  });

  it('returns null rather than an empty plan for a trivial remainder', () => {
    expect(getSessionPlan(2, 25)).toBeNull(); // rounds to 0
    expect(getSessionPlan(3, 25)).toEqual([5]); // rounds up to one block
  });

  it('survives nonsense input instead of throwing', () => {
    expect(getSessionPlan(NaN, 25)).toBeNull();
    expect(getSessionPlan(60, NaN)).toBeNull();
  });
});

describe('nextPlannedFocusSeconds', () => {
  it('returns the first block in seconds', () => {
    expect(nextPlannedFocusSeconds(65, 25)).toBe(25 * 60);
    expect(nextPlannedFocusSeconds(40, 25)).toBe(20 * 60);
  });

  it('returns null when there is no plan, so callers fall back to the default', () => {
    expect(nextPlannedFocusSeconds(0, 25)).toBeNull();
  });

  it('converges — replanning from the shrinking remainder reproduces the tail', () => {
    // This is what removes the need for a stored plan queue or active index.
    // 65 -> [25,20,20]; after block 1, 40 remains -> [20,20]; then 20 -> [20].
    expect(getSessionPlan(65, 25)).toEqual([25, 20, 20]);
    expect(getSessionPlan(65 - 25, 25)).toEqual([20, 20]);
    expect(getSessionPlan(65 - 25 - 20, 25)).toEqual([20]);
    expect(getSessionPlan(65 - 25 - 20 - 20, 25)).toBeNull();
  });
});
