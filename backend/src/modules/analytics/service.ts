import { prisma } from '../../lib/prisma';
import { PrivacySetting } from '@prisma/client';

interface FriendSummaryResult {
  totalSessions: number;
  totalHours: number;
  currentStreak: number;
  longestStreak: number;
  averageSessionsPerDay: number;
  thisWeekSessions: number;
}

export async function getFriendSummary(
  requestingUserId: string,
  targetUserId: string,
): Promise<FriendSummaryResult> {
  if (requestingUserId !== targetUserId) {
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { privacySetting: true },
    });

    if (!targetUser) {
      throw new Error('User not found');
    }

    if (targetUser.privacySetting === PrivacySetting.private) {
      throw new Error('This user\'s stats are private');
    }

    if (targetUser.privacySetting === PrivacySetting.friends_only) {
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: requestingUserId, addresseeId: targetUserId, status: 'accepted' },
            { requesterId: targetUserId, addresseeId: requestingUserId, status: 'accepted' },
          ],
        },
      });
      if (!friendship) {
        throw new Error('This user\'s stats are private');
      }
    }
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  // These four reads are independent — run them in parallel and fold the
  // total-count + total-duration into a single aggregate. Same results, fewer
  // round-trips, shorter DB compute window.
  const [totalAgg, streak, thisWeekSessions, oldestSession] = await Promise.all([
    prisma.session.aggregate({
      where: { userId: targetUserId, type: 'focus' },
      _count: true,
      _sum: { durationSeconds: true },
    }),
    prisma.streak.findUnique({ where: { userId: targetUserId } }),
    prisma.session.count({
      where: { userId: targetUserId, type: 'focus', completedAt: { gte: weekStart } },
    }),
    prisma.session.findFirst({
      where: { userId: targetUserId, type: 'focus' },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true },
    }),
  ]);

  const totalSessions = totalAgg._count;
  const totalHours = totalAgg._sum.durationSeconds
    ? Math.round((totalAgg._sum.durationSeconds / 3600) * 10) / 10
    : 0;

  let averageSessionsPerDay = 0;
  if (oldestSession) {
    const daysSinceFirst = Math.max(
      1,
      Math.floor((Date.now() - oldestSession.completedAt.getTime()) / 86400000),
    );
    averageSessionsPerDay = Math.round((totalSessions / daysSinceFirst) * 10) / 10;
  }

  return {
    totalSessions,
    totalHours,
    currentStreak: streak?.currentStreak || 0,
    longestStreak: streak?.longestStreak || 0,
    averageSessionsPerDay,
    thisWeekSessions,
  };
}
