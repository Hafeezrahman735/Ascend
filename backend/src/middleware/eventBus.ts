import { EventEmitter } from 'events';

export const EventTypes = {
  SESSION_COMPLETED: 'session.completed',
  // Replaces the removed GOAL_COMPLETED / FRIEND_GOAL_COMPLETED pair, which
  // belonged to the deleted session-target goal system and never fired.
  TASK_GOAL_COMPLETED: 'task_goal.completed',
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  FRIEND_SESSION_STARTED: 'friend.session_started',
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

export interface TaskGoalCompletedEvent {
  userId: string;
  goalId: string;
  title: string;
  /** Which component(s) drove completion, for the notification copy. */
  progressMode: 'tasks' | 'sessions' | 'both';
  completedTaskCount: number;
  linkedTaskCount: number;
  actualSessions: number;
  targetSessions: number | null;
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

/**
 * Personal accomplishment events. `task_completed` and `goal_completed` were
 * added so the Recent Activity log covers finishing work, not only time spent —
 * previously nothing emitted them and the log could never show either.
 */
export type FeedEventType =
  | 'session_completed'
  | 'achievement_unlocked'
  | 'streak_milestone'
  | 'level_up'
  | 'task_completed'
  | 'goal_completed';

export interface FeedCreateEvent {
  userId: string;
  eventType: FeedEventType;
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
