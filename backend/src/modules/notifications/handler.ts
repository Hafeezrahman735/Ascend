import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import {
  TaskGoalCompletedEvent,
  AchievementUnlockedEvent,
  FriendSessionStartedEvent,
  PostCreatedEvent,
} from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { shouldNotify, allowsEvent } from './service';
const expo = new Expo();

async function sendPushNotification(
  pushToken: string | null,
  title: string,
  body: string,
): Promise<void> {
  if (!pushToken) return;
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn(`Invalid Expo push token: ${pushToken}`);
    return;
  }

  // Routed through the same sender as the bulk path so dead-token cleanup and
  // error handling live in exactly one place.
  await sendChunked([
    { to: pushToken, sound: 'default', title, body, priority: 'high' },
  ]);
}

async function storeAndNotify(
  userId: string,
  type: string,
  title: string,
  body: string,
  eventType?: string,
): Promise<void> {
  try {
    if (eventType) {
      const allowed = await shouldNotify(userId, eventType);
      if (!allowed) return;
    }

    await prisma.notification.create({
      data: { userId, type, title, body },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    if (user?.pushToken) {
      await sendPushNotification(user.pushToken, title, body);
    }
  } catch (error) {
    console.error('Failed to store notification:', error);
  }
}

/**
 * Notify every follower of `authorId`, in bulk.
 *
 * The previous version did `Promise.all` over all followers, each doing its own
 * preference lookup, its own notification insert, its own user lookup, and its
 * own single-message Expo HTTP call. For a popular author that is thousands of
 * simultaneous queries against a pool of ~10 connections plus thousands of
 * individual HTTPS requests — enough to stall every other request on the server.
 *
 * Now: three queries total, one bulk insert, and pushes chunked the way the Expo
 * SDK intends. Tickets are inspected so tokens Expo reports as dead get cleared
 * instead of being retried forever.
 */
async function fanOutToFollowers(
  authorId: string,
  type: string,
  title: string,
  body: string,
  eventType: string,
): Promise<void> {
  const followers = await prisma.follow.findMany({
    where: { followingId: authorId },
    select: { followerId: true },
  });
  if (followers.length === 0) return;

  const followerIds = followers.map((f) => f.followerId);

  // One query for preferences + push tokens, instead of two per follower.
  const users = await prisma.user.findMany({
    where: { id: { in: followerIds } },
    select: { id: true, pushToken: true, notificationPrefs: true },
  });

  const recipients = users.filter((u) => allowsEvent(u.notificationPrefs, eventType));
  if (recipients.length === 0) return;

  // Single insert for every in-app notification record.
  await prisma.notification.createMany({
    data: recipients.map((u) => ({ userId: u.id, type, title, body })),
  });

  const messages: ExpoPushMessage[] = recipients
    .filter((u) => u.pushToken && Expo.isExpoPushToken(u.pushToken))
    .map((u) => ({
      to: u.pushToken as string,
      sound: 'default' as const,
      title,
      body,
      priority: 'high' as const,
    }));
  if (messages.length === 0) return;

  await sendChunked(messages);
}

/** Send push messages in SDK-sized chunks and retire tokens Expo rejects. */
async function sendChunked(messages: ExpoPushMessage[]): Promise<void> {
  const chunks = expo.chunkPushNotifications(messages);
  const deadTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status !== 'error') return;
        console.error('Push notification error:', ticket.message);
        // The device uninstalled the app or the token was revoked — it will
        // never deliver again, so stop storing it.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const to = chunk[i]?.to;
          if (typeof to === 'string') deadTokens.push(to);
        }
      });
    } catch (error) {
      // A failed chunk is not fatal — the in-app notifications are already
      // stored, and the rest of the chunks should still go out.
      console.error('Failed to send push notification chunk:', error);
    }
  }

  if (deadTokens.length > 0) {
    await prisma.user
      .updateMany({ where: { pushToken: { in: deadTokens } }, data: { pushToken: null } })
      .catch((err) => console.error('Failed to clear dead push tokens:', err));
  }
}

export async function handleAllNotifications(
  eventType: string,
  payload: unknown,
): Promise<void> {
  switch (eventType) {
    // NOTE: session/break completion intentionally sends NO notification here.
    // The mobile app schedules a local OS notification for the timer alarm
    // (services/notifications.ts) and shows an on-screen Alert in the foreground,
    // so a server push — and a stored notification record — would be redundant.
    case 'task_goal.completed': {
      const p = payload as TaskGoalCompletedEvent;
      // Describe whichever component(s) the goal was actually measured on, so
      // the copy matches what the user sees on the goal card.
      const parts: string[] = [];
      if (p.progressMode !== 'sessions') {
        parts.push(`${p.completedTaskCount}/${p.linkedTaskCount} tasks`);
      }
      if (p.progressMode !== 'tasks' && p.targetSessions) {
        parts.push(`${p.actualSessions}/${p.targetSessions} sessions`);
      }
      const detail = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
      await storeAndNotify(
        p.userId,
        'goal_completed',
        'Goal done',
        `${p.title}${detail}`,
        'task_goal.completed',
      );
      break;
    }
    case 'achievement.unlocked': {
      const p = payload as AchievementUnlockedEvent;
      await storeAndNotify(
        p.userId,
        'achievement_unlocked',
        'Achievement unlocked',
        `You earned "${p.title}"`,
        'achievement.unlocked',
      );
      break;
    }
    case 'friend.session_started': {
      const p = payload as FriendSessionStartedEvent;
      await storeAndNotify(
        p.userId,
        'friend_focusing',
        'Someone just started',
        'A friend is in a focus session right now',
        'friend.session_started',
      );
      break;
    }
    // 'friend.goal_completed' removed with the session-target goal system —
    // TaskGoal has no friend-visible completion to notify on.
    case 'post.created': {
      const p = payload as PostCreatedEvent;
      const preview = p.caption?.trim()
        ? `"${p.caption.trim().slice(0, 80)}"`
        : 'Tap to see what they shared.';
      await fanOutToFollowers(
        p.authorId,
        'friend_post',
        `${p.authorUsername} shared a post`,
        preview,
        'post.created',
      );
      break;
    }
  }
}
