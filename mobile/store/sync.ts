import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_HISTORY_KEY = 'session:history';
/**
 * Legacy only. `session:daily:YYYY-MM-DD` aggregates were written once per day
 * and read by nothing — `getDailyAggregate` had zero callers — so every install
 * accumulated one permanent key per day of use, plus an extra AsyncStorage write
 * on the session-complete path that bought nothing.
 *
 * Writing stopped; this prefix survives only so the keys already on disk can be
 * swept up. See pruneLegacyDailyAggregates below.
 */
const DAILY_KEY_PREFIX = 'session:daily:';

export interface SessionRecord {
  sessionId?: string;
  completedAt: number;
  durationSeconds: number;
  taskLabel: string | null;
  taskId: string | null;
  type: 'focus' | 'break';
  /**
   * The tag frozen onto the session by the server when it was saved.
   *
   * Absent on a record written locally the moment a session ends — that one
   * still resolves through the live task list, which is correct, because a
   * task cannot have been archived in the seconds since. It arrives on the
   * next sync. See buildCategoryMap for the fallback chain.
   */
  primaryTag?: string | null;
}

export function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * In-memory mirror of the history blob.
 *
 * The cap is 1000 records, which serialises to roughly 150-250 KB of JSON, and
 * getSessionHistory() was re-reading and re-parsing all of it on EVERY focus of
 * both the Tasks tab and the Trace tab. Switching between the two tabs a few
 * times parsed a quarter of a megabyte on the JS thread each way, for data that
 * only changes when a session ends.
 *
 * Every writer below clears this, so it cannot serve a stale list. It is a
 * process-lifetime mirror, not persistence — AsyncStorage remains the truth.
 */
let historyCache: SessionRecord[] | null = null;

/** Called by every path in this file that writes or clears the blob. */
function invalidateHistoryCache(): void {
  historyCache = null;
}

async function appendSessionToHistory(record: SessionRecord): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_HISTORY_KEY);
    const history: SessionRecord[] = raw ? JSON.parse(raw) : [];
    history.push(record);
    if (history.length > 1000) history.splice(0, history.length - 1000);
    await AsyncStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
    invalidateHistoryCache();
  } catch (err) {
    console.warn('[sync] appendSessionToHistory failed:', err);
  }
}

export function recordCompletedSession(record: SessionRecord): void {
  appendSessionToHistory(record).catch((err) => console.warn('[sync] recordCompletedSession append failed:', err));
}

export async function getSessionHistory(): Promise<SessionRecord[]> {
  if (historyCache) return historyCache;
  try {
    const raw = await AsyncStorage.getItem(SESSION_HISTORY_KEY);
    const parsed: SessionRecord[] = raw ? JSON.parse(raw) : [];
    historyCache = parsed;
    return parsed;
  } catch {
    return [];
  }
}

export async function clearSessionHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_HISTORY_KEY);
    invalidateHistoryCache();
  } catch {}
}

// Drops every locally-cached session belonging to a task. Called when a task is
// deleted so its focus time leaves the time tracker immediately, without waiting
// for the next server reconcile.
export async function removeTaskSessionsFromHistory(taskId: string): Promise<void> {
  if (!taskId) return;
  try {
    const local = await getSessionHistory();
    const filtered = local.filter((s) => s.taskId !== taskId);
    if (filtered.length !== local.length) {
      await AsyncStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(filtered));
      invalidateHistoryCache();
    }
  } catch (err) {
    console.warn('[sync] removeTaskSessionsFromHistory failed:', err);
  }
}

// Grace window for a just-completed local session whose /timer/complete POST may
// not have round-tripped to the server yet. Anything older that the server doesn't
// know about is treated as an orphan and dropped.
const PENDING_SYNC_GRACE_MS = 15 * 60 * 1000;

// Reconciles local session history against the server, which is the source of
// truth. The server list replaces local history wholesale; the only local records
// kept are ones completed within the grace window that the server hasn't confirmed
// yet (a session the user just finished). This guarantees local history can never
// silently diverge from the server — stale records from a previous backend, a
// deleted task, or a failed sync are pruned on the next successful fetch rather
// than lingering in the time tracker forever.
export async function mergeWithServerSessions(
  serverSessions: {
    id: string;
    completedAt: string;
    durationSeconds: number;
    taskId: string | null;
    taskLabel: string | null;
    clientSessionId?: string | null;
    primaryTag?: string | null;
  }[],
): Promise<void> {
  try {
    const local = await getSessionHistory();

    const serverRecords: SessionRecord[] = serverSessions.map((s) => ({
      sessionId: s.id,
      completedAt: new Date(s.completedAt).getTime(),
      durationSeconds: s.durationSeconds,
      taskLabel: s.taskLabel || null,
      taskId: s.taskId || null,
      type: 'focus',
      primaryTag: s.primaryTag ?? null,
    }));

    const serverClientIds = new Set(
      serverSessions.filter((s) => s.clientSessionId).map((s) => s.clientSessionId as string),
    );
    const serverKeys = new Set(
      serverSessions.map((s) => `${new Date(s.completedAt).getTime()}:${s.durationSeconds}:${s.taskId || ''}`),
    );

    const now = Date.now();
    const pendingLocal = local.filter((s) => {
      // Only keep recent, not-yet-confirmed local sessions awaiting their POST.
      if (now - s.completedAt > PENDING_SYNC_GRACE_MS) return false;
      if (s.sessionId && serverClientIds.has(s.sessionId)) return false;
      if (serverKeys.has(`${s.completedAt}:${s.durationSeconds}:${s.taskId || ''}`)) return false;
      return true;
    });

    const merged = [...serverRecords, ...pendingLocal]
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, 1000);

    await AsyncStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(merged));
    invalidateHistoryCache();
  } catch (err) {
    console.warn('[sync] mergeWithServerSessions failed:', err);
  }
}

/**
 * Deletes the retired `session:daily:*` keys.
 *
 * One-shot, best-effort, and safe to call on every launch: after the first
 * sweep there is nothing left to match, so it costs one getAllKeys and stops.
 * Called unawaited from the bootstrap — a user who has had the app a year has a
 * few hundred of these, and nothing should wait on tidying them.
 */
export async function pruneLegacyDailyAggregates(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith(DAILY_KEY_PREFIX));
    if (stale.length === 0) return 0;
    await AsyncStorage.multiRemove(stale);
    return stale.length;
  } catch (err) {
    console.warn('[sync] pruneLegacyDailyAggregates failed:', err);
    return 0;
  }
}
