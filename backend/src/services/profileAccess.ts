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
} as const;

export interface ProfileAccessGrant {
  ok: true;
  isSelf: boolean;
  /**
   * Focus stats — totals, streaks, session rows and their task labels — must be
   * withheld. Note this is NOT relaxed by following: following is unilateral
   * (POST /social/follow/:userId is a bare upsert with no approval step), so
   * treating a follow as consent would let anyone switch off someone else's
   * privacy setting by tapping Follow.
   */
  hideStats: boolean;
}

export type ProfileAccess =
  | ProfileAccessGrant
  | { ok: false; status: 403 | 404; error: string };

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
    return { ok: true, isSelf: true, hideStats: false };
  }

  // A private profile reveals nothing. 403 rather than 404, unlike private
  // groups: the account's existence is already public via search and the
  // leaderboards, so hiding it would be a lie the rest of the API immediately
  // contradicts.
  //
  // `friends_only` is treated exactly as `private`. It used to mean "unless you
  // are an accepted friend", and friendships no longer exist — so the exception
  // it carved out can never apply to anyone. Keeping the enum value means
  // nobody's stored choice is silently rewritten to something LESS private; it
  // simply resolves the only way it now can. Following deliberately does not
  // open this door: a follow is unilateral, so honouring it would let anyone
  // switch off someone else's privacy setting by tapping Follow.
  if (target.privacySetting === 'private' || target.privacySetting === 'friends_only' || !target.publicProfile) {
    return { ok: false, status: 403, error: 'This profile is private' };
  }

  return {
    ok: true,
    isSelf: false,
    hideStats: !target.shareFocusStats,
  };
}
