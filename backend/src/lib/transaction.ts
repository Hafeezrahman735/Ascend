import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { eventBus } from '../middleware/eventBus';

/**
 * Where a scoring helper reads and writes, and where it sends its events.
 *
 * awardXp, checkAchievements and syncGoalCompletion used to reach for the
 * global client and emit on the event bus inline. That stops them running
 * inside a transaction: their writes would land on a second connection (and
 * wait forever on the users row the transaction has locked), and their feed
 * events would announce work a rollback then undoes.
 *
 * Callers that pass nothing get IMMEDIATE — the global client and the live
 * bus — so every existing call site behaves exactly as before.
 */
export interface Effects {
  db: Prisma.TransactionClient;
  events: EventSink;
}

/** The one method of the event bus the helpers use. */
export interface EventSink {
  emit(event: string, payload: unknown): unknown;
}

export const IMMEDIATE: Effects = { db: prisma, events: eventBus };

/**
 * Run `work` in one transaction, holding every event it emits until commit.
 *
 * On commit the events go out in the order they were emitted. If anything
 * throws, the transaction rolls back and the events are dropped, so a feed
 * entry or achievement toast can never describe a write that did not happen.
 */
export async function runInTransaction<T>(
  work: (effects: Effects) => Promise<T>,
  options?: { timeout?: number },
): Promise<T> {
  const pending: Array<[string, unknown]> = [];
  const events: EventSink = {
    emit: (event, payload) => pending.push([event, payload]),
  };

  const result = await prisma.$transaction((db) => work({ db, events }), options);

  for (const [event, payload] of pending) eventBus.emit(event, payload);
  return result;
}
