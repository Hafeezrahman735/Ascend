import { prisma } from '../lib/prisma';

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

export async function getFriendsWithDetails(userId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: userId, status: 'accepted' },
        { addresseeId: userId, status: 'accepted' },
      ],
    },
    include: {
      requester: { select: { id: true, username: true, avatarUrl: true, privacySetting: true } },
      addressee: { select: { id: true, username: true, avatarUrl: true, privacySetting: true } },
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const friendIds = friendships.map((f) =>
    f.requesterId === userId ? f.addresseeId : f.requesterId,
  );

  // One query for everyone's focus sessions today (newest first); the first row
  // seen per user is their latest. Replaces the per-friend N+1 findFirst.
  const todaySessions = friendIds.length > 0
    ? await prisma.session.findMany({
        where: { userId: { in: friendIds }, type: 'focus', completedAt: { gte: today } },
        orderBy: { completedAt: 'desc' },
        select: { userId: true, completedAt: true },
      })
    : [];
  const latestByUser = new Map<string, Date>();
  for (const s of todaySessions) {
    if (!latestByUser.has(s.userId)) latestByUser.set(s.userId, s.completedAt);
  }

  return friendships.map((f) => {
    const friend = f.requesterId === userId ? f.addressee : f.requester;
    const lastActive = latestByUser.get(friend.id) || null;

    return {
      friendshipId: f.id,
      ...friend,
      createdAt: f.createdAt,
      activeToday: !!lastActive,
      lastActive,
    };
  });
}

export async function getFriendSessions(
  requestingUserId: string,
  targetUserId: string,
  limit = 10,
) {
  if (requestingUserId !== targetUserId) {
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { privacySetting: true },
    });
    if (!targetUser) throw new Error('User not found');

    if (targetUser.privacySetting === 'private') {
      return [];
    }

    if (targetUser.privacySetting === 'friends_only') {
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: requestingUserId, addresseeId: targetUserId, status: 'accepted' },
            { requesterId: targetUserId, addresseeId: requestingUserId, status: 'accepted' },
          ],
        },
      });
      if (!friendship) return [];
    }
  }

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

export async function checkFriendshipAccess(
  requestingUserId: string,
  targetUserId: string,
): Promise<{ allowed: boolean; error?: string }> {
  if (requestingUserId === targetUserId) return { allowed: true };

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { privacySetting: true },
  });

  if (!targetUser) return { allowed: false, error: 'User not found' };

  if (targetUser.privacySetting === 'private') {
    return { allowed: false, error: "This user's stats are private" };
  }

  if (targetUser.privacySetting === 'friends_only') {
    const friendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: requestingUserId, addresseeId: targetUserId, status: 'accepted' },
          { requesterId: targetUserId, addresseeId: requestingUserId, status: 'accepted' },
        ],
      },
    });
    if (!friendship) {
      return { allowed: false, error: "This user's stats are private" };
    }
  }

  return { allowed: true };
}

export async function getPendingSentIds(userId: string): Promise<Set<string>> {
  const pending = await prisma.friendship.findMany({
    where: { requesterId: userId, status: 'pending' },
    select: { addresseeId: true },
  });
  return new Set(pending.map((p) => p.addresseeId));
}

export async function getPendingReceivedIds(userId: string): Promise<Set<string>> {
  const pending = await prisma.friendship.findMany({
    where: { addresseeId: userId, status: 'pending' },
    select: { requesterId: true },
  });
  return new Set(pending.map((p) => p.requesterId));
}
