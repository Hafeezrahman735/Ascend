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
  avatarEmoji: string;
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
  /** How far the user is toward `threshold`, capped at it. Server-computed. */
  currentValue: number;
  /** currentValue / threshold, 0..1 — for progress bars on locked achievements. */
  progress: number;
  /**
   * Difficulty tier 1-4, server-derived from xpReward. Ordering only — never
   * rendered as a visible label, because the tier is provisional until an
   * authored `tier` column lands and a re-tiering would read as a downgrade.
   * Optional so a client running against an older server still type-checks.
   */
  tier?: 1 | 2 | 3 | 4;
}

/** One entry in the personal accomplishment log (GET /activity). */
export interface ActivityEvent {
  id: string;
  eventType:
    | 'session_completed'
    | 'achievement_unlocked'
    | 'streak_milestone'
    | 'level_up'
    | 'task_completed'
    | 'goal_completed';
  payload: Record<string, unknown>;
  createdAt: string;
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

export type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const DAY_LABELS: Record<DayOfWeek, string> = {
  sun: 'S',
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
};

export const DAY_FULL_LABELS: Record<DayOfWeek, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

export interface Task {
  id: string;
  title: string;
  // These are nullable columns on the backend, so the API sends `null` (not
  // undefined) when they are unset, and PATCH accepts `null` to clear them.
  description?: string | null;
  dueDate?: string | null;
  tags: string[];
  estimatedMinutes?: number | null;
  // Scheduled time of day, as minutes from LOCAL midnight (0-1439). Both set or
  // both null — the backend rejects a half-open pair. Not an instant on purpose:
  // 09:00 must stay 09:00 across a timezone change, matching dueDate’s
  // “a day is a day” contract. Untimed tasks are the common case.
  startMinutes?: number | null;
  endMinutes?: number | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  isArchived: boolean;
  isCompleted: boolean;
  completedAt?: string | null;
  createdAt: string;
  sessionsOnTask: number;
  totalTimeOnTask: number;
  sessionDates: string[];
  estimationAccuracy?: number | null;
  taskGoalId?: string | null;
  order?: number | null;

  // Recurring task fields
  isRecurring: boolean;
  recurringDays: DayOfWeek[]; // empty array = every day
  lastSpawnedDate: string | null;
  parentTaskId: string | null;

  // On TEMPLATES — lifetime habit stats:
  currentStreak: number;    // consecutive days completed (resets immediately on a miss)
  longestStreak: number;
  totalCompletions: number;
  totalFocusTimeMs: number; // accumulates instance totalTimeOnTask (seconds), see backend

  // On INSTANCES — read-only copies denormalized from the template at spawn time:
  lifetimeStreak: number;
  lifetimeTotalCompletions: number;
  lifetimeTotalFocusTime: number;
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  content: string;
  /** 'YYYY-MM-DD' when pinned to a day, null when unscheduled. */
  date: string | null;
  isTodo: boolean;
  isCompleted: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarEvent {
  id: string;
  date: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
}

/**
 * An event authored in Ascend: time that is spoken for but is not work you do.
 *
 * Named CalendarEvent rather than Event to avoid shadowing the global DOM Event
 * type. Deliberately thin — no description, no location, no reminders. Those are
 * omissions, not oversights: the model exists to hold a day and a slot.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  /** 'YYYY-MM-DD'. Always set — an undated event is not a thing. */
  date: string;
  /** Minutes from local midnight. Both null together means an all-day event. */
  startMinutes: number | null;
  endMinutes: number | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CalendarItemType =
  | 'task'
  | 'habit_instance'
  | 'goal_deadline'
  | 'event'
  | 'note'
  | 'external_google'
  | 'external_apple';

/**
 * One schedulable thing on a day. `type` is assigned by the server (or, for
 * external_apple, by the device layer) so the client never has to infer the kind
 * from the shape of `data`.
 */
export interface CalendarItem {
  type: CalendarItemType;
  /** 'YYYY-MM-DD' */
  date: string;
  data: unknown;
}

export interface CalendarStats {
  byTag: Record<string, number>;
  byDayOfWeek: Record<string, number>;
  plannedVsActual: {
    taskId: string;
    title: string;
    estimatedMinutes: number;
    actualMinutes: number;
    ratio: number | null;
    isOutlier: boolean;
  }[];
  totalSeconds: number;
  sessionCount: number;
  /** Distinct days with at least one session, in the requested range. */
  daysStudied: number;
  /** Most sessions completed on any single day in the range. */
  bestDaySessions: number;
  /** 'YYYY-MM-DD' -> session count, for the month heat grid. */
  sessionsPerDay: Record<string, number>;
  /** Live user stats — NOT scoped to the requested range. */
  currentStreak: number;
  longestStreak: number;
}

export interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  syncEnabled: boolean;
  calendarId: string | null;
  lastSyncedAt: string | null;
}

export type ProgressMode = 'tasks' | 'sessions' | 'both';

export interface TaskGoal {
  id: string;
  title: string;
  tag: string | null;
  targetSessions: number | null;
  /** Which components count toward progress. Server-normalised. */
  progressMode: ProgressMode;
  /** Calendar day, 'YYYY-MM-DD' — no time or timezone. */
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  isArchived: boolean;
  createdAt: string;

