import { EventEmitter } from 'events';

export const EventTypes = {
  SESSION_COMPLETED: 'session.completed',
  // Replaces the removed GOAL_COMPLETED / FRIEND_GOAL_COMPLETED pair, which
  // belonged to the deleted session-target goal system and never fired.
  TASK_GOAL_COMPLETED: 'task_goal.completed',
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',
  FEED_CREATE: 'feed.create',
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
  completedTaskCount: number;
  linkedTaskCount: number;
}

export interface AchievementUnlockedEvent {
  userId: string;
  achievementId: string;
  slug: string;
  title: string;
  unlockedAt: string;
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
  // No longer emitted — the Level ladder was removed — but kept in the union
  // because rows written before that are real history and still render.
  | 'level_up'
  | 'rank_up'
  | 'task_completed'
  | 'goal_completed';

export interface FeedCreateEvent {
  userId: string;
  eventType: FeedEventType;
  payload: Record<string, unknown>;
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
