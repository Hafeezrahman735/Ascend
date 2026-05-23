export interface User {
  id: string;
  username: string;
  email?: string;
  avatarUrl: string | null;
  privacySetting?: string;
  createdAt?: string;
}

export interface Session {
  id: string;
  userId: string;
  type: string;
  durationSeconds: number;
  taskLabel: string | null;
  completedAt: string;
  user?: { id: string; username: string; avatarUrl: string | null };
}

export interface GoalProgressResponse {
  daily: {
    sessionsCompleted: number;
    goal: number | null;
    progress: number;
    targetCount: number | null;
  };
  weekly: {
    sessionsCompleted: number;
    focusHours: number;
    goal: number | null;
    targetHours: number | null;
  };
  streak: {
    current: number;
    longest: number;
    lastSessionDate: string | null;
  };
}

export interface Friend {
  id: string;
  username: string;
  avatarUrl: string | null;
  privacySetting?: string;
  friendshipId?: string;
  createdAt?: string;
}

export interface FriendRequest {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  requester: { id: string; username: string; avatarUrl: string | null };
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  pomodoros?: number;
  totalSeconds?: number;
  currentStreak?: number;
  longestStreak?: number;
  isMe: boolean;
}

export interface SessionReward {
  xpEarned: number;
  totalXP: number;
  level: number;
  leveledUp: boolean;
  newStreak: number;
  longestStreak: number;
  newlyUnlocked: NewlyUnlockedAchievement[];
}

export interface NewlyUnlockedAchievement {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  category: string;
  threshold: number;
  unlockedAt: string;
}

export interface Achievement {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  xpReward: number;
  category: string;
  threshold: number;
  isUnlocked: boolean;
  unlockedAt: string | null;
  isShared: boolean;
}

export interface UserGamification {
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusTime: number;
}

export interface AnalyticsSummary {
  totalSessions: number;
  totalHours: number;
  currentStreak: number;
  longestStreak: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  tags: string[];
  estimatedMinutes?: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  isArchived: boolean;
  isCompleted: boolean;
  completedAt?: string;
  createdAt: string;
  sessionsOnTask: number;
  totalTimeOnTask: number;
  sessionDates: string[];
  estimationAccuracy?: number | null;
}

export interface FeedEvent {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  eventType: 'session_completed' | 'achievement_unlocked' | 'streak_milestone' | 'level_up';
  payload: FeedEventPayload;
  createdAt: string;
}

export interface FeedEventPayload {
  durationMinutes?: number;
  taskTitle?: string;
  xpEarned?: number;
  streak?: number;
  achievementTitle?: string;
  achievementIcon?: string;
  achievementDescription?: string;
  streakDays?: number;
  newLevel?: number;
  levelTitle?: string;
}

export interface UserSearchResult {
  id: string;
  username: string;
  avatarUrl: string | null;
  level: number;
  relationshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
}

export interface FriendProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  level: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusTime: number;
  recentAchievements: Achievement[];
  recentFeedEvents: FeedEvent[];
}


