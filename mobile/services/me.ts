import { api } from './api';
import type { ApiResponse } from './api';

/**
 * One `GET /auth/me` per launch instead of three.
 *
 * Four stores each read this endpoint for their own slice of the user row —
 * auth wants the identity, settings wants the privacy flags, gamification wants
 * XP and streak, profile wants the avatar. Each fetched it independently, so a
 * cold boot fired three identical requests, and TWO of them were on the awaited
 * path before the first screen could paint:
 *
 *   loadUser()                    -> /auth/me   (awaited, blocks first paint)
 *   userSettingsStore.load()      -> /auth/me   (awaited, sequential after it)
 *   gamificationStore.fetchProfile() -> /auth/me (background)
 *
 * Because those are SEQUENTIAL, coalescing in-flight requests alone would not
 * have merged them — the second starts after the first resolves. Hence the
 * short freshness window as well as the in-flight share.
 *
 * The window is deliberately small. It exists to collapse one boot's worth of
 * duplicate reads, not to be a cache: anything that WRITES to the user row calls
 * invalidateMe(), so a settings change is never read back stale.
 */

/** Long enough to span a cold boot's three reads, short enough to be invisible. */
const FRESH_MS = 10_000;

type MeResponse = ApiResponse<Record<string, unknown>>;

let inFlight: Promise<MeResponse> | null = null;
let cached: { at: number; response: MeResponse } | null = null;

/**
 * Fetch the current user, sharing one request between concurrent callers and
 * reusing a very recent result.
 *
 * Failures are never cached — a request that failed because the device was
 * offline must not suppress the next caller's attempt for ten seconds.
 */
export function fetchMe<T>(options: { force?: boolean } = {}): Promise<ApiResponse<T>> {
  if (!options.force && cached && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve(cached.response as ApiResponse<T>);
  }
  if (!options.force && inFlight) {
    return inFlight as Promise<ApiResponse<T>>;
  }

  inFlight = api
    .get<Record<string, unknown>>('/auth/me')
    .then((response) => {
      if (response.success) cached = { at: Date.now(), response };
      return response;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight as Promise<ApiResponse<T>>;
}

/**
 * Drop the cached user row.
 *
 * Call after anything that changes it — the privacy and profile PATCHes, the
 * streak check — and on sign-out, so the next account never sees the previous
 * one's data.
 */
export function invalidateMe(): void {
  cached = null;
}
