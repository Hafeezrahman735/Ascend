import { describe, expect, it } from 'vitest';
import { goalLinkDeltas } from './goalLinkDeltas';

describe('goalLinkDeltas', () => {
  it('links only the newly selected tasks', () => {
    expect(goalLinkDeltas(['a'], ['a', 'b'])).toEqual({ link: ['b'], unlink: [] });
  });

  it('unlinks only the deselected tasks', () => {
    expect(goalLinkDeltas(['a', 'b'], ['a'])).toEqual({ link: [], unlink: ['b'] });
  });

  it('links and unlinks in the same edit', () => {
    expect(goalLinkDeltas(['a', 'b'], ['b', 'c'])).toEqual({ link: ['c'], unlink: ['a'] });
  });

  it('sends nothing when the selection is unchanged, in any order', () => {
    expect(goalLinkDeltas(['a', 'b'], ['b', 'a'])).toEqual({ link: [], unlink: [] });
    expect(goalLinkDeltas([], [])).toEqual({ link: [], unlink: [] });
  });
});
