import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { getRankTitle } from '../../lib/rank';
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

// The user's chosen avatar (User.avatarEmoji) is the source of truth everywhere.
// Falls back to a deterministic emoji derived from the user id — the SAME seed
// and table the mobile client uses for un-picked users, so they always match.
function resolveAvatar(stored: string | null | undefined, userId: string): string {
  return stored && stored.trim() ? stored : getAvatarEmoji(userId);
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

// ─── Post payload allowlist ──────────────────────────────────────────────────
// The only client-supplied fields that may be persisted into SocialPost.payload.
// Identity and metadata (id, authorId, authorName, authorRank, createdAt,
// visibility, reactions…) are server-owned and deliberately absent — a client
// that sends them has them dropped rather than honoured.
const POST_PAYLOAD_FIELDS = {
  sessionId: z.string().max(64).nullable().optional(),
  achievementId: z.string().max(64).nullable().optional(),
  streakAtPost: z.number().int().min(0).max(100_000).nullable().optional(),
  // Mirrors FreePostTag in mobile/types/index.ts.
  contentTag: z
    .enum(['study_tip', 'question', 'motivation', 'celebration', 'resource', 'general'])
    .nullable()
    .optional(),
  photoUrl: z.string().max(2048).nullable().optional(),
  attachedStats: z
    .array(z.object({ label: z.string().max(40), value: z.string().max(40) }))
    .max(6)
    .nullable()
    .optional(),
} as const;

// Server-owned fields on a rendered post. Spreading the stored payload BEFORE
// these guarantees a payload can never override the real author or timestamps,
// no matter what an older row happens to contain.
function renderPost(
  post: {
    id: string;
    authorId: string;
    type: string;
    caption: string | null;
    createdAt: Date;
    visibility: string;
    groupId: string | null;
    payload: unknown;
    reactions: unknown;
  },
  author: { username?: string | null; xp?: number | null; avatarEmoji?: string | null } | null | undefined,
  groupName?: string,
): Record<string, unknown> {
  return {
    ...(post.payload as Record<string, unknown>),
    id: post.id,
    authorId: post.authorId,
    authorName: author?.username ?? 'Unknown',
    authorEmoji: resolveAvatar(author?.avatarEmoji, post.authorId),
    authorRank: getRankTitle(author?.xp ?? 0),
    type: post.type,
    caption: post.caption,
    createdAt: post.createdAt.toISOString(),
    visibility: post.visibility,
    groupId: post.groupId,
    groupName,
    reactions: (post.reactions ?? {}),
  };
}

// ─── Group access ────────────────────────────────────────────────────────────
// A private group's contents (posts, leaderboard, membership) are readable only
// by its members. Public groups stay open to any signed-in user, which is what
// makes them discoverable in /social/groups/all.
//
// Returns the group when access is allowed, or a reason when it is not, so
// callers can distinguish "no such group" from "not yours to see".
async function resolveGroupAccess(
  groupId: string,
  userId: string,
): Promise<
  | { ok: true; group: { id: string; name: string; isPrivate: boolean }; isMember: boolean }
  | { ok: false; status: 404 | 403; error: string }
> {
  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, isPrivate: true },
  });
  if (!group) return { ok: false, status: 404, error: 'Group not found' };

  const membership = await prisma.studyGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  });
  const isMember = !!membership;

  // Private groups reveal nothing to non-members — including their existence.
  if (group.isPrivate && !isMember) {
    return { ok: false, status: 404, error: 'Group not found' };
  }

  return { ok: true, group, isMember };
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

    // Privacy flags drive access (publicProfile / privacySetting), stat
    // visibility (shareFocusStats) and activity visibility (friendsCanSeeActivity).
    const privacy = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        privacySetting: true,
        publicProfile: true,
        shareFocusStats: true,
        friendsCanSeeActivity: true,
      },
    });
    if (!privacy) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const friendIds = isSelf ? [] : await getFriendIds(requestingUserId);
    const isFriend = isSelf || friendIds.includes(targetUserId);

    if (!isSelf) {
      if (privacy.privacySetting === 'private') {
        res.status(403).json({ success: false, error: 'This profile is private' });
        return;
      }
      // Profile hidden from non-friends when privacy is friends-only or the
      // Public Profile toggle is off.
      if ((privacy.privacySetting === 'friends_only' || !privacy.publicProfile) && !isFriend) {
        res.status(403).json({ success: false, error: 'This profile is friends only' });
        return;
      }
    }

    const hideStats = !isSelf && !privacy.shareFocusStats;
    const hideActivity = !isSelf && !privacy.friendsCanSeeActivity;

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

    const recentFeedEvents = hideActivity ? [] : await prisma.feedEvent.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    res.json({
      success: true,
      data: {
        ...user,
        totalSessions: hideStats ? 0 : user.totalSessions,
        totalFocusTime: hideStats ? 0 : user.totalFocusTime,
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

// Returns the subset of `userIds` whose owners allow leaderboard visibility.
// The requesting user is always kept so they can see their own rank.
async function visibleLeaderboardIds(userIds: string[], requesterId: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, showOnLeaderboard: true },
  });
  const visible = new Set<string>();
  for (const u of users) {
    if (u.showOnLeaderboard || u.id === requesterId) visible.add(u.id);
  }
  return visible;
}

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
      // Ranked straight from User — the single source of truth for streaks
      // (see the note in modules/goals/handler.ts). Reading the old Streak table
      // here is what made this board disagree with the profile after a reset.
      const streaks = await prisma.user.findMany({
        orderBy: { currentStreak: 'desc' },
        take: 100,
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          level: true,
          currentStreak: true,
          longestStreak: true,
        },
      });

      let filtered = streaks;
      if (scope === 'friends' && friendIds.length > 0) {
        const friendSet = new Set(friendIds);
        filtered = streaks.filter((s) => friendSet.has(s.id));
      }

      // Drop users who opted out of the leaderboard (self always kept).
      const visible = await visibleLeaderboardIds(filtered.map((s) => s.id), userId);
      filtered = filtered.filter((s) => visible.has(s.id));

      const userRank = filtered.findIndex((s) => s.id === userId) + 1;
      const myEntry = filtered.find((s) => s.id === userId);

      const entries = filtered.map((s, index) => ({
        rank: index + 1,
        userId: s.id,
        username: s.username,
        avatarUrl: s.avatarUrl,
        level: s.level,
        currentStreak: s.currentStreak,
        longestStreak: s.longestStreak,
        isMe: s.id === userId,
      }));

      res.json({
        success: true,
        data: {
          entries,
          myEntry: myEntry ? {
            rank: userRank > 0 ? userRank : entries.length + 1,
            userId: myEntry.id,
            username: myEntry.username,
            avatarUrl: myEntry.avatarUrl,
            level: myEntry.level,
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

    const rawResults = await prisma.session.groupBy({
      by: ['userId'],
      where: sessionWhere as never,
      _sum: { durationSeconds: true },
      orderBy: { _sum: { durationSeconds: 'desc' } },
      take: 100,
    });

    // Drop users who opted out of the leaderboard (self always kept).
    const visibleXp = await visibleLeaderboardIds(rawResults.map((r) => r.userId), userId);
    const results = rawResults.filter((r) => visibleXp.has(r.userId));

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

    const rawResults = await prisma.session.groupBy({
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

    const visibleWeekly = await visibleLeaderboardIds(rawResults.map((r) => r.userId), userId);
    const results = rawResults.filter((r) => visibleWeekly.has(r.userId));

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

    // Ranked from User — the single source of truth for streaks (see the note in
    // modules/goals/handler.ts). Opt-outs are filtered in the query rather than
    // after `take`, so hidden users no longer consume leaderboard slots.
    const streaks = await prisma.user.findMany({
      where: { OR: [{ showOnLeaderboard: true }, { id: userId }] },
      orderBy: { currentStreak: 'desc' },
      take: 100,
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        currentStreak: true,
        longestStreak: true,
      },
    });

    const userRank = streaks.findIndex((s) => s.id === userId) + 1;

    const leaderboard = streaks.map((s, index) => ({
      rank: index + 1,
      userId: s.id,
      username: s.username,
      avatarUrl: s.avatarUrl,
      currentStreak: s.currentStreak,
      longestStreak: s.longestStreak,
      isMe: s.id === userId,
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
    // Previously returned success:true with zeroed counts, which made a real
    // outage look like an empty profile — invisible to the user and to metrics.
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

socialRouter.get('/social/posts/mine', async (req: Request, res: Response) => {
  try {
    const userId = authenticate(req);
    const cursor = req.query.cursor as string | undefined;
    const limit = 20;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, xp: true, currentStreak: true, avatarEmoji: true },
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

    const data = page.map((p) => renderPost(p, user));

    res.json({ success: true, data: { posts: data, cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/posts/mine] error:', error);
    // Reporting failure as an empty post list hid outages behind a plausible
    // empty state; the client can now distinguish the two.
    res.status(500).json({ success: false, error: 'Internal server error' });
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
      // Group feeds are gated on access — otherwise any signed-in user could read
      // a private group's posts just by knowing its id.
      const access = await resolveGroupAccess(groupId, userId);
      if (!access.ok) {
        res.status(access.status).json({ success: false, error: access.error });
        return;
      }
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
        author: { select: { id: true, username: true, xp: true, avatarEmoji: true } },
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

    const data = page.map((p) =>
      renderPost(p, p.author, p.groupId ? groupMap.get(p.groupId) : undefined),
    );

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
      // Post-body fields, stored in the `payload` JSON column. This is an
      // allowlist on purpose: anything not named here is dropped. Adding a new
      // post type means adding its fields here — never widening to req.body,
      // which would let a client set server-owned fields like authorName.
      ...POST_PAYLOAD_FIELDS,
    });
    const parsed = schema.parse(req.body);
    const { type, caption, visibility, groupId } = parsed;

    // Content moderation (Guideline 1.2): reject objectionable captions.
    if (containsBlockedContent(caption)) {
      res.status(400).json({ success: false, error: "Your post contains language that isn't allowed." });
      return;
    }

    // Build the payload only from validated fields, dropping any that are absent.
    // Absent and explicitly-null fields are both omitted — the client already
    // reads these with `?? null` defaults, so storing nulls adds nothing.
    const payloadFields: Record<string, Prisma.InputJsonValue> = {};
    for (const key of Object.keys(POST_PAYLOAD_FIELDS)) {
      const value = parsed[key as keyof typeof parsed];
      if (value !== undefined && value !== null) {
        payloadFields[key] = value;
      }
    }

    // You may only post into a group you belong to. Without this, group feeds
    // could be written to by any outsider who knew the group id.
    let groupName: string | undefined;
    if (visibility === 'group') {
      if (!groupId) {
        res.status(400).json({ success: false, error: 'A group is required for a group post' });
        return;
      }
      const access = await resolveGroupAccess(groupId, userId);
      if (!access.ok) {
        res.status(access.status).json({ success: false, error: access.error });
        return;
      }
      if (!access.isMember) {
        res.status(403).json({ success: false, error: 'Join this group to post in it' });
        return;
      }
      groupName = access.group.name;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, xp: true, currentStreak: true, avatarEmoji: true },
    });

    const post = await prisma.socialPost.create({
      data: {
        authorId: userId,
        type,
        caption: caption ?? null,
        visibility,
        // A public post never carries a group id, so it can't leak group
        // membership through the feed.
        groupId: visibility === 'group' ? groupId! : null,
        payload: payloadFields,
        reactions: {},
      },
    });

    // Notify the author's followers about a new public post. Group-only posts
    // stay within the group and don't fan out to followers.
    if (post.visibility === 'public') {
      eventBus.emit(EventTypes.POST_CREATED, {
        postId: post.id,
        authorId: userId,
        authorUsername: user?.username ?? 'Someone',
        type: post.type,
        caption: post.caption,
      });
    }

    res.status(201).json({
      success: true,
      data: renderPost(post, user, groupName),
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

    // Read-modify-write on a JSON column is lossy: two users reacting at the same
    // moment both read the old map and the second write erases the first. Doing
    // the toggle inside a transaction with a row lock serialises them, so every
    // reaction survives.
    //
    // SELECT … FOR UPDATE holds the lock until the transaction commits; the
    // update below then applies on top of whatever the previous holder wrote.
    const reactions = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ reactions: unknown }[]>`
        SELECT reactions FROM social_posts WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (rows.length === 0) return null;

      const current = (rows[0].reactions ?? {}) as Record<string, string[]>;
      const existing = current[emoji] ?? [];
      const hasReacted = existing.includes(userId);
      const next: Record<string, string[]> = {
        ...current,
        [emoji]: hasReacted ? existing.filter((uid) => uid !== userId) : [...existing, userId],
      };
      // Drop empty buckets so the map doesn't accumulate dead emoji keys forever.
      if (next[emoji].length === 0) delete next[emoji];

      await tx.socialPost.update({ where: { id }, data: { reactions: next } });
      return next;
    });

    if (reactions === null) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

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
      select: { id: true, username: true, avatarUrl: true, level: true, avatarEmoji: true },
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
      avatarEmoji: resolveAvatar(u.avatarEmoji, u.id),
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
      include: { follower: { select: { id: true, username: true, xp: true, avatarEmoji: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const data = follows.map((f) => ({
      userId: f.follower.id,
      displayName: f.follower.username,
      handle: f.follower.username,
      avatarEmoji: resolveAvatar(f.follower.avatarEmoji, f.follower.id),
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
      include: { following: { select: { id: true, username: true, xp: true, avatarEmoji: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const data = follows.map((f) => ({
      userId: f.following.id,
      displayName: f.following.username,
      handle: f.following.username,
      avatarEmoji: resolveAvatar(f.following.avatarEmoji, f.following.id),
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
        privacySetting: true, shareFocusStats: true, avatarEmoji: true,
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

    // Hide focus stats from non-followers when the user keeps them private.
    const hideStats = requestingUserId !== targetId && !user.shareFocusStats && !isFollowing;

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
        avatarEmoji: resolveAvatar(user.avatarEmoji, user.id),
        level: user.level,
        rank: getRankTitle(user.xp),
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        totalSessions: hideStats ? 0 : user.totalSessions,
        totalFocusTime: hideStats ? 0 : user.totalFocusTime,
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

    // Group names are user-generated content shown to other people, so they get
    // the same moderation gate as post captions (Guideline 1.2). Previously only
    // captions were checked, leaving an unfiltered public surface.
    if (containsBlockedContent(name)) {
      res.status(400).json({ success: false, error: "That group name isn't allowed." });
      return;
    }

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

    // resolveGroupAccess rejects private groups for non-members, so this also
    // enforces that a private group can only ever be joined by invitation —
    // knowing the id is not enough.
    const access = await resolveGroupAccess(groupId, userId);
    if (!access.ok) {
      res.status(access.status).json({ success: false, error: access.error });
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
      // Same gate as the group feed — a private group's member stats are not
      // readable by outsiders.
      const access = await resolveGroupAccess(groupIdParam, userId);
      if (!access.ok) {
        res.status(access.status).json({ success: false, error: access.error });
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

      const rawResults = await prisma.session.groupBy({
        by: ['userId'],
        where: sessionWhere as never,
        _sum: { durationSeconds: true },
        orderBy: { _sum: { durationSeconds: 'desc' } },
        take: 100,
      });

      const visibleMonth = await visibleLeaderboardIds(rawResults.map((r) => r.userId), userId);
      const results = rawResults.filter((r) => visibleMonth.has(r.userId));

      const userIds = results.map((r) => r.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, xp: true, currentStreak: true, avatarEmoji: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      entries = results.map((r, idx) => {
        const u = userMap.get(r.userId);
        return {
          userId: r.userId,
          displayName: u?.username ?? 'Unknown',
          avatarEmoji: resolveAvatar(u?.avatarEmoji, r.userId),
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
      // Hide users who opted out of the leaderboard, but always include self.
      const visibilityWhere = { OR: [{ showOnLeaderboard: true }, { id: userId }] };
      const users = await prisma.user.findMany({
        where: scopeUserIds
          ? { AND: [{ id: { in: scopeUserIds } }, visibilityWhere] }
          : visibilityWhere,
        select: { id: true, username: true, xp: true, currentStreak: true, totalFocusTime: true, avatarEmoji: true },
        orderBy: { totalFocusTime: 'desc' },
        take: 100,
      });

      entries = users.map((u, idx) => ({
        userId: u.id,
        displayName: u.username,
        avatarEmoji: resolveAvatar(u.avatarEmoji, u.id),
        rank: getRankTitle(u.xp ?? 0),
        currentStreak: u.currentStreak ?? 0,
        focusMinutes: Math.floor((u.totalFocusTime ?? 0) / 60),
        position: idx + 1,
        positionDelta: null,
        isMe: u.id === userId,
      }));
    }

    // If the user isn't in the top 100 they still deserve to see where they
    // stand — previously myEntry was simply null for everyone outside the page,
    // which is most users. Count how many people are ahead of them to get a real
    // position instead.
    let myEntry = entries.find((e) => e.userId === userId) ?? null;
    if (!myEntry) {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, xp: true, currentStreak: true, totalFocusTime: true, avatarEmoji: true },
      });
      if (me) {
        const ahead = await prisma.user.count({
          where: {
            totalFocusTime: { gt: me.totalFocusTime ?? 0 },
            ...(scopeUserIds ? { id: { in: scopeUserIds } } : {}),
            showOnLeaderboard: true,
          },
        });
        myEntry = {
          userId: me.id,
          displayName: me.username,
          avatarEmoji: resolveAvatar(me.avatarEmoji, me.id),
          rank: getRankTitle(me.xp ?? 0),
          currentStreak: me.currentStreak ?? 0,
          focusMinutes: Math.floor((me.totalFocusTime ?? 0) / 60),
          position: ahead + 1,
          positionDelta: null,
          isMe: true,
        };
      }
    }

    res.json({ success: true, data: { entries, myEntry } });
  } catch (error) {
    if (handleAuthError(res, error)) return;
    console.error('[social/focus-leaderboard] error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
