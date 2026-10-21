import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, type ApiResponse } from './api';
import type { SessionReward } from '../types';

/**
 * A durable outbox for POST /timer/complete.
 *
 * Completions used to be fired once and forgotten. A session that ended on a
 * train, in airplane mode, or while Railway was restarting was never recorded:
 * it showed in the local history for fifteen minutes, then the next reconcile
 * dropped it, along with its XP, streak credit and goal progress.
 *
 * Now every completion is written here BEFORE it is sent, and leaves only when
 * the server has answered for it. That covers the request failing, the app
 * being killed mid-request, and the response being lost after the server saved
 * the session — the last case is why each entry carries the clientSessionId the
 * server deduplicates on, so a resend can never credit the same session twice.
 *
 * Entries are sent oldest first and a failure stops the run, so sessions reach
 * the server in the order they happened. The streak logic depends on that.
 */

/** Exactly the body POST /timer/complete takes. */
export interface SessionCompletion {
  clientSessionId: string;
  completedAt: number;
  localDate: string;
  tz: string | null;
  actualElapsedSeconds: number;
  plannedDurationSeconds: number | null;
  taskId: string | null;
  taskLabel: string | null;
}

/** What the server returns for a clientSessionId it has already recorded. */
export interface AlreadyProcessed {
  sessionId: string;
  alreadyProcessed: true;
  newlyUnlocked: [];
}

export type CompletionResult = SessionReward | AlreadyProcessed;

export function isAlreadyProcessed(result: CompletionResult): result is AlreadyProcessed {
  return 'alreadyProcessed' in result && result.alreadyProcessed === true;
}

export type CompletionOutcome = 'delivered' | 'retry' | 'rejected';

/**
 * What one attempt means for the queued entry.
 *
 * api.ts sets `errorKind` only when no real answer came back — offline, timeout,
 * a 5xx, an expired session, an unparseable body — and every one of those may
 * succeed later. A failure WITHOUT an errorKind is the server's considered 4xx
 * ("completion time out of range", a schema error): resending the same body
 * would get the same answer forever, so it leaves the queue.
 */
export function classifyCompletion(res: ApiResponse<unknown>): CompletionOutcome {
  if (res.success) return 'delivered';
  return res.errorKind ? 'retry' : 'rejected';
}

export interface FlushResult {
  delivered: number;
  rejected: number;
  /** Entries still queued because the server could not be reached. */
  pending: number;
}

type DeliveredHandler = (completion: SessionCompletion, result: CompletionResult | undefined) => void;

const outboxKey = (userId: string) => `session:outbox:${userId}`;

/** First wait after a failed run; doubles each time, capped below. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 5 * 60_000;

let deliveredHandler: DeliveredHandler | null = null;

/**
 * Registered once by the timer store, so every delivery gets the same follow-up
 * (rewards, week dots) whichever trigger flushed it — a live completion, launch,
 * or the app returning to the foreground.
 */
export function setSessionDeliveredHandler(handler: DeliveredHandler | null): void {
  deliveredHandler = handler;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Serialises every read-modify-write of the queue.
 *
 * A flush awaits the network between reading the queue and removing what it
 * sent. Without this, a completion enqueued during that wait would be
 * overwritten by the flush writing back its stale copy — losing the very kind
 * of session this module exists to protect.
 */
let storageChain: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storageChain.then(fn, fn);
  storageChain = run.catch(() => {});
  return run;
}

async function readQueue(userId: string): Promise<SessionCompletion[]> {
  try {
    const raw = await AsyncStorage.getItem(outboxKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SessionCompletion[]) : [];
  } catch (err) {
    console.warn('[outbox] read failed:', err);
    return [];
  }
}

async function writeQueue(userId: string, queue: SessionCompletion[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(outboxKey(userId));
    return;
  }
  await AsyncStorage.setItem(outboxKey(userId), JSON.stringify(queue));
}

/** Persists a completion. Resolves once it is on disk, so it survives the app being killed. */
export function enqueueSessionCompletion(userId: string, completion: SessionCompletion): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue(userId);
    if (queue.some((c) => c.clientSessionId === completion.clientSessionId)) return;
    await writeQueue(userId, [...queue, completion]);
  });
}

