import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * The two shapes of the non-group feed.
 *
 * `scope=public` is the OPEN feed: every public post from anyone. It exists
 * because the follow-scoped feed has nothing to show an account that follows
 * nobody, so a new user opened the social tab to an empty screen and stayed
 * there until they went hunting for people to follow.
 *
 * No scope is the follow-scoped feed, unchanged. That is the DEFAULT on
 * purpose: the client asks for `scope=public` explicitly, so an older app
 * binary that sends neither keeps the feed it has always had instead of being
 * switched to a global one by a server deploy it knows nothing about.
 *
 * The thing both must never do is leak a group post. `visibility` is the gate,
 * and widening the audience must not widen what is visible.
 */

async function post(
  author: TestUser,
  caption: string,
  overrides: { visibility?: string; groupId?: string } = {},
) {
  return prisma.socialPost.create({
    data: {
      authorId: author.id,
      type: 'free_post',
      caption,
      visibility: overrides.visibility ?? 'public',
      groupId: overrides.groupId ?? null,
    },
  });
}

const contentsOf = (body: { data: { posts: { caption: string | null }[] } }) =>
  body.data.posts.map((p) => p.caption);

describe('GET /social/posts?scope=public', () => {
  it('shows a stranger’s public post to someone who follows nobody', async () => {
    // The whole point. This account has no follows, which is every account on
    // its first day.
    const [newcomer, stranger] = [await createUser(), await createUser()];
    await post(stranger, 'a stranger’s recap');

    const res = await authed(newcomer).get('/social/posts?scope=public');

    expect(res.status).toBe(200);
    expect(contentsOf(res.body)).toContain('a stranger’s recap');
  });

  it('includes your own public posts too', async () => {
    const user = await createUser();
    await post(user, 'mine');

    const res = await authed(user).get('/social/posts?scope=public');

    expect(contentsOf(res.body)).toContain('mine');
  });

  it('never leaks a group post', async () => {
    // Widening the audience must not widen what is visible. visibility is the
    // gate, and a focus group is private whoever is looking.
    const [viewer, member] = [await createUser(), await createUser()];
    const group = await prisma.studyGroup.create({
      data: { name: 'Private study', emoji: '📚', isPrivate: true, createdBy: member.id },
    });
    await post(member, 'said inside the group', { visibility: 'group', groupId: group.id });
    await post(member, 'said in the open');

    const res = await authed(viewer).get('/social/posts?scope=public');

    expect(contentsOf(res.body)).toContain('said in the open');
    expect(contentsOf(res.body)).not.toContain('said inside the group');
  });

  it('excludes a blocked author', async () => {
    const [viewer, blocked] = [await createUser(), await createUser()];
    await post(blocked, 'from someone blocked');
    await prisma.userBlock.create({ data: { blockerId: viewer.id, blockedId: blocked.id } });

    const res = await authed(viewer).get('/social/posts?scope=public');

    expect(contentsOf(res.body)).not.toContain('from someone blocked');
  });
});

describe('GET /social/posts with no scope — unchanged', () => {
  it('still hides a stranger you do not follow', async () => {
    // The regression guard. An older binary sends no scope and must keep the
    // follow-scoped feed it has always had.
    const [newcomer, stranger] = [await createUser(), await createUser()];
    await post(stranger, 'a stranger’s recap');

    const res = await authed(newcomer).get('/social/posts');

    expect(res.status).toBe(200);
    expect(contentsOf(res.body)).not.toContain('a stranger’s recap');
  });

  it('shows someone you DO follow', async () => {
    const [follower, followed] = [await createUser(), await createUser()];
    await post(followed, 'from someone I follow');
    await prisma.follow.create({ data: { followerId: follower.id, followingId: followed.id } });

    const res = await authed(follower).get('/social/posts');

    expect(contentsOf(res.body)).toContain('from someone I follow');
  });

  it('still shows your own public posts', async () => {
    const user = await createUser();
    await post(user, 'mine');

    const res = await authed(user).get('/social/posts');

    expect(contentsOf(res.body)).toContain('mine');
  });
});
