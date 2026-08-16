import { create } from 'zustand';
import { api } from '../services/api';
import { SessionReward, UserGamification, Achievement, ActivityEvent } from '../types';
import { getLocalDateString } from '../utils/date';

interface GamificationStoreState {
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusMinutes: number;
  achievements: Achievement[];
  /** Personal accomplishment log — sessions, tasks, goals, achievements, levels. */
  activity: ActivityEvent[];
  isLoadingActivity: boolean;
  pendingRewards: SessionReward[];
  isLoading: boolean;

  fetchProfile: () => Promise<void>;
  checkAndResetDayStreak: () => Promise<void>;
  fetchAchievements: () => Promise<void>;
  fetchActivity: () => Promise<void>;
  applySessionReward: (reward: SessionReward, durationSeconds?: number) => void;
  clearPendingRewards: () => void;
  reset: () => void;
}

export const useGamificationStore = create<GamificationStoreState>((set, get) => ({
  xp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  totalSessions: 0,
  totalFocusMinutes: 0,
  achievements: [],
  activity: [],
  isLoadingActivity: false,
  pendingRewards: [],
  isLoading: false,

  fetchProfile: async () => {
    try {
      const res = await api.get<UserGamification>('/auth/me');
      if (res.success && res.data) {
        set({
          xp: res.data.xp ?? 0,
          level: res.data.level ?? 1,
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
    try {
      const res = await api.get<Achievement[]>('/achievements');
      if (res.success && res.data) {
        set({ achievements: res.data });
      }
    } catch {
    }
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
      level: reward.level,
      currentStreak: reward.newStreak,
      longestStreak: reward.longestStreak,
      totalSessions: state.totalSessions + 1,
      totalFocusMinutes: state.totalFocusMinutes + Math.floor(durationSeconds / 60),
      pendingRewards: [...state.pendingRewards, reward],
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

  reset: () => {
    set({
      xp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      totalSessions: 0,
      totalFocusMinutes: 0,
      achievements: [],
      // Cleared on logout so the next account never sees the previous one's log.
      activity: [],
      isLoadingActivity: false,
      pendingRewards: [],
    });
  },
}));
