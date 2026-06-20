import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
import { getFriendIds, getFriendSessions } from '../../services/friendshipService';
import { eventBus, EventTypes } from '../../middleware/eventBus';

export const socialRouter = Router();

const AVATAR_EMOJIS = ['🦊','🐸','🦁','🐳','🦉','🐰','🦋','🐙','🦚','🐻','🦝','🐵'];
function getAvatarEmoji(seed: string): string {
  let h = 0;
  for (const c of seed) h = ((h * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_EMOJIS[h % AVATAR_EMOJIS.length];
}

function getRankTitle(xp: number): string {
  if (xp >= 10000) return 'Champion';
  if (xp >= 5000) return 'Legend';
  if (xp >= 2500) return 'Elite';
  if (xp >= 1000) return 'Scholar';
  return 'Rookie';
}

// ─── Moderation helpers (App Store Guideline 1.2) ────────────────────────────
// Minimal server-side profanity gate on user-generated captions. STEM_TERMS are
// matched with a leading word boundary + optional suffix so inflections are
// caught ("fuck" → "fucking", "shit" → "shitty") without matching mid-word.
// EXACT_TERMS are short stems that collide with legit words ("spic"→"spice",
// "dick"→"Dickens"), so they only match as whole words. Expand the lists freely.
const STEM_TERMS = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigger', 'nigga', 'faggot',
  'retard', 'slut', 'whore', 'rape', 'kike',
];
const EXACT_TERMS = ['spic', 'chink', 'dick'];
const STEM_RE = new RegExp(`\\b(${STEM_TERMS.join('|')})\\w*`, 'i');
const EXACT_RE = new RegExp(`\\b(${EXACT_TERMS.join('|')})\\b`, 'i');
function containsBlockedContent(text: string | null | undefined): boolean {
  if (!text) return false;
  return STEM_RE.test(text) || EXACT_RE.test(text);
}

// Users hidden from `userId` in both directions: people they blocked and people
// who blocked them. Their posts/profiles are excluded from feeds and search.
async function getHiddenUserIds(userId: string): Promise<string[]> {
  const blocks = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const b of blocks) {
    ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
  }
  return [...ids];
}

