import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_HISTORY_KEY = 'session:history';
const DAILY_KEY_PREFIX = 'session:daily:';

export interface SessionRecord {
  sessionId?: string;
  completedAt: number;
  durationSeconds: number;
  taskLabel: string | null;
  taskId: string | null;
  type: 'focus' | 'break';
}

interface DailyAggregate {
  date: string;
  totalSessions: number;
  totalMinutes: number;
  focusMinutes: number;
}

export function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getTodayKey(): string {
  const now = new Date();
  return `${DAILY_KEY_PREFIX}${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function appendSessionToHistory(record: SessionRecord): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_HISTORY_KEY);
    const history: SessionRecord[] = raw ? JSON.parse(raw) : [];
    history.push(record);
    if (history.length > 1000) history.splice(0, history.length - 1000);
    await AsyncStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('[sync] appendSessionToHistory failed:', err);
  }
}

async function updateDailyAggregate(durationSeconds: number): Promise<void> {
  try {
    const key = getTodayKey();
    const raw = await AsyncStorage.getItem(key);
    const daily: DailyAggregate = raw
      ? JSON.parse(raw)
      : { date: key.replace(DAILY_KEY_PREFIX, ''), totalSessions: 0, totalMinutes: 0, focusMinutes: 0 };
    daily.totalSessions += 1;
    daily.totalMinutes += Math.round(durationSeconds / 60);
    daily.focusMinutes += Math.round(durationSeconds / 60);
    await AsyncStorage.setItem(key, JSON.stringify(daily));
  } catch (err) {
    console.warn('[sync] updateDailyAggregate failed:', err);
  }
}

export function recordCompletedSession(record: SessionRecord): void {
  appendSessionToHistory(record).catch((err) => console.warn('[sync] recordCompletedSession append failed:', err));
  updateDailyAggregate(record.durationSeconds).catch((err) => console.warn('[sync] recordCompletedSession daily failed:', err));
}

export async function getSessionHistory(): Promise<SessionRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearSessionHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_HISTORY_KEY);
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
    }
  } catch (err) {
    console.warn('[sync] removeTaskSessionsFromHistory failed:', err);
  }
}

export async function getDailyAggregate(date?: string): Promise<DailyAggregate | null> {
  try {
    const key = date ? `${DAILY_KEY_PREFIX}${date}` : getTodayKey();
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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
  } catch (err) {
    console.warn('[sync] mergeWithServerSessions failed:', err);
  }
}
