import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * GET /notifications — every notification reachable, and an honest badge.
 *
 * The app read only the first page and counted unread rows inside it, so the
 * badge could never exceed the page size and anything older than the newest
 * 50 was unreachable. The route now reports the true unread total, and its
 * cursor breaks createdAt ties: a fan-out writes many rows in one millisecond,
 * and a timestamp-only boundary skipped every row sharing it.
 */

async function seed(user: TestUser, count: number, opts: { at?: Date; unread?: (i: number) => boolean } = {}) {
  const at = opts.at;
  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId: user.id,
      type: 'follow',
      title: `N${i}`,
      body: '',
      isRead: opts.unread ? !opts.unread(i) : false,
      createdAt: at ?? new Date(Date.now() - i * 1000),
    })),
  });
}

async function readAllPages(user: TestUser) {
  const ids: string[] = [];
  const unreadCounts: number[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url: string = cursor ? `/notifications?cursor=${encodeURIComponent(cursor)}` : '/notifications';
    const res = await authed(user).get(url);
    expect(res.status).toBe(200);
    ids.push(...res.body.data.map((n: { id: string }) => n.id));
    unreadCounts.push(res.body.unreadCount);
    cursor = res.body.cursor;
    if (!cursor) return { ids, unreadCounts, pages: page + 1 };
  }
  throw new Error('pagination did not terminate');
}

describe('GET /notifications — paging', () => {
  it('reaches every notification, oldest included, with none repeated', async () => {
    const user = await createUser();
    await seed(user, 120);

    const { ids, pages } = await readAllPages(user);

    expect(pages).toBe(3);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it('does not skip rows that share the page boundary’s timestamp', async () => {
    // All 120 written in the same millisecond, as a fan-out does. The old
    // `createdAt < cursor` boundary returned page one and then nothing.
    const user = await createUser();
    await seed(user, 120, { at: new Date() });

    const { ids } = await readAllPages(user);

    expect(new Set(ids).size).toBe(120);
  });

  it('still accepts the old timestamp-only cursor', async () => {
    const user = await createUser();
    await seed(user, 3);
    const middle = await prisma.notification.findFirstOrThrow({ where: { userId: user.id, title: 'N1' } });

    const res = await authed(user).get(`/notifications?cursor=${encodeURIComponent(middle.createdAt.toISOString())}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual(['N2']);
  });

  it('rejects a malformed cursor with 400, not a server error', async () => {
    const user = await createUser();
    for (const bad of ['yesterday', '2026-10-21T00:00:00.000Z|not-a-uuid']) {
      const res = await authed(user).get(`/notifications?cursor=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /notifications — unread count', () => {
  it('reports the true unread total on every page, not the page’s', async () => {
    const user = await createUser();
    await seed(user, 120, { unread: (i) => i % 3 !== 0 }); // 80 unread

    const { unreadCounts } = await readAllPages(user);

    expect(unreadCounts).toEqual([80, 80, 80]);
  });

  it('drops to zero after read-all', async () => {
    const user = await createUser();
    await seed(user, 60);

    const readAll = await authed(user).post('/notifications/read-all');
    expect(readAll.status).toBe(200);

    const res = await authed(user).get('/notifications');
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.data.every((n: { isRead: boolean }) => n.isRead)).toBe(true);
  });

  it('counts and lists only the caller’s notifications', async () => {
    const me = await createUser();
    const other = await createUser();
    await seed(me, 2);
    await seed(other, 70);

    const res = await authed(me).get('/notifications');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.cursor).toBeNull();
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(401);
  });
});
