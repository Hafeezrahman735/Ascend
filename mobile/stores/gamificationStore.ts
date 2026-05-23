import { create } from 'zustand';
import { api } from '../services/api';
import { SessionReward, UserGamification, Achievement } from '../types';

interface GamificationStoreState {
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalFocusMinutes: number;
  achievements: Achievement[];
  pendingRewards: SessionReward[];
  isLoading: boolean;

  fetchProfile: () => Promise<void>;
  fetchAchievements: () => Promise<void>;
  applySessionReward: (reward: SessionReward) => void;
  clearPendingRewards: () => void;
}

export const useGamificationStore = create<GamificationStoreState>((set, get) => ({
  xp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  totalSessions: 0,
  totalFocusMinutes: 0,
  achievements: [],
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

  fetchAchievements: async () => {
    try {
      const res = await api.get<Achievement[]>('/achievements');
      if (res.success && res.data) {
        set({ achievements: res.data });
      }
    } catch {
    }
  },

  applySessionReward: (reward: SessionReward) => {
    const state = get();
    set({
      xp: reward.totalXP,
      level: reward.level,
      currentStreak: reward.newStreak,
      longestStreak: reward.longestStreak,
      totalSessions: state.totalSessions + 1,
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
}));
