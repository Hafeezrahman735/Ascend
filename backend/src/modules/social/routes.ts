import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { handleAuthError, handleZodError } from '../../lib/errors';
import { getFriendIds, getFriendSessions } from '../../services/friendshipService';
import { eventBus, EventTypes } from '../../middleware/eventBus';

export const socialRouter = Router();

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

    const userIds = [...friendIds, userId];

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

    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
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
