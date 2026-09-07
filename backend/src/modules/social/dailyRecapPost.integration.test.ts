import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * The daily recap post, driven through the real POST /timer/complete route
 * against a real Postgres.
 *
 * These deliberately go through the route rather than calling
 * upsertDailyRecapPost directly. The whole risk in this feature is the wiring —
 * whether finishing a session actually leaves an recap, whether a second session
 * revises the first card instead of stacking a new one, and whether the privacy
 * flags are consulted on the path a real client takes. Calling the service
 * directly would test none of that.
 */

const TWENTY_FIVE_MIN = 25 * 60;

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const todayLocal = () => dateKey(new Date());

async function completeSession(user: TestUser, over: Record<string, unknown> = {}) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: TWENTY_FIVE_MIN,
    localDate: todayLocal(),
    tz: 'UTC',
    ...over,
  });
  expect(res.status).toBe(200);
  return res;
}

async function recapPosts(user: TestUser) {
  return prisma.socialPost.findMany({
    where: { authorId: user.id, type: 'session_recap' },
    orderBy: { createdAt: 'asc' },
  });
}

function payloadOf(post: { payload: unknown }): Record<string, unknown> {
  return post.payload as Record<string, unknown>;
}

describe('daily recap post', () => {
  it('creates one on the first finished session of the day', async () => {
    const user = await createUser();

    await completeSession(user);

    const posts = await recapPosts(user);
    expect(posts).toHaveLength(1);
    expect(posts[0].visibility).toBe('public');

    const payload = payloadOf(posts[0]);
    expect(payload.localDate).toBe(todayLocal());
    expect(payload.auto).toBe(true);
    expect(payload.sessionCount).toBe(1);
    expect(payload.focusMinutes).toBe(25);
  });

  it('revises the SAME post on later sessions rather than stacking new ones', async () => {
    // The point of the whole design: three pomodoros is one receipt reading
    // "3 sessions", not three cards in everyone else's feed.
    const user = await createUser();

    await completeSession(user);
    await completeSession(user);
    await completeSession(user);

    const posts = await recapPosts(user);
    expect(posts).toHaveLength(1);

    const payload = payloadOf(posts[0]);
    expect(payload.sessionCount).toBe(3);
    expect(payload.focusMinutes).toBe(75);
  });

  it('counts tasks finished today alongside the sessions', async () => {
    const user = await createUser();

    const created = await authed(user).post('/tasks').send({ title: 'Rewrite the methods section' });
    expect(created.status).toBe(200);
    const taskId = created.body.data.id as string;

    // `completedAt` is sent explicitly, not derived from `isCompleted` — that is
    // how stores/taskStore.ts completes a task, and the instant is what decides
    // which local day the task lands on.
    const done = await authed(user).patch(`/tasks/${taskId}`).send({
      isCompleted: true,
      completedAt: new Date().toISOString(),
    });
    expect(done.status).toBe(200);

    await completeSession(user);

    const posts = await recapPosts(user);
    expect(payloadOf(posts[0]).tasksCompleted).toBe(1);
  });

  it('starts a separate post for a different local day', async () => {
    const user = await createUser();

    await completeSession(user);
    // One day back is inside what the route accepts as a plausible local date,
    // and is how a session finished either side of midnight reaches the server.
    const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await completeSession(user, { localDate: yesterday });

    const posts = await recapPosts(user);
    expect(posts).toHaveLength(2);
    const days = posts.map((p) => payloadOf(p).localDate).sort();
    expect(days).toEqual([yesterday, todayLocal()].sort());
  });

  it('shows up on the feed of the person who ran the session', async () => {
    const user = await createUser();

    await completeSession(user);

    const feed = await authed(user).get('/social/posts');
    expect(feed.status).toBe(200);
    const recaps = feed.body.data.posts.filter((p: { type: string }) => p.type === 'session_recap');
    expect(recaps).toHaveLength(1);
    expect(recaps[0].sessionCount).toBe(1);
    expect(recaps[0].authorId).toBe(user.id);
  });

  it('reaches a follower feed', async () => {
    const author = await createUser();
    const follower = await createUser();

    const follow = await authed(follower).post(`/social/follow/${author.id}`);
    expect(follow.status).toBeLessThan(400);

    await completeSession(author);

    const feed = await authed(follower).get('/social/posts');
    expect(feed.status).toBe(200);
    const recaps = feed.body.data.posts.filter((p: { authorId: string }) => p.authorId === author.id);
    expect(recaps).toHaveLength(1);
    expect(recaps[0].sessionCount).toBe(1);
  });
});

describe('daily recap post — privacy', () => {
  /**
   * These are the tests that decide whether the privacy flags are real. Both
   * default to true, so a user who has turned one OFF has made a deliberate
   * choice, and auto-publishing their focus numbers over it would be the exact
   * failure mode privacy.integration.test.ts was written to catch elsewhere.
   */
  it('writes nothing when shareFocusStats is off', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { shareFocusStats: false } });

    await completeSession(user);

    expect(await recapPosts(user)).toHaveLength(0);
  });

  it('writes nothing when publicProfile is off', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { publicProfile: false } });

    await completeSession(user);

    expect(await recapPosts(user)).toHaveLength(0);
  });

  it('still records the session itself when posting is declined', async () => {
    // Privacy must cost you the post, never the focus time.
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { shareFocusStats: false } });

    const res = await completeSession(user);

    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(TWENTY_FIVE_MIN);
  });

  it('stops revising an existing post once the flag is turned off', async () => {
    const user = await createUser();
    await completeSession(user);
    await prisma.user.update({ where: { id: user.id }, data: { shareFocusStats: false } });

    await completeSession(user);

    const posts = await recapPosts(user);
    expect(posts).toHaveLength(1);
    // Frozen at the one session it had before the flag flipped.
    expect(payloadOf(posts[0]).sessionCount).toBe(1);
  });
});

describe('daily recap post — hand-written recaps', () => {
  it('never overwrites a session_recap the user composed themselves', async () => {
    // A manual recap carries no `auto` flag, so the upsert must not adopt it.
    // Without that clause the automation would rewrite the user's own caption
    // out of existence on their next pomodoro.
    const user = await createUser();

    const manual = await authed(user).post('/social/posts').send({
      type: 'session_recap',
      caption: 'Ground through the whole methods section today.',
      visibility: 'public',
    });
    expect(manual.status).toBe(201);

    await completeSession(user);

    const posts = await recapPosts(user);
    expect(posts).toHaveLength(2);

    const kept = posts.find((p) => p.id === manual.body.data.id);
    expect(kept?.caption).toBe('Ground through the whole methods section today.');
    expect(payloadOf(kept!).auto).toBeUndefined();

    const auto = posts.find((p) => p.id !== manual.body.data.id);
    expect(payloadOf(auto!).auto).toBe(true);
  });
});
