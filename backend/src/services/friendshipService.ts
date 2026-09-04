import { prisma } from '../lib/prisma';
import { resolveProfileAccess } from './profileAccess';

export async function getFriendIds(userId: string): Promise<string[]> {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userId, status: 'accepted' },
        { addresseeId: userId, status: 'accepted' },
      ],
    },
    select: { requesterId: true, addresseeId: true },
  });

  return friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );
}

export async function getFriendCount(userId: string): Promise<number> {
  const ids = await getFriendIds(userId);
  return ids.length;
}

export async function getFriendSessions(
  requestingUserId: string,
  targetUserId: string,
  limit = 10,
) {
  // One gate, shared with the profile and achievement reads. This used to check
  // `privacySetting` alone, which meant `publicProfile: false` was ignored here
  // and — more to the point — `shareFocusStats: false` was ignored entirely.
  // These rows carry `taskLabel`, so what leaked was not just how much someone
  // focused but what they called the work.
  const access = await resolveProfileAccess(requestingUserId, targetUserId);
  if (!access.ok) {
    if (access.status === 404) throw new Error('User not found');
    return [];
  }
  if (access.hideStats) return [];

  const sessions = await prisma.session.findMany({
    where: { userId: targetUserId },
    orderBy: { completedAt: 'desc' },
    take: limit,
    select: {
      type: true,
      durationSeconds: true,
      taskLabel: true,
      completedAt: true,
    },
  });

  return sessions;
}