function removeFromQueue(userId: string, clientSessionId: string): Promise<void> {
  return withQueueLock(async () => {
    const queue = await readQueue(userId);
    await writeQueue(userId, queue.filter((c) => c.clientSessionId !== clientSessionId));
  });
}

export function getQueuedCompletions(userId: string): Promise<SessionCompletion[]> {
  return withQueueLock(() => readQueue(userId));
}

/** Account deletion: the server no longer has anywhere to put these. */
export function clearSessionOutbox(userId: string): Promise<void> {
  stopSessionOutboxRetries();
  return withQueueLock(() => AsyncStorage.removeItem(outboxKey(userId)));
}

/** Ids the local history must keep showing until the server has them. */
export async function getQueuedSessionIds(userId: string): Promise<Set<string>> {
  const queue = await getQueuedCompletions(userId);
  return new Set(queue.map((c) => c.clientSessionId));
}

// ── Sending ──────────────────────────────────────────────────────────────────

/**
 * Bumped on logout. A flush loop or retry timer started for the previous
 * account checks it before every send, so it can never post that account's
 * sessions with the NEXT account's token once someone else signs in.
 */
let generation = 0;

async function runFlush(userId: string, startedIn: number): Promise<FlushResult> {
  const queue = await getQueuedCompletions(userId);
  let delivered = 0;
  let rejected = 0;

  for (const completion of queue) {
    if (startedIn !== generation) break;
    let res: ApiResponse<CompletionResult>;
    try {
      res = await api.post<CompletionResult>('/timer/complete', completion);
    } catch (err) {
      // apiRequest resolves rather than throws; anything thrown is unexpected,
      // and the one safe answer to it is to keep the entry and try again.
      console.warn('[outbox] send threw:', err);
      break;
    }
    const outcome = classifyCompletion(res);

    // Stop at the first unreachable answer: the rest would fail the same way,
    // and sending later sessions first would reorder the streak.
    if (outcome === 'retry') break;

    await removeFromQueue(userId, completion.clientSessionId);
    if (outcome === 'rejected') {
      rejected += 1;
      console.warn('[outbox] session rejected by server, dropping:', completion.clientSessionId, res.error);
      continue;
    }

    delivered += 1;
    try {
      deliveredHandler?.(completion, res.data);
    } catch (err) {
      console.warn('[outbox] delivered handler failed:', err);
    }
  }

  return { delivered, rejected, pending: queue.length - delivered - rejected };
}

let activeFlush: Promise<FlushResult> | null = null;
let followUpFlush: Promise<FlushResult> | null = null;

/**
 * Sends everything queued for this user, oldest first.
 *
 * Single-flight: a call made while a flush is running waits for one more full
 * run after it, rather than racing it, so an entry enqueued mid-flush is always
 * picked up and nothing is sent twice concurrently.
 */
export function flushSessionOutbox(userId: string): Promise<FlushResult> {
  if (!activeFlush) {
    cancelRetry();
    const startedIn = generation;
    activeFlush = runFlush(userId, startedIn)
      .then((result) => {
        if (startedIn === generation) scheduleRetryIfPending(userId, result);
        return result;
      })
      .finally(() => {
        activeFlush = null;
      });
    return activeFlush;
  }
  if (!followUpFlush) {
    followUpFlush = activeFlush.then(() => {
      followUpFlush = null;
      return flushSessionOutbox(userId);
    });
  }
  return followUpFlush;
}

// ── Retry while the app is open ──────────────────────────────────────────────
//
// There is no connectivity listener in this app (NetInfo is a native module and
// would need a new binary). Launch and foreground cover most reconnects; this
// timer covers the user who stays in the app while the signal comes back.

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = RETRY_BASE_MS;

function cancelRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetryIfPending(userId: string, result: FlushResult): void {
  if (result.pending === 0) {
    retryDelayMs = RETRY_BASE_MS;
    return;
  }
  // Progress means the connection is back; start the next wait from the bottom.
  if (result.delivered > 0) retryDelayMs = RETRY_BASE_MS;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushSessionOutbox(userId).catch((err) => console.warn('[outbox] retry failed:', err));
  }, delay);
}

/** Called on logout: the queue stays on disk for that account, but nothing sends without it. */
export function stopSessionOutboxRetries(): void {
  generation += 1;
  cancelRetry();
  retryDelayMs = RETRY_BASE_MS;
}
