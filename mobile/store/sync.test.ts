import { describe, it, expect, vi, beforeEach } from 'vitest';

const disk = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => { disk.set(k, v); },
    removeItem: async (k: string) => { disk.delete(k); },
  },
}));

const { mergeWithServerSessions, getSessionHistory, clearSessionHistory } = await import('./sync');
type SessionRecord = import('./sync').SessionRecord;

const HOUR = 60 * 60 * 1000;

function local(sessionId: string, ageMs: number): SessionRecord {
  return {
    sessionId,
    completedAt: Date.now() - ageMs,
    durationSeconds: 1500,
    taskLabel: null,
    taskId: null,
    type: 'focus',
  };
}

async function seed(records: SessionRecord[]): Promise<void> {
  await clearSessionHistory();
  disk.set('session:history', JSON.stringify(records));
}

const ids = async () => (await getSessionHistory()).map((s) => s.sessionId);

beforeEach(() => disk.clear());

describe('mergeWithServerSessions', () => {
  it('keeps a session still waiting in the outbox, however old', async () => {
    // The original bug: a session finished offline was dropped from the
    // tracker at the next reconcile once it was 15 minutes old.
    await seed([local('offline-3h-ago', 3 * HOUR)]);

    await mergeWithServerSessions([], new Set(['offline-3h-ago']));

    expect(await ids()).toEqual(['offline-3h-ago']);
  });

  it('still prunes an old, unconfirmed session that is not queued', async () => {
    await seed([local('orphan', 3 * HOUR)]);

    await mergeWithServerSessions([]);

    expect(await ids()).toEqual([]);
  });

  it('replaces a queued local record with the server’s once it lands', async () => {
    const queued = local('client-1', 3 * HOUR);
    await seed([queued]);

    await mergeWithServerSessions(
      [{
        id: 'srv-1',
        completedAt: new Date(queued.completedAt).toISOString(),
        durationSeconds: 1500,
        taskId: null,
        taskLabel: null,
        clientSessionId: 'client-1',
      }],
      // Still listed as queued (the outbox has not caught up), yet the server
      // has it: exactly one record must remain, the server's.
      new Set(['client-1']),
    );

    expect(await ids()).toEqual(['srv-1']);
  });
});
