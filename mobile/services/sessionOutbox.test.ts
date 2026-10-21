import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory AsyncStorage, so the queue's persistence is exercised for real.
const disk = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => { disk.set(k, v); },
    removeItem: async (k: string) => { disk.delete(k); },
  },
}));

// api.ts reaches for SecureStore and Config at import time; the outbox only
// needs `post`, and each test decides what the server answers.
const post = vi.fn();
vi.mock('./api', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));

const outbox = await import('./sessionOutbox');
const {
  classifyCompletion,
  enqueueSessionCompletion,
  flushSessionOutbox,
  getQueuedCompletions,
  getQueuedSessionIds,
  setSessionDeliveredHandler,
  stopSessionOutboxRetries,
  clearSessionOutbox,
  RETRY_BASE_MS,
} = outbox;
type SessionCompletion = import('./sessionOutbox').SessionCompletion;

const USER = 'user-1';

function completion(id: string, overrides: Partial<SessionCompletion> = {}): SessionCompletion {
  return {
    clientSessionId: id,
    completedAt: 1_760_000_000_000,
    localDate: '2026-10-20',
    tz: 'America/Chicago',
    actualElapsedSeconds: 1500,
    plannedDurationSeconds: 1500,
    taskId: null,
    taskLabel: null,
    ...overrides,
  };
}

const reward = { xpEarned: 25, totalXP: 125, leveledUp: false, newStreak: 3, longestStreak: 5, newlyUnlocked: [] };
const ok = (data: unknown = reward) => ({ success: true, data });
const offline = { success: false, error: 'Network error', errorKind: 'offline' };
const rejected = { success: false, error: 'Session completion time is out of range' };

