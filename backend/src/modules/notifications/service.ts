import { prisma } from '../../lib/prisma';

interface NotificationPreferences {
  sessions: boolean;
  friends: boolean;
  goals: boolean;
  achievements: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  sessions: true,
  friends: true,
  goals: true,
  achievements: true,
};

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  if (!user || !user.notificationPrefs) {
    return { ...DEFAULT_PREFERENCES };
  }
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(user.notificationPrefs) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function updatePreferences(
  userId: string,
  prefs: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const current = await getPreferences(userId);
  const merged = { ...current, ...prefs };
  await prisma.user.update({
    where: { id: userId },
    data: { notificationPrefs: JSON.stringify(merged) },
  });
  return merged;
}

export async function shouldNotify(
  userId: string,
  eventType: string,
): Promise<boolean> {
  const prefs = await getPreferences(userId);
  switch (eventType) {
    case 'session.completed':
    case 'break_completed':
      return prefs.sessions;
    case 'goal.completed':
      return prefs.goals;
    case 'achievement.unlocked':
      return prefs.achievements;
    case 'friend.session_started':
    case 'friend.goal_completed':
      return prefs.friends;
    default:
      return true;
  }
}
