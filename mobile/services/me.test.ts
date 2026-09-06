import { describe, it, expect, vi, beforeEach } from 'vitest';

// me.ts imports ./api only for its `get`, but api.ts reaches for AsyncStorage,
// SecureStore and Config at import time. Mocking the module outright keeps this
// runnable under plain Node and lets each test control what /auth/me returns.
const get = vi.fn();
vi.mock('./api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

const { fetchMe, invalidateMe } = await import('./me');

const ok = (username: string) => ({ success: true, data: { username } });

/** A response that resolves only when the test says so. */
function deferred() {
  let release!: (value: unknown) => void;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

beforeEach(() => {
  get.mockReset();
  invalidateMe();
});

describe('fetchMe', () => {
  it('collapses a cold boot’s duplicate reads into one request', async () => {
    // The whole reason this module exists: four stores each read /auth/me for
    // their own slice of the user row.
    get.mockResolvedValue(ok('ada'));

    await fetchMe();
    await fetchMe();
    await fetchMe();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const d = deferred();
    get.mockReturnValue(d.promise);

    const a = fetchMe();
    const b = fetchMe();
    d.release(ok('ada'));

    expect(await a).toEqual(await b);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure — offline once must not suppress the next try', async () => {
    get.mockResolvedValueOnce({ success: false, error: 'Network error' });
    get.mockResolvedValueOnce(ok('ada'));

    await fetchMe();
    const second = await fetchMe();

    expect(get).toHaveBeenCalledTimes(2);
    expect(second).toEqual(ok('ada'));
  });

  it('refetches when forced', async () => {
    get.mockResolvedValue(ok('ada'));

    await fetchMe();
    await fetchMe({ force: true });

    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('invalidateMe', () => {
  it('drops the cached row', async () => {
    get.mockResolvedValue(ok('ada'));
    await fetchMe();

    invalidateMe();
    await fetchMe();

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('disowns a request that was already in flight', async () => {
    /**
     * The leak this guards. logout() calls invalidateMe() alongside
     * clearSessionHistory() and clearCalendar() — a block whose whole job is
     * making sure the next account cannot see the previous one's data.
     *
     * A /auth/me already in the air at that moment used to land afterwards and
     * write itself straight back into the cache. The next sign-in within the
     * ten-second freshness window then read the PREVIOUS user's row and set it
     * as the current user.
     */
    const d = deferred();
    get.mockReturnValueOnce(d.promise);
    const inFlight = fetchMe();          // user A's request, still running

    invalidateMe();                       // user A logs out
    d.release(ok('ada'));                 // A's response lands after the logout
    await inFlight;

    get.mockResolvedValueOnce(ok('grace'));
    const next = await fetchMe();         // user B signs in

    expect(next).toEqual(ok('grace'));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
