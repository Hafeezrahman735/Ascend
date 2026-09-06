/**
 * A bounded most-recently-used index for AsyncStorage-backed caches.
 *
 * AsyncStorage has no prefix delete and no size limit that anything enforces
 * for you, so a cache keyed by "whatever the user looked at" grows until the
 * account is logged out. The calendar cache did exactly that: one permanent key
 * per week or month ever scrolled to, plus an index array that was re-parsed
 * and re-serialised on every single write. Someone who scrubs through a year of
 * months leaves hundreds of keys behind and pays for all of them on each write.
 *
 * Pure and separate from the store so the eviction rule is testable on its own —
 * off-by-one errors here silently either grow forever or evict the entry that
 * was just written.
 */

export interface LruResult {
  /** The new index, oldest first, newest last. */
  index: string[];
  /** Keys that fell out and should be removed from storage. */
  evicted: string[];
}

/**
 * Record `key` as the most recently used, evicting the oldest beyond `limit`.
 *
 * Re-touching a key that is already present moves it to the newest position
 * rather than duplicating it — that is what makes this an LRU rather than a
 * capped append log, and it is why the week you keep coming back to survives a
 * scroll through twelve other months.
 */
export function touchKey(index: string[], key: string, limit: number): LruResult {
  if (limit <= 0) return { index: [], evicted: index.includes(key) ? index : [...index, key] };

  const withoutKey = index.filter((k) => k !== key);
  const next = [...withoutKey, key];

  if (next.length <= limit) return { index: next, evicted: [] };

  const overflow = next.length - limit;
  return { index: next.slice(overflow), evicted: next.slice(0, overflow) };
}
