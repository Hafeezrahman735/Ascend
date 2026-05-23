import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import {
  SessionCompletedEvent,
  GoalCompletedEvent,
  AchievementUnlockedEvent,
  FriendSessionStartedEvent,
  FriendGoalCompletedEvent,
} from '../../middleware/eventBus';
import { prisma } from '../../lib/prisma';
import { shouldNotify } from './service';
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

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    priority: 'high',
  };

  try {
    const [ticket] = await expo.sendPushNotificationsAsync([message]);
    if (ticket.status === 'error') {
      console.error('Push notification error:', ticket.message);
    }
  } catch (error) {
    console.error('Failed to send push notification:', error);
  }
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

export async function handleAllNotifications(
  eventType: string,
  payload: unknown,
): Promise<void> {
  switch (eventType) {
    case 'session.completed': {
      const p = payload as SessionCompletedEvent;
      if (p.type === 'focus') {
        await storeAndNotify(
          p.userId,
          'session_completed',
          'Focus Session Complete!',
          `You completed a ${Math.round(p.durationSeconds / 60)}-minute focus session. Time for a break!`,
          'session.completed',
        );
      } else {
        await storeAndNotify(
          p.userId,
          'break_completed',
          'Break Over!',
          'Ready to focus again? Start your next Pomodoro!',
          'break_completed',
        );
      }
      break;
    }
    case 'goal.completed': {
      const p = payload as GoalCompletedEvent;
      await storeAndNotify(
        p.userId,
        'goal_completed',
        'Goal Achieved!',
        `You completed your ${p.goalType} goal of ${p.targetValue}! Keep it up!`,
        'goal.completed',
      );
      break;
    }
    case 'achievement.unlocked': {
      const p = payload as AchievementUnlockedEvent;
      await storeAndNotify(
        p.userId,
        'achievement_unlocked',
        'Achievement Unlocked!',
        `You earned "${p.title}"! Check your achievements.`,
        'achievement.unlocked',
      );
      break;
    }
    case 'friend.session_started': {
      const p = payload as FriendSessionStartedEvent;
      await storeAndNotify(
        p.userId,
        'friend_focusing',
        'Friend Started Focusing!',
        'Your friend just started a focus session!',
        'friend.session_started',
      );
      break;
    }
    case 'friend.goal_completed': {
      const p = payload as FriendGoalCompletedEvent;
      await storeAndNotify(
        p.userId,
        'friend_goal',
        'Friend Hit Their Goal!',
        `A friend just completed their ${p.goalType} goal!`,
        'friend.goal_completed',
      );
      break;
    }
  }
}
