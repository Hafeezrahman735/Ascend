import { prisma } from '../lib/prisma';

/**
 * One answer to "may this person see this profile, and how much of it".
 *
 * There were four different partial answers before this: `/social/users/:userId`
 * selected `privacySetting` and never read it, `/achievements/:userId` checked
 * only the `private` case and let `friends_only` through, `getFriendSummary` and
 * `getFriendSessions` each rolled their own privacy check, and `publicProfile`
 * was consulted in exactly one endpoint out of five. A flag enforced in one
 * place out of five is a stored column, not a privacy setting.
 *
 * Modelled on resolveGroupAccess in modules/social/routes.ts, which is already
 * the right shape for this: a discriminated result, so callers cannot forget to
 * handle the deny branch, and a reason so 404 and 403 stay distinguishable.
 */

/** Everything the gate needs. Selected once so callers do not re-query. */
const PRIVACY_SELECT = {
  id: true,
  privacySetting: true,
  publicProfile: true,
  shareFocusStats: true,
  friendsCanSeeActivity: true,
} as const;

export interface ProfileAccessGrant {
  ok: true;
  isSelf: boolean;
  /** True when the viewer is an accepted friend. */
  isFriend: boolean;
  /**
   * Focus stats — totals, streaks, session rows and their task labels — must be
   * withheld. Note this is NOT relaxed by following: following is unilateral
   * (POST /social/follow/:userId is a bare upsert with no approval step), so
   * treating a follow as consent would let anyone switch off someone else's
   * privacy setting by tapping Follow.
   */
  hideStats: boolean;
  /** Activity — the feed of what they have been doing — must be withheld. */
  hideActivity: boolean;
}

export type ProfileAccess =
  | ProfileAccessGrant
  | { ok: false; status: 403 | 404; error: string };

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return !!friendship;
}

/**
 * `privacySetting` and `publicProfile` are two overlapping mechanisms that both
 * shipped, so both are honoured rather than one being picked as the winner:
 * whichever is more restrictive applies. Consolidating them is a product
 * decision, not a security fix.
 */
export async function resolveProfileAccess(
  requesterId: string,
  targetId: string,
): Promise<ProfileAccess> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: PRIVACY_SELECT,
  });
  if (!target) return { ok: false, status: 404, error: 'User not found' };

  if (requesterId === targetId) {
    return { ok: true, isSelf: true, isFriend: true, hideStats: false, hideActivity: false };
  }

  const isFriend = await areFriends(requesterId, targetId);

  // A fully private profile reveals nothing to a non-friend. 403 rather than
  // 404 here, unlike private groups: the account's existence is already public
  // via search and the leaderboards, so hiding it would be a lie the rest of the
  // API immediately contradicts.
  if (target.privacySetting === 'private' && !isFriend) {
    return { ok: false, status: 403, error: 'This profile is private' };
  }
  if ((target.privacySetting === 'friends_only' || !target.publicProfile) && !isFriend) {
    return { ok: false, status: 403, error: 'This profile is private' };
  }

  return {
    ok: true,
    isSelf: false,
    isFriend,
    hideStats: !target.shareFocusStats,
    hideActivity: !target.friendsCanSeeActivity,
  };
}