/** A server answer that arrives only when the test says so. */
function deferred() {
  let release!: (value: unknown) => void;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

const queuedIds = async () => (await getQueuedCompletions(USER)).map((c) => c.clientSessionId);
const sentIds = () => post.mock.calls.map((call) => (call[1] as SessionCompletion).clientSessionId);

let delivered: { id: string; result: unknown }[];

beforeEach(() => {
  disk.clear();
  post.mockReset();
  delivered = [];
  setSessionDeliveredHandler((c, result) => delivered.push({ id: c.clientSessionId, result }));
  stopSessionOutboxRetries();
});

afterEach(() => {
  stopSessionOutboxRetries();
  vi.useRealTimers();
});

describe('classifyCompletion', () => {
  it('treats a success as delivered', () => {
    expect(classifyCompletion(ok())).toBe('delivered');
  });

  it('keeps an entry when no real answer came back', () => {
    for (const errorKind of ['offline', 'timeout', 'server', 'unauthorized', 'invalid-response']) {
      expect(classifyCompletion({ success: false, errorKind } as never)).toBe('retry');
    }
  });

  it('drops an entry the server refused with a 4xx — resending gets the same answer', () => {
    expect(classifyCompletion(rejected)).toBe('rejected');
  });
});

describe('offline completion', () => {
  it('keeps a session that could not be sent, on disk', async () => {
    post.mockResolvedValue(offline);

    await enqueueSessionCompletion(USER, completion('a'));
    const result = await flushSessionOutbox(USER);

    expect(result).toEqual({ delivered: 0, rejected: 0, pending: 1 });
    expect(await queuedIds()).toEqual(['a']);
    expect(JSON.parse(disk.get(`session:outbox:${USER}`)!)).toHaveLength(1);
    expect(delivered).toEqual([]);
  });

  it('sends the exact body /timer/complete takes, clientSessionId included', async () => {
    post.mockResolvedValue(ok());
    const c = completion('a', { taskId: 't1', taskLabel: 'Write tests' });

    await enqueueSessionCompletion(USER, c);
    await flushSessionOutbox(USER);

    expect(post).toHaveBeenCalledWith('/timer/complete', c);
  });

  it('survives the app being killed: a fresh read still finds the entry', async () => {
    // Nothing is in memory between enqueue and this read except the disk map.
    await enqueueSessionCompletion(USER, completion('a'));
    expect(await getQueuedSessionIds(USER)).toEqual(new Set(['a']));
  });

  it('never queues the same session twice', async () => {
    await enqueueSessionCompletion(USER, completion('a'));
    await enqueueSessionCompletion(USER, completion('a'));
    expect(await queuedIds()).toEqual(['a']);
  });

  it('keeps each account’s queue separate', async () => {
    await enqueueSessionCompletion(USER, completion('a'));
    await enqueueSessionCompletion('user-2', completion('b'));
    expect(await queuedIds()).toEqual(['a']);
    expect(await getQueuedSessionIds('user-2')).toEqual(new Set(['b']));
  });
});

describe('retry and synchronisation', () => {
  it('delivers a queued session once the server is reachable again', async () => {
    post.mockResolvedValueOnce(offline).mockResolvedValueOnce(ok());

    await enqueueSessionCompletion(USER, completion('a'));
    await flushSessionOutbox(USER);
    const second = await flushSessionOutbox(USER);

    expect(second).toEqual({ delivered: 1, rejected: 0, pending: 0 });
    expect(await queuedIds()).toEqual([]);
    expect(disk.has(`session:outbox:${USER}`)).toBe(false);
    expect(delivered).toEqual([{ id: 'a', result: reward }]);
  });

  it('sends oldest first and stops at the first failure, preserving order', async () => {
    // Streaks are computed in arrival order, so a later session must never
    // overtake an earlier one.
    post.mockResolvedValueOnce(ok()).mockResolvedValueOnce(offline);

    await enqueueSessionCompletion(USER, completion('a'));
    await enqueueSessionCompletion(USER, completion('b'));
    await enqueueSessionCompletion(USER, completion('c'));
    const result = await flushSessionOutbox(USER);

    expect(sentIds()).toEqual(['a', 'b']);
    expect(result).toEqual({ delivered: 1, rejected: 0, pending: 2 });
    expect(await queuedIds()).toEqual(['b', 'c']);
  });

  it('drops a rejected session and carries on with the rest', async () => {
    post.mockResolvedValueOnce(rejected).mockResolvedValueOnce(ok());

    await enqueueSessionCompletion(USER, completion('stale'));
    await enqueueSessionCompletion(USER, completion('fresh'));
    const result = await flushSessionOutbox(USER);

    expect(result).toEqual({ delivered: 1, rejected: 1, pending: 0 });
    expect(delivered.map((d) => d.id)).toEqual(['fresh']);
  });

  it('keeps the entry when sending throws unexpectedly', async () => {
    post.mockRejectedValue(new Error('boom'));

    await enqueueSessionCompletion(USER, completion('a'));
    const result = await flushSessionOutbox(USER);

    expect(result.pending).toBe(1);
    expect(await queuedIds()).toEqual(['a']);
  });

  it('does not lose a session when queue writes overlap', async () => {
    // The race the storage lock exists for. Every write is read-modify-write
    // across awaits, so without serialising them two overlapping writers both
    // read the same queue and the second write erases the first's entry.
    post.mockResolvedValue(ok());
    await enqueueSessionCompletion(USER, completion('a'));

    await Promise.all([
      flushSessionOutbox(USER), // removes 'a'
      enqueueSessionCompletion(USER, completion('b')),
      enqueueSessionCompletion(USER, completion('c')),
    ]);

    const left = await queuedIds();
    const sent = sentIds();
    // Every session is either delivered or still queued — none vanished.
    expect(new Set([...left, ...sent])).toEqual(new Set(['a', 'b', 'c']));
    expect(left).not.toContain('a');
  });

  it('runs one flush at a time and picks up entries added mid-flush', async () => {
    const answer = deferred();
    post.mockReturnValueOnce(answer.promise).mockResolvedValue(ok());

    await enqueueSessionCompletion(USER, completion('a'));
    const first = flushSessionOutbox(USER);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await enqueueSessionCompletion(USER, completion('b'));
    const second = flushSessionOutbox(USER);
    const third = flushSessionOutbox(USER);
    answer.release(ok());
    await Promise.all([first, second, third]);

    // 'a' once, 'b' once — never the same session in two concurrent requests.
    expect(sentIds()).toEqual(['a', 'b']);
    expect(await queuedIds()).toEqual([]);
  });

  it('retries on a timer while the app stays open, backing off', async () => {
    vi.useFakeTimers();
    post.mockResolvedValueOnce(offline).mockResolvedValueOnce(offline).mockResolvedValue(ok());

    await enqueueSessionCompletion(USER, completion('a'));
    await flushSessionOutbox(USER);
    expect(post).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(post).toHaveBeenCalledTimes(2);

    // The second wait is doubled, so the base interval alone is not enough.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(post).toHaveBeenCalledTimes(3);

    expect(await queuedIds()).toEqual([]);
    // Nothing left, so nothing further is scheduled.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 20);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('stops retrying after logout, and leaves the queue for that account', async () => {
    vi.useFakeTimers();
    post.mockResolvedValue(offline);

    await enqueueSessionCompletion(USER, completion('a'));
    await flushSessionOutbox(USER);
    stopSessionOutboxRetries();
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 20);

    expect(post).toHaveBeenCalledTimes(1);
    expect(await queuedIds()).toEqual(['a']);
  });

  it('abandons an in-progress flush on logout so the next account’s token is never used', async () => {
    const answer = deferred();
    post.mockReturnValueOnce(answer.promise).mockResolvedValue(ok());

    await enqueueSessionCompletion(USER, completion('a'));
    await enqueueSessionCompletion(USER, completion('b'));
    const flushing = flushSessionOutbox(USER);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    stopSessionOutboxRetries();
    answer.release(ok());
    await flushing;

    expect(sentIds()).toEqual(['a']);
    expect(await queuedIds()).toEqual(['b']);
  });

  it('clears an account’s queue on deletion', async () => {
    await enqueueSessionCompletion(USER, completion('a'));
    await clearSessionOutbox(USER);
    expect(await queuedIds()).toEqual([]);
  });
});

describe('duplicate protection', () => {
  it('removes an entry the server already had, and reports it as such', async () => {
    // The first send reached the server but its response was lost, so the
    // entry stayed queued. The replay must clear it without double counting.
    const duplicate = { sessionId: 'srv-1', alreadyProcessed: true, newlyUnlocked: [] };
    post.mockResolvedValue(ok(duplicate));

    await enqueueSessionCompletion(USER, completion('a'));
    await flushSessionOutbox(USER);

    expect(await queuedIds()).toEqual([]);
    expect(delivered).toEqual([{ id: 'a', result: duplicate }]);
    expect(outbox.isAlreadyProcessed(duplicate as never)).toBe(true);
    expect(outbox.isAlreadyProcessed(reward)).toBe(false);
  });

  it('resends with the same clientSessionId every time', async () => {
    post.mockResolvedValueOnce(offline).mockResolvedValueOnce(offline).mockResolvedValue(ok());

    await enqueueSessionCompletion(USER, completion('a'));
    await flushSessionOutbox(USER);
    await flushSessionOutbox(USER);
    await flushSessionOutbox(USER);

    expect(sentIds()).toEqual(['a', 'a', 'a']);
  });
});
