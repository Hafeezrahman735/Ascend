import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SettingsData {
  publicProfile: boolean;
  showOnLeaderboard: boolean;
  shareFocusStats: boolean;
  friendsCanSeeActivity: boolean;
  notifySessionComplete: boolean;
  notifyDailyReminder: boolean;
  notifyFriendActivity: boolean;
  notifyAchievements: boolean;
  theme: 'dark' | 'light';
}

interface UserSettingsState extends SettingsData {
  isLoaded: boolean;
  load: (userId: string) => Promise<void>;
  update: (userId: string, updates: Partial<SettingsData>) => Promise<void>;
  reset: () => void;
}

const DEFAULTS: SettingsData = {
  publicProfile: true,
  showOnLeaderboard: true,
  shareFocusStats: true,
  friendsCanSeeActivity: true,
  notifySessionComplete: true,
  notifyDailyReminder: true,
  notifyFriendActivity: true,
  notifyAchievements: true,
  theme: 'dark',
};

export const useUserSettingsStore = create<UserSettingsState>((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  load: async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(`settings:${userId}`);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<SettingsData>;
        // Legacy 'system' (or any non-'light' value) resolves to dark.
        const theme: 'dark' | 'light' = stored.theme === 'light' ? 'light' : 'dark';
        set({ ...DEFAULTS, ...stored, theme, isLoaded: true });
      } else {
        set({ ...DEFAULTS, isLoaded: true });
      }
    } catch {
      set({ ...DEFAULTS, isLoaded: true });
    }
  },

  update: async (userId: string, updates: Partial<SettingsData>) => {
    set(updates);
    const state = get();
    const data: SettingsData = {
      publicProfile: state.publicProfile,
      showOnLeaderboard: state.showOnLeaderboard,
      shareFocusStats: state.shareFocusStats,
      friendsCanSeeActivity: state.friendsCanSeeActivity,
      notifySessionComplete: state.notifySessionComplete,
      notifyDailyReminder: state.notifyDailyReminder,
      notifyFriendActivity: state.notifyFriendActivity,
      notifyAchievements: state.notifyAchievements,
      theme: state.theme,
    };
    try {
      await AsyncStorage.setItem(`settings:${userId}`, JSON.stringify(data));
    } catch {}
  },

  reset: () => set({ ...DEFAULTS, isLoaded: false }),
}));
