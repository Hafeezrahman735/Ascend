import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';

/**
 * Feed scoping. Two destinations, two feeds, no leaking between them:
 *
 *   GET /social/posts                 public feed  — visibility:'public' from
 *                                     people you follow, plus your own
 *   GET /social/posts?groupId=<id>    that group's posts, access-gated
 *
 * The public feed previously OR'd in `{ authorId: userId }` with no visibility
 * filter, so your own private-group posts appeared on the open feed. These pin
 * that shut.
 */

async function makeGroup(user: TestUser) {
  const res = await authed(user).post('/social/groups').send({
    name: 'Private crew', emoji: '🔒', color: 'purple', isPrivate: true,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function post(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/social/posts').send({ type: 'free_post', ...body });
  return res;
}

const captions = (res: { body: { data: { posts: { caption: string }[] } } }) =>
  res.body.data.posts.map((p) => p.caption).sort();

describe('GET /social/posts — public feed', () => {
  it('does NOT leak your own group post into the public feed', async () => {
    const user = await createUser();
    const groupId = await makeGroup(user);

    await post(user, { caption: 'public one', visibility: 'public' });
    await post(user, { caption: 'group secret', visibility: 'group', groupId });

    const feed = await authed(user).get('/social/posts');

    expect(feed.status).toBe(200);
    expect(captions(feed)).toEqual(['public one']);
  });

  it('still shows your own public posts', async () => {
    const user = await createUser();
    await post(user, { caption: 'mine', visibility: 'public' });

    expect(captions(await authed(user).get('/social/posts'))).toEqual(['mine']);
  });

  it('shows public posts from people you follow', async () => {
    const me = await createUser();
    const them = await createUser();
    await authed(me).post(`/social/follow/${them.id}`).send({});
    await post(them, { caption: 'theirs', visibility: 'public' });

    expect(captions(await authed(me).get('/social/posts'))).toContain('theirs');
  });

  it('hides public posts from people you do not follow', async () => {
    const me = await createUser();
    const stranger = await createUser();
    await post(stranger, { caption: 'stranger post', visibility: 'public' });

    expect(captions(await authed(me).get('/social/posts'))).not.toContain('stranger post');
  });

  it('never shows another member group post on the public feed', async () => {
    const owner = await createUser();
    const member = await createUser();
    const groupId = await makeGroup(owner);
    await authed(owner).post(`/social/groups/${groupId}/members`).send({ userId: member.id });
    await authed(member).post(`/social/follow/${owner.id}`).send({});

    await post(owner, { caption: 'group only', visibility: 'group', groupId });

    expect(captions(await authed(member).get('/social/posts'))).not.toContain('group only');
  });
});

describe('GET /social/posts?groupId= — group feed', () => {
  it('returns the group posts and nothing public', async () => {
    const user = await createUser();
    const groupId = await makeGroup(user);
    await post(user, { caption: 'public one', visibility: 'public' });
    await post(user, { caption: 'group one', visibility: 'group', groupId });

    const feed = await authed(user).get(`/social/posts?groupId=${groupId}`);

    expect(feed.status).toBe(200);
    expect(captions(feed)).toEqual(['group one']);
  });

  it('refuses a private group you are not in', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const groupId = await makeGroup(owner);
    await post(owner, { caption: 'group one', visibility: 'group', groupId });

    const feed = await authed(outsider).get(`/social/posts?groupId=${groupId}`);

    expect(feed.status).toBe(404);
  });

  it('rejects a group post that names no group', async () => {
    // The composer lets you pick "Focus Group" as a destination; without a group
    // chosen this is what the server says.
    const user = await createUser();
    const res = await post(user, { caption: 'nowhere', visibility: 'group' });
    expect(res.status).toBe(400);
  });

  it('rejects posting into a group you do not belong to', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const groupId = await makeGroup(owner);

    const res = await post(outsider, { caption: 'intruder', visibility: 'group', groupId });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
