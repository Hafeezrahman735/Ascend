import { create } from 'zustand';
import { api, type ApiErrorKind } from '../services/api';
import {
  SessionReward, UserGamification, Achievement, ActivityEvent, NewlyUnlockedAchievement,
} from '../types';
import { getLocalDateString } from '../utils/date';

interface GamificationStoreState {
  xp: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusMinutes: number;
  achievements: Achievement[];
  isLoadingAchievements: boolean;
  /**
   * Why the last achievements fetch failed, or null if it succeeded.
   *
   * Without this, a failed fetch and a user who has unlocked nothing are
   * indistinguishable — both leave `achievements` empty. Any surface that hides
   * itself when the list is empty would silently render "you have nothing"
   * during an outage.
   */
  achievementsError: ApiErrorKind | null;
  /** Personal accomplishment log — sessions, tasks, goals, achievements, levels. */
  activity: ActivityEvent[];
  isLoadingActivity: boolean;
  pendingRewards: SessionReward[];
  /**
   * Achievements earned but not yet celebrated, oldest first.
   *
   * A queue rather than a single value because one session can unlock several
   * at once — the old toast showed `newlyUnlocked[0]` and silently dropped the
   * rest. Lives in the store, not in a screen, so the celebration can be
   * rendered at the app root: sessions complete on the Timer tab, so a
   * profile-only surface fires where the user is not looking.
   */
  unlockQueue: NewlyUnlockedAchievement[];
  isLoading: boolean;

  fetchProfile: () => Promise<void>;
  checkAndResetDayStreak: () => Promise<void>;
  fetchAchievements: () => Promise<void>;
  fetchActivity: () => Promise<void>;
  applySessionReward: (reward: SessionReward, durationSeconds?: number) => void;
  clearPendingRewards: () => void;
  /** Drop the achievement currently being celebrated and advance the queue. */
  dismissUnlock: () => void;
  /** Publish an earned achievement to the social feed. */
  shareUnlock: (achievementId: string) => Promise<boolean>;
  reset: () => void;
}

export const useGamificationStore = create<GamificationStoreState>((set, get) => ({
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalSessions: 0,
  totalFocusMinutes: 0,
  achievements: [],
  isLoadingAchievements: false,
  achievementsError: null,
  activity: [],
  isLoadingActivity: false,
  pendingRewards: [],
  unlockQueue: [],
  isLoading: false,

  fetchProfile: async () => {
    try {
      const res = await api.get<UserGamification>('/auth/me');
      if (res.success && res.data) {
        set({
          xp: res.data.xp ?? 0,
          currentStreak: res.data.currentStreak ?? 0,
          longestStreak: res.data.longestStreak ?? 0,
          totalSessions: res.data.totalSessions ?? 0,
          totalFocusMinutes: Math.floor((res.data.totalFocusTime ?? 0) / 60),
        });
      }
    } catch {
    }
  },

  // Proactively resets the overall day-streak if a day was missed — the backend
  // zeroes currentStreak when last-active is older than yesterday. Fire-and-forget
  // on boot/foreground alongside spawnRecurringTasks; never throws.
  checkAndResetDayStreak: async () => {
    try {
      const res = await api.post<{ currentStreak: number }>('/auth/me/streak-check', {
        localDate: getLocalDateString(),
      });
      if (res.success && res.data) {
        set({ currentStreak: res.data.currentStreak });
      }
    } catch {
    }
  },

  fetchAchievements: async () => {
    set({ isLoadingAchievements: true });

    // No try/catch: apiRequest resolves with { success: false } rather than
    // throwing, so the old empty catch could never fire and the `res.success`
    // false branch was simply missing — a failed fetch left the list empty and
    // silent.
    const res = await api.get<Achievement[]>('/achievements');

    if (res.success && res.data) {
      set({ achievements: res.data, isLoadingAchievements: false, achievementsError: null });
      return;
    }

    // Keep whatever was already loaded — a transient failure should not blank a
    // list the user was looking at.
    set({ isLoadingAchievements: false, achievementsError: res.errorKind ?? 'server' });
  },

  fetchActivity: async () => {
    set({ isLoadingActivity: true });
    try {
      const res = await api.get<{ events: ActivityEvent[]; cursor: string | null }>('/activity');
      set({
        activity: res.success && res.data ? res.data.events : [],
        isLoadingActivity: false,
      });
    } catch {
      set({ isLoadingActivity: false });
    }
  },

  applySessionReward: (reward: SessionReward, durationSeconds = 0) => {
    const state = get();
    set({
      xp: reward.totalXP,
      currentStreak: reward.newStreak,
      longestStreak: reward.longestStreak,
      totalSessions: state.totalSessions + 1,
      totalFocusMinutes: state.totalFocusMinutes + Math.floor(durationSeconds / 60),
      pendingRewards: [...state.pendingRewards, reward],
      // Every unlock queues, not just the first.
      unlockQueue: [...state.unlockQueue, ...reward.newlyUnlocked],
    });

    if (reward.newlyUnlocked.length > 0) {
      const updatedAchievements = state.achievements.map((a) => {
        const unlocked = reward.newlyUnlocked.find((n) => n.id === a.id);
        if (unlocked) {
          return { ...a, isUnlocked: true, unlockedAt: unlocked.unlockedAt };
        }
        return a;
      });
      set({ achievements: updatedAchievements });
    }
  },

  clearPendingRewards: () => {
    set({ pendingRewards: [] });
  },

  dismissUnlock: () => {
    set((state) => ({ unlockQueue: state.unlockQueue.slice(1) }));
  },

  shareUnlock: async (achievementId: string) => {
    // The endpoint toggles, so this is only ever called from the celebration,
    // where the achievement is by definition not shared yet.
    const res = await api.patch<{ isShared: boolean }>(`/achievements/${achievementId}/share`, {});
    if (!res.success) return false;
    set((state) => ({
      achievements: state.achievements.map((a) =>
        a.id === achievementId ? { ...a, isShared: true } : a,
      ),
    }));
    return true;
  },

  reset: () => {
    set({
      xp: 0,
      currentStreak: 0,
      longestStreak: 0,
      totalSessions: 0,
      totalFocusMinutes: 0,
      achievements: [],
      isLoadingAchievements: false,
      achievementsError: null,
      // Cleared on logout so the next account never sees the previous one's log.
      activity: [],
      isLoadingActivity: false,
      pendingRewards: [],
      unlockQueue: [],
    });
  },
}));