  // ── Server-computed. Authoritative — do not recompute these locally. ──
  // The client used to derive counts from its own task list, which excludes
  // recurring templates, giving a different answer than the server for the same
  // goal. Use these; the local store is only for optimistic UI between fetches.
  linkedTaskCount: number;
  completedTaskCount: number;
  actualSessions: number;
  /**
   * Credited focus seconds across every session logged against this goal's
   * tasks. SECONDS — note `gamificationStore.totalFocusMinutes` is minutes;
   * comparing the two without converting is wrong by a factor of 60.
   *
   * Counts sessions on ARCHIVED tasks too, unlike the task counts above, which
   * exclude them (`backend/src/lib/goalProgress.ts:95` vs `:117-123`). For a
   * goal linked to a recurring habit that means this keeps every session ever
   * while `linkedTaskCount` sees only today's live instance. Deliberate on the
   * server, and the reason anything displaying it has to say "all time".
   */
  totalFocusSeconds: number;
  /**
   * Wall-clock days from creation to completion, or to now while still open.
   * On an in-flight goal this is "days since you made this", which reads as an
   * accusation — only render it on a completed goal.
   */
  elapsedDays: number;
  taskProgress: number;
  /** null when the goal has no session target. */
  sessionProgress: number | null;
  /** 0..1 — what the progress bar renders. */
  overallProgress: number;
}

/**
 * Server-computed per-task analytics from `GET /tasks/:id?tz=<IANA zone>`.
 *
 * Every day and hour bucket is resolved in the timezone the client sends. Omit
 * `tz` and the server falls back to UTC, which is what the whole app did before
 * — and why peak hour used to be wrong by a full UTC offset for everyone
 * outside it. See backend/src/lib/taskAnalytics.ts.
 */
export interface TaskAnalytics {
  totalTimeToday: number;
  totalTimeThisWeek: number;
  totalTimeThisMonth: number;
  totalTimeAllTime: number;
  timePerDayLast7: { date: string; seconds: number }[];
  mostProductiveHour: { hour: number; label: string } | null;
  avgSessionLength: number;
  sessionCount: number;

  /** Share of sessions that ran to (near) their planned length. */
  fullSessionRate: number;
  /** @deprecated Misnamed alias of `fullSessionRate` — do not add new readers. */
  completionRate: number;

  /** 100 when actual matched the estimate, falling to 0 as it deviates. */
  estimationAccuracy: number | null;
  /** actual/estimate as a percentage — uncapped, so >100 means overrun. */
  estimateUsedPct: number | null;
  /** Signed seconds: positive is over the estimate, negative is under. */
  estimateDeltaSeconds: number | null;

