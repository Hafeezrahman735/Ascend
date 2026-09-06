import { describe, it, expect } from 'vitest';
import { touchKey } from './lruIndex';

describe('touchKey', () => {
  it('appends a new key when there is room', () => {
    expect(touchKey(['a'], 'b', 3)).toEqual({ index: ['a', 'b'], evicted: [] });
  });

  it('starts from empty', () => {
    expect(touchKey([], 'a', 3)).toEqual({ index: ['a'], evicted: [] });
  });

  it('moves an existing key to newest rather than duplicating it', () => {
    // The whole point of an LRU: the range you keep returning to must not be
    // evicted just because you scrolled past a dozen others in between.
    expect(touchKey(['a', 'b', 'c'], 'a', 3)).toEqual({
      index: ['b', 'c', 'a'],
      evicted: [],
    });
  });

  it('evicts the oldest key once the limit is passed', () => {
    expect(touchKey(['a', 'b', 'c'], 'd', 3)).toEqual({
      index: ['b', 'c', 'd'],
      evicted: ['a'],
    });
  });

  it('never evicts the key that was just written', () => {
    // The off-by-one that would make the cache useless: write, immediately
    // evict what you wrote, refetch on the next read, forever.
    const { index, evicted } = touchKey(['a', 'b'], 'c', 2);
    expect(index).toContain('c');
    expect(evicted).not.toContain('c');
  });

  it('evicts several at once when the index arrives oversized', () => {
    // Reachable on upgrade: an index written by a build with no cap, or with a
    // larger one, is trimmed on the next write rather than left to sit.
    const { index, evicted } = touchKey(['a', 'b', 'c', 'd', 'e'], 'f', 3);
    expect(index).toEqual(['d', 'e', 'f']);
    expect(evicted).toEqual(['a', 'b', 'c']);
  });

  it('holds exactly at the limit without evicting', () => {
    expect(touchKey(['a', 'b'], 'c', 3)).toEqual({ index: ['a', 'b', 'c'], evicted: [] });
  });

  it('evicts everything when the limit is zero', () => {
    // Degenerate, but it must not throw or silently keep one entry.
    expect(touchKey(['a', 'b'], 'c', 0)).toEqual({ index: [], evicted: ['a', 'b', 'c'] });
  });
});
