import { EventEmitter } from 'events';

export const EventTypes = {
  SESSION_COMPLETED: 'session.completed',
  GOAL_COMPLETED: 'goal.completed',
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  FRIEND_SESSION_STARTED: 'friend.session_started',
  FRIEND_GOAL_COMPLETED: 'friend.goal_completed',
  FEED_CREATE: 'feed.create',
  FRIEND_REQUEST_SENT: 'friend_request.sent',
  FRIEND_REQUEST_ACCEPTED: 'friend_request.accepted',
  POST_CREATED: 'post.created',
} as const;

export interface SessionCompletedEvent {
  userId: string;
  sessionId: string;
  type: 'focus' | 'short_break' | 'long_break';
  durationSeconds: number;
  taskLabel: string | null;
  taskId: string | null;
  completedAt: string;
  localDate: string; // YYYY-MM-DD in the user's local timezone
}

export interface GoalCompletedEvent {
  userId: string;
  goalId: string;
  goalType: 'daily' | 'weekly';
  targetValue: number;
  period: string;
}

export interface AchievementUnlockedEvent {
  userId: string;
  achievementId: string;
  slug: string;
  title: string;
  unlockedAt: string;
}

export interface FriendSessionStartedEvent {
  userId: string;
  friendId?: string;
  taskLabel: string | null;
  startedAt: string;
}

export interface FriendGoalCompletedEvent {
  userId: string;
  friendIds?: string[];
  goalType: 'daily' | 'weekly';
  username?: string;
  completedAt?: string;
}

export interface FeedCreateEvent {
  userId: string;
  eventType: 'session_completed' | 'achievement_unlocked' | 'streak_milestone' | 'level_up';
  payload: Record<string, unknown>;
}

export interface FriendRequestSentEvent {
  requestId: string;
  fromUserId: string;
  fromUsername: string;
  fromLevel: number;
  targetUserId: string;
}

export interface FriendRequestAcceptedEvent {
  friendshipId: string;
  requesterId: string;
  addresseeId: string;
  requesterUsername: string;
  addresseeUsername: string;
}

export interface PostCreatedEvent {
  postId: string;
  authorId: string;
  authorUsername: string;
  type: string;
  caption: string | null;
}

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);
