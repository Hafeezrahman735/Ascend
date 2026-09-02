import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Privacy flags, enforced against a real database.
 *
 * Each of these fails against the code as it was before the security pass:
 * `publicProfile` was consulted in one endpoint out of five, `shareFocusStats`
 * was bypassable by tapping Follow and ignored entirely by two endpoints that
 * return the same class of data, and `friendsCanSeeActivity` had no read path
 * at all on the feed it names.
 *
 * A stored column nobody reads is not a privacy setting, and the only way to
 * tell the difference is a test that asks the route.
 */

async function setPrivacy(user: TestUser, patch: Record<string, boolean | string>) {
  await prisma.user.update({ where: { id: user.id }, data: patch });
}

async function befriend(a: TestUser, b: TestUser) {
  await prisma.friendship.create({
    data: { requesterId: a.id, addresseeId: b.id, status: 'accepted' },
  });
}

describe('publicProfile', () => {
  it('hides a profile from a stranger when it is off', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await setPrivacy(owner, { publicProfile: false });

    const res = await authed(stranger).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(403);
  });

  it('still shows it to an accepted friend', async () => {
    const owner = await createUser();
    const friend = await createUser();
    await setPrivacy(owner, { publicProfile: false });
    await befriend(owner, friend);

    const res = await authed(friend).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(200);
  });

  it('never hides your own profile from you', async () => {
    const owner = await createUser();
    await setPrivacy(owner, { publicProfile: false, privacySetting: 'private' });

    const res = await authed(owner).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(200);
  });
});

describe('shareFocusStats', () => {
  /**
   * Real numbers on the account, or the assertion is 0 === 0 and passes against
   * a completely unprotected route. Found exactly that way: both tests below
   * originally passed against the pre-fix code.
   */
  async function withStats(user: TestUser) {
    await prisma.user.update({
      where: { id: user.id },
      data: { totalFocusTime: 9999, totalSessions: 42 },
    });
  }

  it('withholds focus stats from a stranger when it is off', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await withStats(owner);
    await setPrivacy(owner, { shareFocusStats: false });

    const res = await authed(stranger).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(200);
    // The profile still resolves; the numbers are what is withheld.
    expect(res.body.data.totalFocusTime ?? 0).toBe(0);
    expect(res.body.data.totalSessions ?? 0).toBe(0);
  });

  it('shows the stats when it is on, so the test above proves something', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await withStats(owner);

    const res = await authed(stranger).get(`/social/users/${owner.id}`);
    expect(res.body.data.totalFocusTime).toBe(9999);
  });

  it('is NOT unlocked by following, because following needs no approval', async () => {
    // The regression this pins: the check was `!shareFocusStats && !isFollowing`,
    // so anyone could switch off someone else's privacy setting by tapping
    // Follow — POST /social/follow/:userId is a bare upsert with no consent step.
    const owner = await createUser();
    const follower = await createUser();
    await withStats(owner);
    await setPrivacy(owner, { shareFocusStats: false });

    const follow = await authed(follower).post(`/social/follow/${owner.id}`);
    expect(follow.status).toBe(200);

    const res = await authed(follower).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalFocusTime ?? 0).toBe(0);
  });

  it('blocks the analytics summary when it is off', async () => {
    const owner = await createUser();
    const friend = await createUser();
    await setPrivacy(owner, { shareFocusStats: false });
    await befriend(owner, friend);

    const res = await authed(friend).get(`/analytics/summary/${owner.id}`);
    expect(res.status).toBe(403);
  });

  it('returns no session rows when it is off', async () => {
    // These rows carry taskLabel, so what leaked was not just how long someone
    // focused but what they called the work.
    const owner = await createUser();
    const friend = await createUser();
    await befriend(owner, friend);
    await prisma.session.create({
      data: {
        userId: owner.id, type: 'focus', durationSeconds: 1500,
        taskLabel: 'Divorce paperwork', completedAt: new Date(),
      },
    });

    const before = await authed(friend).get(`/social/friend/${owner.id}/sessions`);
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(1);

    await setPrivacy(owner, { shareFocusStats: false });
    const after = await authed(friend).get(`/social/friend/${owner.id}/sessions`);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual([]);
  });
});

describe('friendsCanSeeActivity', () => {
  it('drops a friend from your feed when they turn it off', async () => {
    const me = await createUser();
    const friend = await createUser();
    await befriend(me, friend);

    await prisma.feedEvent.create({
      data: { userId: friend.id, eventType: 'session_completed', payload: { durationMinutes: 25 } },
    });

    const before = await authed(me).get('/social/feed');
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(1);

    await setPrivacy(friend, { friendsCanSeeActivity: false });
    const after = await authed(me).get('/social/feed');
    expect(after.body.data).toEqual([]);
  });

  it('still shows you your own events when you turn it off', async () => {
    // The setting governs who else sees you, not whether you can see yourself.
    const me = await createUser();
    await setPrivacy(me, { friendsCanSeeActivity: false });
    await prisma.feedEvent.create({
      data: { userId: me.id, eventType: 'session_completed', payload: { durationMinutes: 25 } },
    });

    const res = await authed(me).get('/social/feed');
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /achievements/:userId', () => {
  it('refuses a friends_only profile to a stranger', async () => {
    // Was checking only privacySetting === 'private', so friends_only fell
    // straight through and handed a stranger the full achievement set.
    const owner = await createUser();
    const stranger = await createUser();
    await setPrivacy(owner, { privacySetting: 'friends_only' });

    const res = await authed(stranger).get(`/achievements/${owner.id}`);
    expect(res.status).toBe(403);
  });

  it('refuses when publicProfile is off', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await setPrivacy(owner, { publicProfile: false });

    const res = await authed(stranger).get(`/achievements/${owner.id}`);
    expect(res.status).toBe(403);
  });

  it('allows a friend through', async () => {
    const owner = await createUser();
    const friend = await createUser();
    await setPrivacy(owner, { privacySetting: 'friends_only' });
    await befriend(owner, friend);

    const res = await authed(friend).get(`/achievements/${owner.id}`);
    expect(res.status).toBe(200);
  });

  it('404s for a user that does not exist', async () => {
    const viewer = await createUser();
    const res = await authed(viewer).get('/achievements/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
