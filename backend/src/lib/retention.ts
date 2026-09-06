import { prisma } from './prisma';

/**
 * Row retention for the two tables that grow forever.
 *
 * There is no scheduler anywhere in this backend — no cron, no worker, nothing
 * that wakes up on its own (verified: zero matches for cron/setInterval/bullmq
 * in src/). So retention has to be opportunistic, done on the write path, which
 * is the same shape as the expired-refresh-token cleanup that already runs on
 * every login.
 *
 * Both caps are per user and enforced by age, not by count. Age is the property
 * that actually matters here — "we keep six months" is something you can explain
 * to a user, and it degrades gracefully whether they finish two sessions a week
 * or twenty a day. A row cap would silently keep a month for the heavy user and
 * three years for the light one.
 *
 * Every function here is best-effort: retention failing must never fail the
 * write it was tidying up after. Callers do not await the result.
 */

/**
 * How long the personal activity log is kept.
 *
 * feed_events grows by roughly 3-8 rows per active day per user and had no
 * cleanup at all. It backs the Recent Activity card, which shows four entries;
 * six months is far past anything anyone scrolls to.
 */
export const ACTIVITY_RETENTION_DAYS = 180;

/**
 * How long in-app notifications are kept.
 *
 * GET /notifications reads the newest 50 with no cursor, so anything older than
 * that page was already unreachable through the API while still occupying rows
 * forever. Ninety days is generous next to a list you cannot page past.
 */
export const NOTIFICATION_RETENTION_DAYS = 90;

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Deletes this user's activity-log rows older than the retention window. */
export async function pruneActivityLog(userId: string): Promise<number> {
  try {
    const { count } = await prisma.feedEvent.deleteMany({
      where: { userId, createdAt: { lt: cutoff(ACTIVITY_RETENTION_DAYS) } },
    });
    return count;
  } catch (err) {
    console.warn('[retention] activity log prune failed:', err);
    return 0;
  }
}

/** Deletes this user's notifications older than the retention window. */
export async function pruneNotifications(userId: string): Promise<number> {
  try {
    const { count } = await prisma.notification.deleteMany({
      where: { userId, createdAt: { lt: cutoff(NOTIFICATION_RETENTION_DAYS) } },
    });
    return count;
  } catch (err) {
    console.warn('[retention] notification prune failed:', err);
    return 0;
  }
}