  /** Distinct local days with at least one session. */
  daysWorked: number;
  /** `daysWorked` over the task's age in days, capped at 1. Null if never worked. */
  consistency: number | null;
  /** ISO timestamp of the newest session, or null. */
  lastSessionAt: string | null;
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
  avatarEmoji: string;
  level: number;
  relationshipStatus?: 'none' | 'pending_sent' | 'pending_received' | 'friends';
  isFollowing?: boolean;
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

export type PostType = 'session_recap' | 'achievement_unlock' | 'streak_milestone' | 'accountability' | 'free_post';
export type GroupColor = 'purple' | 'teal' | 'amber' | 'rose';
export type FreePostTag = 'study_tip' | 'question' | 'motivation' | 'celebration' | 'resource' | 'general';

export interface AttachedStat {
  label: string;
  value: string;
}

export interface SocialPost {
  id: string;
  authorId: string;
  authorName: string;
  authorEmoji: string;
  authorRank: string;
  type: PostType;
  caption: string | null;
  createdAt: string;
  visibility: 'public' | 'group';
  groupId: string | null;
  groupName?: string;
  sessionCount: number | null;
  focusMinutes: number | null;
  streakAtPost: number | null;
  totalSessionsAtPost: number | null;
  totalFocusHoursAtPost: number | null;
  achievementId: string | null;
  achievementIcon?: string;
  achievementName?: string;
  achievementDescription?: string;
  achievementXpReward?: number;
  achievementRank?: string;
  challengeId: string | null;
  challenge?: GroupChallenge;
  photoUrl: string | null;
  contentTag: FreePostTag | null;
  attachedStats: AttachedStat[] | null;
  reactions: Record<string, string[]>;
}

export interface StudyGroup {
  id: string;
  name: string;
  /** Optional: groups created before the column existed have none. */
  description?: string | null;
  emoji: string;
  color: GroupColor;
  memberIds: string[];
  memberCount: number;
  createdBy: string;
  createdAt: string;
  isPrivate: boolean;
  isMember?: boolean;
  hasRecentActivity?: boolean;
}

/**
 * Why a group detail fetch failed. `unavailable` means the request never got a
 * real answer (offline, timeout, 5xx, or a route the deployed backend does not
 * have yet) and is worth retrying; `not-found` means the server answered and
 * the group is genuinely gone or private. Collapsing the two into one null was
 * a real debugging cost: an undeployed route reported itself as a missing group.
 */
export type GroupDetailResult =
  | { ok: true; detail: GroupDetail }
  | { ok: false; reason: 'not-found' | 'unavailable'; message?: string };

/** One row of a group's member list, as returned by GET /social/groups/:id. */
export interface GroupMember {
  id: string;
  username: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  level: number;
  joinedAt: string;
  isCreator: boolean;
}

/**
 * A group plus its member list. Only the creator may add or remove people, so
 * `isCreator` is what the detail screen gates its management controls on.
 */
export interface GroupDetail extends StudyGroup {
  isCreator: boolean;
  members: GroupMember[];
}

export interface GroupChallenge {
  id: string;
  groupId: string;
  createdBy: string;
  title: string;
  metric: 'sessions' | 'focus_hours';
  targetValue: number;
  deadline: string;
  memberProgress: Record<string, number>;
  memberEmojis?: string[];
  createdAt: string;
}

export interface FocusLeaderboardEntry {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  rank: string;
  currentStreak: number;
  focusMinutes: number;
  position: number;
  positionDelta: number | null;
  isMe?: boolean;
}

export interface InAppNotification {
  id: string;
  text: string;
  link?: string;
  createdAt: string;
  isRead: boolean;
}

export interface PublicUserProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  avatarEmoji: string;
  level: number;
  rank: string;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusTime: number;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  isBlocked: boolean;
  isMe: boolean;
  recentAchievements: Achievement[];
}

export interface FriendPreview {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  avatarColor: GroupColor;
}

export interface UserSocialStats {
  userId: string;
  followerCount: number;
  followingCount: number;
  friendCount: number;
  friendPreviews: FriendPreview[];
}

export interface UserListItem {
  userId: string;
  displayName: string;
  handle: string;
  avatarEmoji: string;
  rank: string;
}

