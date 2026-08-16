import { Server as SocketIOServer } from 'socket.io';
import {
  SessionCompletedEvent,
  FriendSessionStartedEvent,
  FeedCreateEvent,
} from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { getFriendIds } from '../../services/friendshipService';

export async function handleFeedCreate(
  io: SocketIOServer,
  event: FeedCreateEvent,
): Promise<void> {
  const feedEvent = await prisma.feedEvent.create({
    data: {
      userId: event.userId,
      eventType: event.eventType,
      payload: event.payload as never,
    },
  });

  const friendIds = await getFriendIds(event.userId);

  const user = await prisma.user.findUnique({
    where: { id: event.userId },
    select: { username: true },
  });

  const socketEvent = {
    id: feedEvent.id,
    userId: event.userId,
    username: user?.username || 'Unknown',
    eventType: event.eventType,
    payload: event.payload,
    createdAt: feedEvent.createdAt.toISOString(),
  };

  for (const friendId of friendIds) {
    io.of('/social').to(`user:${friendId}`).emit('feed:new_event', socketEvent);
  }
}

export async function handleSocialBroadcast(
  io: SocketIOServer,
  eventType: string,
  payload: SessionCompletedEvent | FriendSessionStartedEvent,
): Promise<void> {
  const userId = payload.userId;

  const friendIds = await getFriendIds(userId);

  function emitToFriends(data: Record<string, unknown>, emitEvent: string) {
    for (const friendId of friendIds) {
      io.of('/social').to(`user:${friendId}`).emit(emitEvent, data);
    }
  }

  if (eventType === 'session.completed') {
    const p = payload as SessionCompletedEvent;
    if (p.type !== 'focus') return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    emitToFriends({
      userId,
      username: user?.username || 'Unknown',
      durationSeconds: p.durationSeconds,
      taskLabel: p.taskLabel,
      completedAt: p.completedAt,
    }, 'friend:session_completed');
  }

  if (eventType === 'friend.session_started') {
    const p = payload as FriendSessionStartedEvent;
    emitToFriends({
      userId,
      taskLabel: p.taskLabel,
      startedAt: p.startedAt,
    }, 'friend:session_started');
  }

  // The 'friend.goal_completed' branch was removed with the session-target goal
  // system. TaskGoal is personal — a user's own grouped tasks — so there is no
  // friend-visible goal completion to broadcast.
}
