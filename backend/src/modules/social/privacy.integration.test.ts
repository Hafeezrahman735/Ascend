import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Privacy flags, enforced against a real database.
 *
 * Each of these fails against the code as it was before the security pass:
 * `publicProfile` was consulted in one endpoint out of five, `shareFocusStats`
 * was bypassable by tapping Follow and ignored entirely by two endpoints that
 * return the same class of data. (A third flag, `friendsCanSeeActivity`, has
 * since been removed outright: every route that read it is gone, and a switch
 * in Settings that controls nothing is worse than no switch.)
 *
 * A stored column nobody reads is not a privacy setting, and the only way to
 * tell the difference is a test that asks the route.
 */

async function setPrivacy(user: TestUser, patch: Record<string, boolean | string>) {
  await prisma.user.update({ where: { id: user.id }, data: patch });
}

/**
 * NOTE on cases that used to live here. They guarded three endpoints:
 * `GET /analytics/summary/:userId`, `GET /social/friend/:userId/sessions` and
 * `GET /achievements/:userId` — asserting each returned 403 rather than leaking
 * when a privacy flag was off. All three have since been DELETED as dead code;
 * not one had a caller anywhere in the app.
 *
 * The protection is now structural rather than conditional. An endpoint that
 * does not exist cannot leak, which is strictly stronger than one that has to
 * remember to check a flag — and remembering is exactly what the rest of this
 * file exists to verify for the endpoints that DO remain.
 */
describe('publicProfile', () => {
  it('hides a profile from a stranger when it is off', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await setPrivacy(owner, { publicProfile: false });

    const res = await authed(stranger).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(403);
  });

  it('is absolute — a follower does not get in either', async () => {
    // This used to carve out an exception for accepted friends. Friendships are
    // gone, and following deliberately does NOT inherit that exception: a follow
    // is unilateral, so honouring it would let anyone switch off someone else's
    // privacy setting just by tapping Follow.
    const owner = await createUser();
    const follower = await createUser();
    await setPrivacy(owner, { publicProfile: false });
    const follow = await authed(follower).post(`/social/follow/${owner.id}`);
    expect(follow.status).toBe(200);

    const res = await authed(follower).get(`/social/users/${owner.id}`);
    expect(res.status).toBe(403);
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

});

