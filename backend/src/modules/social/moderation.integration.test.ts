import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Report and block — the two mechanisms App Store Guideline 1.2 requires an app
 * with user-generated content to provide.
 *
 * These routes shipped without tests, which mattered more than usual: they are
 * what the app's approval rests on, and a silent regression in either would not
 * be caught by anything else. The feed-side effect of a block is covered
 * separately in feedScope.integration.test.ts; this file covers the endpoints.
 */
async function post(author: TestUser, caption = 'a post') {
  return prisma.socialPost.create({
    data: { authorId: author.id, type: 'free_post', caption, visibility: 'public' },
  });
}

describe('POST /social/posts/:id/report', () => {
  it('records a report against the post', async () => {
    const author = await createUser();
    const reporter = await createUser();
    const target = await post(author);

    const res = await authed(reporter)
      .post(`/social/posts/${target.id}/report`)
      .send({ reason: 'inappropriate' });

    expect(res.status).toBe(200);
    expect(res.body.data.reported).toBe(true);

    const rows = await prisma.postReport.findMany({ where: { postId: target.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reportedBy).toBe(reporter.id);
    expect(rows[0].reason).toBe('inappropriate');
  });

  it('accepts a report with no reason given', async () => {
    const author = await createUser();
    const reporter = await createUser();
    const target = await post(author);

    const res = await authed(reporter).post(`/social/posts/${target.id}/report`).send({});

    expect(res.status).toBe(200);
    const rows = await prisma.postReport.findMany({ where: { postId: target.id } });
    expect(rows[0].reason).toBeNull();
  });

  it('is idempotent — a repeat report does not create a second row', async () => {
    // The unique index is what makes the report count mean something. Without
    // it one account could report the same post unboundedly, and any future
    // count-based moderation would let a single user bury any post.
    const author = await createUser();
    const reporter = await createUser();
    const target = await post(author);

    const first = await authed(reporter)
      .post(`/social/posts/${target.id}/report`)
      .send({ reason: 'inappropriate' });
    const second = await authed(reporter)
      .post(`/social/posts/${target.id}/report`)
      .send({ reason: 'inappropriate again' });

    // Identical answers: a user who taps the flag twice is told it worked both
    // times rather than learning about hidden state.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await prisma.postReport.findMany({ where: { postId: target.id } });
    expect(rows).toHaveLength(1);
  });

  it('lets two different users report the same post', async () => {
    const author = await createUser();
    const one = await createUser();
    const two = await createUser();
    const target = await post(author);

    await authed(one).post(`/social/posts/${target.id}/report`).send({});
    await authed(two).post(`/social/posts/${target.id}/report`).send({});

    const rows = await prisma.postReport.findMany({ where: { postId: target.id } });
    expect(rows).toHaveLength(2);
  });

  it('404s for a post that does not exist', async () => {
    const reporter = await createUser();
    const res = await authed(reporter)
      .post('/social/posts/00000000-0000-0000-0000-000000000000/report')
      .send({});

    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated report', async () => {
    const author = await createUser();
    const target = await post(author);

    const res = await request(app).post(`/social/posts/${target.id}/report`).send({});
    expect(res.status).toBe(401);
  });

  it('rejects a reason longer than the schema allows', async () => {
    const author = await createUser();
    const reporter = await createUser();
    const target = await post(author);

    const res = await authed(reporter)
      .post(`/social/posts/${target.id}/report`)
      .send({ reason: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });
});

describe('POST /social/users/:id/block', () => {
  it('blocks another user', async () => {
    const blocker = await createUser();
    const blocked = await createUser();

    const res = await authed(blocker).post(`/social/users/${blocked.id}/block`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(true);

    const row = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: blocker.id, blockedId: blocked.id } },
    });
    expect(row).not.toBeNull();
  });

  it('is idempotent — blocking twice stays blocked', async () => {
    const blocker = await createUser();
    const blocked = await createUser();

    await authed(blocker).post(`/social/users/${blocked.id}/block`).send({});
    const second = await authed(blocker).post(`/social/users/${blocked.id}/block`).send({});

    expect(second.status).toBe(200);
    const rows = await prisma.userBlock.findMany({ where: { blockerId: blocker.id } });
    expect(rows).toHaveLength(1);
  });

  it('refuses a self-block', async () => {
    const user = await createUser();
    const res = await authed(user).post(`/social/users/${user.id}/block`).send({});
    expect(res.status).toBe(400);
  });

  it('404s for a user that does not exist', async () => {
    const user = await createUser();
    const res = await authed(user)
      .post('/social/users/00000000-0000-0000-0000-000000000000/block')
      .send({});
    expect(res.status).toBe(404);
  });

  it('rejects an unauthenticated block', async () => {
    const blocked = await createUser();
    const res = await request(app).post(`/social/users/${blocked.id}/block`).send({});
    expect(res.status).toBe(401);
  });
});

describe('DELETE /social/users/:id/block', () => {
  it('unblocks a user', async () => {
    const blocker = await createUser();
    const blocked = await createUser();

    await authed(blocker).post(`/social/users/${blocked.id}/block`).send({});
    const res = await authed(blocker).delete(`/social/users/${blocked.id}/block`);

    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(false);

    const row = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: blocker.id, blockedId: blocked.id } },
    });
    expect(row).toBeNull();
  });

  it('is idempotent — unblocking someone who was never blocked succeeds', async () => {
    const blocker = await createUser();
    const other = await createUser();

    const res = await authed(blocker).delete(`/social/users/${other.id}/block`);
    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated unblock', async () => {
    const blocked = await createUser();
    const res = await request(app).delete(`/social/users/${blocked.id}/block`);
    expect(res.status).toBe(401);
  });
});