socialRouter.post('/social/friend-request', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({ userId: z.string().uuid() });
    const { userId: targetUserId } = schema.parse(req.body);

    if (targetUserId === userId) {
      res.status(400).json({ success: false, error: 'Cannot add yourself' });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId: targetUserId },
          { requesterId: targetUserId, addresseeId: userId },
        ],
      },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        error: existing.status === 'accepted' ? 'Already friends' : 'Friend request already sent',
      });
      return;
    }

    const friendship = await prisma.friendship.create({
      data: {
        requesterId: userId,
        addresseeId: targetUserId,
        status: 'pending',
      },
    });

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, level: true },
    });

    eventBus.emit(EventTypes.FRIEND_REQUEST_SENT, {
      requestId: friendship.id,
      fromUserId: userId,
      fromUsername: requester?.username || 'Unknown',
      fromLevel: requester?.level || 1,
      targetUserId,
    });

    res.status(201).json({ success: true, data: friendship });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Friend request error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/friend-request/:id/accept', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const friendship = await prisma.friendship.findFirst({
      where: { id, addresseeId: userId, status: 'pending' },
      include: {
        requester: { select: { id: true, username: true } },
        addressee: { select: { id: true, username: true } },
      },
    });
    if (!friendship) {
      res.status(404).json({ success: false, error: 'Friend request not found' });
      return;
    }

    await prisma.friendship.update({
      where: { id },
      data: { status: 'accepted' },
    });

    eventBus.emit(EventTypes.FRIEND_REQUEST_ACCEPTED, {
      friendshipId: id,
      requesterId: friendship.requesterId,
      addresseeId: friendship.addresseeId,
      requesterUsername: friendship.requester.username,
      addresseeUsername: friendship.addressee.username,
    });

    res.json({ success: true, data: { message: 'Friend request accepted' } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('Accept friend request error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/friend-request/:id/decline', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const friendship = await prisma.friendship.findFirst({
      where: { id, addresseeId: userId, status: 'pending' },
      select: { id: true },
    });
    if (!friendship) {
      res.status(404).json({ success: false, error: 'Friend request not found' });
      return;
    }

    await prisma.friendship.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Friend request declined' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Decline friend request error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.delete('/social/friend-request/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const friendship = await prisma.friendship.findFirst({
      where: { id, requesterId: userId, status: 'pending' },
      select: { id: true },
    });
    if (!friendship) {
      res.status(404).json({ success: false, error: 'Friend request not found' });
      return;
    }

    await prisma.friendship.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Friend request cancelled' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Cancel friend request error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/friend-requests', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const incoming = await prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'pending' },
      include: {
        requester: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const outgoing = await prisma.friendship.findMany({
      where: { requesterId: userId, status: 'pending' },
      include: {
        addressee: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: { incoming, outgoing } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get friend requests error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/friends', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
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

    const friends = await Promise.all(friendships.map(async (f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;

      const todaySession = await prisma.session.findFirst({
        where: { userId: friend.id, type: 'focus', completedAt: { gte: today } },
        orderBy: { completedAt: 'desc' },
      });

      return {
        friendshipId: f.id,
        ...friend,
        createdAt: f.createdAt,
        activeToday: !!todaySession,
        lastActive: todaySession?.completedAt || null,
      };
    }));

    res.json({ success: true, data: friends });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get friends error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.delete('/social/friends/:id', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;

    const friendship = await prisma.friendship.findFirst({
      where: {
        id,
        OR: [
          { requesterId: userId },
          { addresseeId: userId },
        ],
      },
      select: { id: true },
    });
    if (!friendship) {
      res.status(404).json({ success: false, error: 'Friendship not found' });
      return;
    }

    await prisma.friendship.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Friend removed' } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Remove friend error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/feed', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const cursor = req.query.cursor as string | undefined;
    const limit = 50;

    const friendIds = await getFriendIds(userId);
    const hiddenSet = new Set(await getHiddenUserIds(userId));

    // Exclude blocked users (both directions) from the activity feed.
    const userIds = [...friendIds, userId].filter((id) => !hiddenSet.has(id));

    const where: Record<string, unknown> = {
      userId: { in: userIds },
    };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const events = await prisma.feedEvent.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const feedEvents = hasMore ? events.slice(0, limit) : events;

    const userIdsInFeed = [...new Set(feedEvents.map((e) => e.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsInFeed } },
      select: { id: true, username: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = feedEvents.map((e) => ({
      id: e.id,
      userId: e.userId,
      username: userMap.get(e.userId)?.username || 'Unknown',
      displayName: undefined,
      eventType: e.eventType,
      payload: e.payload as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    }));

    res.json({
      success: true,
      data,
      nextCursor: hasMore && feedEvents.length > 0
        ? feedEvents[feedEvents.length - 1].createdAt.toISOString()
        : null,
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Get feed error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/users/search', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      res.status(400).json({ success: false, error: 'Query must be at least 2 characters' });
      return;
    }

    const hiddenIds = await getHiddenUserIds(userId);
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
          { id: { notIn: hiddenIds } },
          { username: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, avatarUrl: true, level: true },
      take: 20,
    });

    const friendIds = await getFriendIds(userId);
    const pendingSent = await prisma.friendship.findMany({
      where: { requesterId: userId, status: 'pending' },
      select: { addresseeId: true },
    });
    const pendingReceived = await prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'pending' },
      select: { requesterId: true },
    });
    const pendingSentIds = new Set(pendingSent.map((p) => p.addresseeId));
    const pendingReceivedIds = new Set(pendingReceived.map((p) => p.requesterId));
    const friendIdSet = new Set(friendIds);

    const results = users.map((u) => {
      let relationshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
      if (friendIdSet.has(u.id)) relationshipStatus = 'friends';
      else if (pendingSentIds.has(u.id)) relationshipStatus = 'pending_sent';
      else if (pendingReceivedIds.has(u.id)) relationshipStatus = 'pending_received';
      else relationshipStatus = 'none';

      return {
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
        level: u.level,
        relationshipStatus,
      };
    });

    res.json({ success: true, data: results });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('User search error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/friends/:id/profile', async (req: Request, res: Response) => {
  try {
    const requestingUserId = authenticate(req);
    const { id: targetUserId } = req.params;

    const isSelf = requestingUserId === targetUserId;

    if (!isSelf) {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { privacySetting: true },
      });
      if (!targetUser) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (targetUser.privacySetting === 'private') {
        res.status(403).json({ success: false, error: 'This profile is private' });
        return;
      }

      if (targetUser.privacySetting === 'friends_only') {
        const friendIds = await getFriendIds(requestingUserId);
        if (!friendIds.includes(targetUserId)) {
          res.status(403).json({ success: false, error: 'This profile is friends only' });
          return;
        }
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        level: true,
        currentStreak: true,
        longestStreak: true,
        totalSessions: true,
        totalFocusTime: true,
      },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const recentAchievements = await prisma.userAchievement.findMany({
      where: { userId: targetUserId },
      orderBy: { unlockedAt: 'desc' },
      take: 3,
      include: {
        achievement: { select: { id: true, key: true, title: true, description: true, icon: true, xpReward: true, category: true, threshold: true } },
      },
    });

    const recentFeedEvents = await prisma.feedEvent.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    res.json({
      success: true,
      data: {
        ...user,
        totalFocusTime: user.totalFocusTime,
        recentAchievements: recentAchievements.map((ua) => ({
          ...ua.achievement,
          isUnlocked: true,
          unlockedAt: ua.unlockedAt.toISOString(),
          isShared: ua.isShared,
        })),
        recentFeedEvents: recentFeedEvents.map((e) => ({
          id: e.id,
          userId: e.userId,
          username: user.username,
          eventType: e.eventType,
          payload: e.payload,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Friend profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/leaderboard', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const type = req.query.type as string || 'weekly_xp';
    const scope = req.query.scope as string || 'global';

    let friendIds: string[] = [];
    if (scope === 'friends') {
      friendIds = await getFriendIds(userId);
      friendIds.push(userId);
    }

    if (type === 'longest_streak') {
      const streaks = await prisma.streak.findMany({
        orderBy: { currentStreak: 'desc' },
        take: 100,
        include: {
          user: { select: { id: true, username: true, avatarUrl: true, level: true } },
        },
      });

      let filtered = streaks;
      if (scope === 'friends' && friendIds.length > 0) {
        const friendSet = new Set(friendIds);
        filtered = streaks.filter((s) => friendSet.has(s.userId));
      }

      const userRank = streaks.findIndex((s) => s.userId === userId) + 1;
      const myEntry = streaks.find((s) => s.userId === userId);

      const entries = filtered.map((s, index) => ({
        rank: index + 1,
        userId: s.userId,
        username: s.user.username,
        avatarUrl: s.user.avatarUrl,
        level: s.user.level,
        currentStreak: s.currentStreak,
        longestStreak: s.longestStreak,
        isMe: s.userId === userId,
      }));

      res.json({
        success: true,
        data: {
          entries,
          myEntry: myEntry ? {
            rank: userRank > 0 ? userRank : entries.length + 1,
            userId: myEntry.userId,
            username: myEntry.user.username,
            avatarUrl: myEntry.user.avatarUrl,
            level: myEntry.user.level,
            currentStreak: myEntry.currentStreak,
            longestStreak: myEntry.longestStreak,
            isMe: true,
          } : null,
        },
      });
      return;
    }

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const sessionWhere: Record<string, unknown> = {
      type: 'focus',
      completedAt: { gte: weekStart },
    };
    if (scope === 'friends' && friendIds.length > 0) {
      sessionWhere.userId = { in: friendIds };
    }

    const results = await prisma.session.groupBy({
      by: ['userId'],
      where: sessionWhere as never,
      _sum: { durationSeconds: true },
      orderBy: { _sum: { durationSeconds: 'desc' } },
      take: 100,
    });

    const userIdsInResults = results.map((r) => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsInResults } },
      select: { id: true, username: true, avatarUrl: true, level: true, xp: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const userRank = results.findIndex((r) => r.userId === userId) + 1;
    const myEntry = results.find((r) => r.userId === userId);

    const entries = results.map((r, index) => ({
      rank: index + 1,
      userId: r.userId,
      username: userMap.get(r.userId)?.username || 'Unknown',
      avatarUrl: userMap.get(r.userId)?.avatarUrl || null,
      level: userMap.get(r.userId)?.level || 1,
      value: r._sum.durationSeconds || 0,
      isMe: r.userId === userId,
    }));

    res.json({
      success: true,
      data: {
        entries,
        myEntry: myEntry ? {
          rank: userRank > 0 ? userRank : entries.length + 1,
          userId: myEntry.userId,
          username: userMap.get(myEntry.userId)?.username || 'Unknown',
          avatarUrl: userMap.get(myEntry.userId)?.avatarUrl || null,
          level: userMap.get(myEntry.userId)?.level || 1,
          value: myEntry._sum.durationSeconds || 0,
          isMe: true,
        } : null,
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/leaderboard/weekly', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const results = await prisma.session.groupBy({
      by: ['userId'],
      where: {
        type: 'focus',
        completedAt: { gte: weekStart },
      },
      _count: { id: true },
      _sum: { durationSeconds: true },
      orderBy: { _count: { id: 'desc' } },
      take: 100,
    });

    const userIds = results.map((r) => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, avatarUrl: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));
    const userRank = results.findIndex((r) => r.userId === userId) + 1;

    const leaderboard = results.map((r, index) => ({
      rank: index + 1,
      userId: r.userId,
      username: userMap.get(r.userId)?.username || 'Unknown',
      avatarUrl: userMap.get(r.userId)?.avatarUrl || null,
      pomodoros: r._count.id,
      totalSeconds: r._sum.durationSeconds || 0,
      isMe: r.userId === userId,
    }));

    res.json({
      success: true,
      data: { leaderboard, myRank: userRank || leaderboard.length + 1 },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/leaderboard/streak', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const streaks = await prisma.streak.findMany({
      orderBy: { currentStreak: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    const userRank = streaks.findIndex((s) => s.userId === userId) + 1;

    const leaderboard = streaks.map((s, index) => ({
      rank: index + 1,
      userId: s.userId,
      username: s.user.username,
      avatarUrl: s.user.avatarUrl,
      currentStreak: s.currentStreak,
      longestStreak: s.longestStreak,
      isMe: s.userId === userId,
    }));

    res.json({
      success: true,
      data: { leaderboard, myRank: userRank || leaderboard.length + 1 },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('Streak leaderboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/friend/:userId/sessions', async (req: Request, res: Response) => {
  try {
    const requestingUserId = authenticate(req);
    const { userId } = req.params;
    const sessions = await getFriendSessions(requestingUserId, userId);
    res.json({ success: true, data: sessions });
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    if (handleAuthError(res, error)) return;
    console.error('Friend sessions error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/stats/me', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const acceptedWhere = {
      OR: [
        { requesterId: userId, status: 'accepted' },
        { addresseeId: userId, status: 'accepted' },
      ],
    };

    // All four reads are independent — run them in parallel.
    const [friendCount, friendships, followerCount, followingCount] = await Promise.all([
      prisma.friendship.count({ where: acceptedWhere }),
      prisma.friendship.findMany({
        where: acceptedWhere,
        include: {
          requester: { select: { id: true, username: true, avatarUrl: true } },
          addressee: { select: { id: true, username: true, avatarUrl: true } },
        },
        take: 5,
      }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
    ]);

    const friendPreviews = friendships.map((f) => {
      const friend = f.requesterId === userId ? f.addressee : f.requester;
      return {
        userId: friend.id,
        displayName: friend.username,
        avatarEmoji: '🎯',
        avatarColor: 'blue',
      };
    });

    res.json({
      success: true,
      data: {
        userId,
        friendCount,
        followerCount,
        followingCount,
        friendPreviews,
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/stats/me] error:', error);
    res.json({
      success: true,
      data: { userId: '', friendCount: 0, followerCount: 0, followingCount: 0, friendPreviews: [] },
    });
  }
});

socialRouter.get('/social/posts/mine', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const cursor = req.query.cursor as string | undefined;
    const limit = 20;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, xp: true, currentStreak: true },
    });

    const where: Record<string, unknown> = { authorId: userId };
    if (cursor) where.createdAt = { lt: new Date(cursor) };

    const posts = await prisma.socialPost.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;

    const data = page.map((p) => ({
      id: p.id,
      authorId: p.authorId,
      authorName: user?.username ?? 'Unknown',
      authorEmoji: getAvatarEmoji(p.authorId),
      authorRank: getRankTitle(user?.xp ?? 0),
      type: p.type,
      caption: p.caption,
      createdAt: p.createdAt.toISOString(),
      visibility: p.visibility,
      groupId: p.groupId,
      reactions: p.reactions as Record<string, string[]>,
      ...(p.payload as Record<string, unknown>),
    }));

    res.json({ success: true, data: { posts: data, cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/posts/mine] error:', error);
    res.json({ success: true, data: { posts: [], cursor: null } });
  }
});

// ─── Social v2: Posts ────────────────────────────────────────────────────────

socialRouter.get('/social/posts', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const cursor = req.query.cursor as string | undefined;
    const groupId = req.query.groupId as string | undefined;
    const authorId = req.query.authorId as string | undefined;
    const limit = 20;

    let whereClause: Record<string, unknown>;
    if (authorId) {
      whereClause = { authorId, visibility: 'public' };
    } else if (groupId) {
      whereClause = { groupId, visibility: 'group' };
    } else {
      const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      const followingIds = following.map((f) => f.followingId);
      const feedUserIds = [...followingIds, userId];
      whereClause = {
        OR: [
          { visibility: 'public', authorId: { in: feedUserIds } },
          { authorId: userId },
        ],
      };
    }
    if (cursor) whereClause.createdAt = { lt: new Date(cursor) };

    // Exclude posts authored by blocked users (both directions).
    const hiddenIds = await getHiddenUserIds(userId);
    const finalWhere = hiddenIds.length > 0
      ? { AND: [whereClause, { authorId: { notIn: hiddenIds } }] }
      : whereClause;

    const posts = await prisma.socialPost.findMany({
      where: finalWhere as never,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        author: { select: { id: true, username: true, xp: true } },
      },
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;

    // Fetch group names for group posts
    const groupIds = [...new Set(page.map((p) => p.groupId).filter(Boolean) as string[])];
    const groups = groupIds.length > 0 ? await prisma.studyGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true },
    }) : [];
    const groupMap = new Map(groups.map((g) => [g.id, g.name]));

    const data = page.map((p) => ({
      id: p.id,
      authorId: p.authorId,
      authorName: p.author.username,
      authorEmoji: getAvatarEmoji(p.authorId),
      authorRank: getRankTitle(p.author.xp),
      type: p.type,
      caption: p.caption,
      createdAt: p.createdAt.toISOString(),
      visibility: p.visibility,
      groupId: p.groupId,
      groupName: p.groupId ? groupMap.get(p.groupId) : undefined,
      reactions: p.reactions as Record<string, string[]>,
      ...(p.payload as Record<string, unknown>),
    }));

    res.json({
      success: true,
      data: { posts: data, cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/posts] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/posts', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      type: z.enum(['session_recap', 'achievement_unlock', 'streak_milestone', 'accountability', 'free_post']),
      caption: z.string().max(280).nullable().optional(),
      visibility: z.enum(['public', 'group']).default('public'),
      groupId: z.string().uuid().nullable().optional(),
    });
    const { type, caption, visibility, groupId } = schema.parse(req.body);

    // Content moderation (Guideline 1.2): reject objectionable captions.
    if (containsBlockedContent(caption)) {
      res.status(400).json({ success: false, error: "Your post contains language that isn't allowed." });
      return;
    }

    const payloadFields = { ...req.body };
    delete payloadFields.type;
    delete payloadFields.caption;
    delete payloadFields.visibility;
    delete payloadFields.groupId;
    delete payloadFields.reactions;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, xp: true, currentStreak: true },
    });

    const post = await prisma.socialPost.create({
      data: {
        authorId: userId,
        type,
        caption: caption ?? null,
        visibility,
        groupId: groupId ?? null,
        payload: payloadFields,
        reactions: {},
      },
    });

    let groupName: string | undefined;
    if (groupId) {
      const g = await prisma.studyGroup.findUnique({ where: { id: groupId }, select: { name: true } });
      groupName = g?.name;
    }

    res.status(201).json({
      success: true,
      data: {
        id: post.id,
        authorId: post.authorId,
        authorName: user?.username ?? 'Unknown',
        authorEmoji: getAvatarEmoji(post.authorId),
        authorRank: getRankTitle(user?.xp ?? 0),
        type: post.type,
        caption: post.caption,
        createdAt: post.createdAt.toISOString(),
        visibility: post.visibility,
        groupId: post.groupId,
        groupName,
        reactions: {},
        ...(post.payload as Record<string, unknown>),
      },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('[social/posts POST] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/posts/:id/react', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    const schema = z.object({ emoji: z.string().max(8) });
    const { emoji } = schema.parse(req.body);

    const post = await prisma.socialPost.findUnique({ where: { id }, select: { id: true, reactions: true } });
    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    const reactions = post.reactions as Record<string, string[]>;
    const existing = reactions[emoji] ?? [];
    const hasReacted = existing.includes(userId);
    reactions[emoji] = hasReacted
      ? existing.filter((uid) => uid !== userId)
      : [...existing, userId];

    await prisma.socialPost.update({ where: { id }, data: { reactions } });
    res.json({ success: true, data: { reactions } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('[social/posts/:id/react] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Moderation: report & block (Guideline 1.2) ──────────────────────────────
socialRouter.post('/social/posts/:id/report', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    const schema = z.object({ reason: z.string().max(500).nullable().optional() });
    const { reason } = schema.parse(req.body);

    const post = await prisma.socialPost.findUnique({ where: { id }, select: { id: true } });
    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    await prisma.postReport.create({
      data: { postId: id, reportedBy: userId, reason: reason ?? null },
    });
    res.json({ success: true, data: { reported: true } });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('[social/posts/:id/report] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/users/:id/block', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    if (id === userId) {
      res.status(400).json({ success: false, error: 'You cannot block yourself' });
      return;
    }
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: id } },
      create: { blockerId: userId, blockedId: id },
      update: {},
    });
    res.json({ success: true, data: { blocked: true } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/users/:id/block POST] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.delete('/social/users/:id/block', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id } = req.params;
    await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: id } });
    res.json({ success: true, data: { blocked: false } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/users/:id/block DELETE] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Social v2: Search & Follow ──────────────────────────────────────────────

socialRouter.get('/social/search', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      res.status(400).json({ success: false, error: 'Query must be at least 2 characters' });
      return;
    }

    const hiddenIds = await getHiddenUserIds(userId);
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
          { id: { notIn: hiddenIds } },
          { username: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, avatarUrl: true, level: true },
      take: 20,
    });

    const following = await prisma.follow.findMany({
      where: { followerId: userId, followingId: { in: users.map((u) => u.id) } },
      select: { followingId: true },
    });
    const followingSet = new Set(following.map((f) => f.followingId));

    const results = users.map((u) => ({
      id: u.id,
      username: u.username,
      avatarUrl: u.avatarUrl,
      avatarEmoji: getAvatarEmoji(u.id),
      level: u.level,
      isFollowing: followingSet.has(u.id),
    }));

    res.json({ success: true, data: results });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/search] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/follow/:userId', async (req: Request, res: Response) => {
  try {
    const followerId = authenticate(req);
    const { userId: followingId } = req.params;

    if (followerId === followingId) {
      res.status(400).json({ success: false, error: 'Cannot follow yourself' });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true } });
    if (!target) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });

    res.json({ success: true, data: { isFollowing: true } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/follow POST] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.delete('/social/follow/:userId', async (req: Request, res: Response) => {
  try {
    const followerId = authenticate(req);
    const { userId: followingId } = req.params;

    await prisma.follow.deleteMany({ where: { followerId, followingId } });
    res.json({ success: true, data: { isFollowing: false } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/follow DELETE] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/followers', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const follows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: { follower: { select: { id: true, username: true, xp: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const data = follows.map((f) => ({
      userId: f.follower.id,
      displayName: f.follower.username,
      handle: f.follower.username,
      avatarEmoji: getAvatarEmoji(f.follower.id),
      rank: getRankTitle(f.follower.xp),
    }));
    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/following', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: { following: { select: { id: true, username: true, xp: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const data = follows.map((f) => ({
      userId: f.following.id,
      displayName: f.following.username,
      handle: f.following.username,
      avatarEmoji: getAvatarEmoji(f.following.id),
      rank: getRankTitle(f.following.xp),
    }));
    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Social v2: Public profile ───────────────────────────────────────────────

socialRouter.get('/social/users/:userId', async (req: Request, res: Response) => {
  try {
    const requestingUserId = authenticate(req);
    const { userId: targetId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true, username: true, avatarUrl: true, level: true, xp: true,
        currentStreak: true, longestStreak: true,
        totalSessions: true, totalFocusTime: true,
        privacySetting: true,
      },
    });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const isFollowing = requestingUserId !== targetId
      ? !!(await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: requestingUserId, followingId: targetId } },
        }))
      : false;

    const isBlocked = requestingUserId !== targetId
      ? !!(await prisma.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId: requestingUserId, blockedId: targetId } },
        }))
      : false;

    const followerCount = await prisma.follow.count({ where: { followingId: targetId } });
    const followingCount = await prisma.follow.count({ where: { followerId: targetId } });

    const recentAchievements = await prisma.userAchievement.findMany({
      where: { userId: targetId },
      orderBy: { unlockedAt: 'desc' },
      take: 3,
      include: {
        achievement: { select: { id: true, key: true, title: true, description: true, icon: true, xpReward: true, category: true, threshold: true } },
      },
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        avatarEmoji: getAvatarEmoji(user.id),
        level: user.level,
        rank: getRankTitle(user.xp),
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        totalSessions: user.totalSessions,
        totalFocusTime: user.totalFocusTime,
        followerCount,
        followingCount,
        isFollowing,
        isBlocked,
        isMe: requestingUserId === targetId,
        recentAchievements: recentAchievements.map((ua) => ({
          ...ua.achievement,
          isUnlocked: true,
          unlockedAt: ua.unlockedAt.toISOString(),
          isShared: ua.isShared,
        })),
      },
    });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/users/:userId] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Social v2: Groups ───────────────────────────────────────────────────────

socialRouter.get('/social/groups', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const memberships = await prisma.studyGroupMember.findMany({
      where: { userId },
      include: {
        group: { include: { members: { select: { userId: true } } } },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const data = memberships.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      emoji: m.group.emoji,
      color: m.group.color,
      isPrivate: m.group.isPrivate,
      createdBy: m.group.createdBy,
      createdAt: m.group.createdAt.toISOString(),
      memberIds: m.group.members.map((mem) => mem.userId),
      memberCount: m.group.members.length,
      isMember: true,
      hasRecentActivity: false,
    }));

    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/groups] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/groups/all', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);

    const memberships = await prisma.studyGroupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const memberGroupIds = new Set(memberships.map((m) => m.groupId));

    const groups = await prisma.studyGroup.findMany({
      where: { isPrivate: false },
      include: { members: { select: { userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const data = groups.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      color: g.color,
      isPrivate: g.isPrivate,
      createdBy: g.createdBy,
      createdAt: g.createdAt.toISOString(),
      memberIds: g.members.map((m) => m.userId),
      memberCount: g.members.length,
      isMember: memberGroupIds.has(g.id),
      hasRecentActivity: false,
    }));

    res.json({ success: true, data });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/groups/all] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/groups', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const schema = z.object({
      name: z.string().min(1).max(100),
      emoji: z.string().max(10),
      color: z.enum(['purple', 'teal', 'amber', 'rose']).default('purple'),
      isPrivate: z.boolean().default(false),
    });
    const { name, emoji, color, isPrivate } = schema.parse(req.body);

    const group = await prisma.studyGroup.create({
      data: { name, emoji, color, isPrivate, createdBy: userId },
    });
    await prisma.studyGroupMember.create({ data: { groupId: group.id, userId } });

    res.status(201).json({
      success: true,
      data: {
        id: group.id, name: group.name, emoji: group.emoji, color: group.color,
        isPrivate: group.isPrivate, createdBy: group.createdBy,
        createdAt: group.createdAt.toISOString(),
        memberIds: [userId], memberCount: 1, isMember: true, hasRecentActivity: false,
      },
    });
  } catch (error) {
    if (handleZodError(res, error)) return;
    if (handleAuthError(res, error)) return;
    console.error('[social/groups POST] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/groups/:id/join', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id: groupId } = req.params;

    const group = await prisma.studyGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return;
    }

    await prisma.studyGroupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });

    res.json({ success: true, data: { isMember: true } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/groups/:id/join] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.post('/social/groups/:id/leave', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const { id: groupId } = req.params;

    await prisma.studyGroupMember.deleteMany({ where: { groupId, userId } });
    res.json({ success: true, data: { isMember: false } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/groups/:id/leave] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Social v2: Focus Leaderboard ────────────────────────────────────────────

socialRouter.get('/social/focus-leaderboard', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const scope = (req.query.scope as string) || 'global';
    const period = (req.query.period as string) || 'all_time';

    // Resolve which users this scope covers. undefined = everyone (global).
    let scopeUserIds: string[] | undefined;
    if (scope === 'friends') {
      // Friends = people you follow (+ yourself), via the Follow table.
      const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      scopeUserIds = [...following.map((f) => f.followingId), userId];
    } else if (scope === 'group') {
      const groupIdParam = req.query.groupId as string | undefined;
      if (!groupIdParam) {
        res.json({ success: true, data: { entries: [], myEntry: null } });
        return;
      }
      const members = await prisma.studyGroupMember.findMany({
        where: { groupId: groupIdParam },
        select: { userId: true },
      });
      scopeUserIds = members.map((m) => m.userId);
    }

    let entries;

    if (period === 'month') {
      // Monthly board: sum focus sessions since the start of this month.
      const sinceDate = new Date();
      sinceDate.setDate(1);
      sinceDate.setHours(0, 0, 0, 0);

      const sessionWhere: Record<string, unknown> = { type: 'focus', completedAt: { gte: sinceDate } };
      if (scopeUserIds) sessionWhere.userId = { in: scopeUserIds };

      const results = await prisma.session.groupBy({
        by: ['userId'],
        where: sessionWhere as never,
        _sum: { durationSeconds: true },
        orderBy: { _sum: { durationSeconds: 'desc' } },
        take: 100,
      });

      const userIds = results.map((r) => r.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, xp: true, currentStreak: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      entries = results.map((r, idx) => {
        const u = userMap.get(r.userId);
        return {
          userId: r.userId,
          displayName: u?.username ?? 'Unknown',
          avatarEmoji: getAvatarEmoji(r.userId),
          rank: getRankTitle(u?.xp ?? 0),
          currentStreak: u?.currentStreak ?? 0,
          focusMinutes: Math.floor((r._sum.durationSeconds ?? 0) / 60),
          position: idx + 1,
          positionDelta: null,
          isMe: r.userId === userId,
        };
      });
    } else {
      // All-time board: rank straight from User.totalFocusTime so EVERY user appears,
      // no dependence on session rows in a time window.
      const users = await prisma.user.findMany({
        where: scopeUserIds ? { id: { in: scopeUserIds } } : undefined,
        select: { id: true, username: true, xp: true, currentStreak: true, totalFocusTime: true },
        orderBy: { totalFocusTime: 'desc' },
        take: 100,
      });

      entries = users.map((u, idx) => ({
        userId: u.id,
        displayName: u.username,
        avatarEmoji: getAvatarEmoji(u.id),
        rank: getRankTitle(u.xp ?? 0),
        currentStreak: u.currentStreak ?? 0,
        focusMinutes: Math.floor((u.totalFocusTime ?? 0) / 60),
        position: idx + 1,
        positionDelta: null,
        isMe: u.id === userId,
      }));
    }

    const myEntry = entries.find((e) => e.userId === userId) ?? null;

    res.json({ success: true, data: { entries, myEntry } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/focus-leaderboard] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
