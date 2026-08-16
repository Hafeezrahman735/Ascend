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
  return parsePreferences(user?.notificationPrefs);
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

/** Parse a stored notificationPrefs string, falling back to defaults. */
export function parsePreferences(raw: string | null | undefined): NotificationPreferences {
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Pure preference check, so bulk fan-out can filter thousands of recipients from
 * one query instead of re-reading each user's prefs individually.
 */
export function allowsEvent(
  rawPrefs: string | null | undefined,
  eventType: string,
): boolean {
  const prefs = parsePreferences(rawPrefs);
  switch (eventType) {
    case 'session.completed':
    case 'break_completed':
      return prefs.sessions;
    case 'task_goal.completed':
      return prefs.goals;
    case 'achievement.unlocked':
      return prefs.achievements;
    case 'friend.session_started':
    case 'post.created':
      return prefs.friends;
    default:
      return true;
  }
}

export async function shouldNotify(
  userId: string,
  eventType: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  return allowsEvent(user?.notificationPrefs, eventType);
}
