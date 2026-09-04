import { prisma } from './prisma';
import { pruneActivityLog } from './retention';
import type { FeedCreateEvent } from '../middleware/eventBus';

/**
 * The personal accomplishment log — what YOU have done.
 *
 * Rows written here are read back by `GET /activity` (modules/calendar/routes.ts)
 * and rendered as the Recent Activity card on the Tasks tab. Self-only, and that
 * is the whole point of it.
 *
 * This used to be `handleFeedCreate` in modules/social/handler.ts, where it did
 * two jobs: persist the row AND fan it out over a `/social` Socket.IO namespace
 * to the author's friends. The fan-out half is gone — the client never opened
 * that namespace, so every broadcast went nowhere, and friendships no longer
 * exist. What is left is the durable write, which was always the half with a
 * reader.
 *
 * It lives in lib/ rather than under modules/social/ because it is not social:
 * nobody else ever sees these rows.
 */
export async function recordActivityEvent(event: FeedCreateEvent): Promise<void> {
  await prisma.feedEvent.create({
    data: {
      userId: event.userId,
      eventType: event.eventType,
      payload: event.payload as never,
    },
  });

  // Opportunistic retention — there is no scheduler to do it anywhere else.
  // Unawaited on purpose: tidying old rows must never delay or fail the write
  // that just happened.
  void pruneActivityLog(event.userId);
}
