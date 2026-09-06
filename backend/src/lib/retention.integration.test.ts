import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import {
  pruneActivityLog,
  pruneNotifications,
  ACTIVITY_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
} from './retention';

/**
 * Retention, against a real database.
 *
 * Both tables grew forever. feed_events gains 3-8 rows per active day per user;
 * notifications gained a row per event and were read with a bare `take: 50` and
 * no cursor, so everything past the newest 50 was unreachable through the API
 * while still occupying storage indefinitely.
 *
 * The risk in a delete-by-age job is obvious and worth pinning: deleting too
 * much, or deleting somebody else's rows. Both are asserted below.
 */

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

async function activityEvent(user: TestUser, createdAt: Date) {
  return prisma.feedEvent.create({
    data: { userId: user.id, eventType: 'session_completed', payload: {}, createdAt },
  });
}

async function notification(user: TestUser, createdAt: Date) {
  return prisma.notification.create({
    data: { userId: user.id, type: 'test', title: 't', body: 'b', createdAt },
  });
}

describe('activity log retention', () => {
  it('deletes rows past the window and keeps the rest', async () => {
    const user = await createUser();
    await activityEvent(user, daysAgo(1));
    await activityEvent(user, daysAgo(ACTIVITY_RETENTION_DAYS - 1));
    await activityEvent(user, daysAgo(ACTIVITY_RETENTION_DAYS + 1));

    const removed = await pruneActivityLog(user.id);
    expect(removed).toBe(1);

    const left = await prisma.feedEvent.findMany({ where: { userId: user.id } });
    expect(left).toHaveLength(2);
  });

  it('never touches another user rows', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await activityEvent(theirs, daysAgo(ACTIVITY_RETENTION_DAYS + 30));

    await pruneActivityLog(mine.id);

    expect(await prisma.feedEvent.count({ where: { userId: theirs.id } })).toBe(1);
  });

  it('leaves a brand new log alone', async () => {
    const user = await createUser();
    await activityEvent(user, new Date());

    expect(await pruneActivityLog(user.id)).toBe(0);
    expect(await prisma.feedEvent.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('notification retention', () => {
  it('deletes rows past the window and keeps the rest', async () => {
    const user = await createUser();
    await notification(user, daysAgo(1));
    await notification(user, daysAgo(NOTIFICATION_RETENTION_DAYS + 1));

    expect(await pruneNotifications(user.id)).toBe(1);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it('never touches another user rows', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await notification(theirs, daysAgo(NOTIFICATION_RETENTION_DAYS + 30));

    await pruneNotifications(mine.id);

    expect(await prisma.notification.count({ where: { userId: theirs.id } })).toBe(1);
  });
});

describe('GET /notifications pagination', () => {
  it('pages past the first 50 instead of stranding them', async () => {
    // The whole point of adding a cursor: row 51 used to be unreachable.
    const user = await createUser();
    for (let i = 0; i < 55; i += 1) {
      await notification(user, new Date(Date.now() - i * 60_000));
    }

    const first = await authed(user).get('/notifications');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(50);
    expect(first.body.cursor).not.toBeNull();

    const second = await authed(user)
      .get(`/notifications?cursor=${encodeURIComponent(first.body.cursor)}`);
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(5);
    expect(second.body.cursor).toBeNull();

    // No row appears on both pages.
    const firstIds = new Set(first.body.data.map((n: { id: string }) => n.id));
    for (const n of second.body.data) expect(firstIds.has(n.id)).toBe(false);
  });

  it('still returns data as a plain array, so the existing client keeps working', async () => {
    const user = await createUser();
    await notification(user, new Date());

    const res = await authed(user).get('/notifications');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
