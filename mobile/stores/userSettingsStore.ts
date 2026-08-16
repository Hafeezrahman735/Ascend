import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { applyDailyReminder } from '../services/notifications';

export interface SettingsData {
  // Social & privacy — synced to the backend (User columns).
  publicProfile: boolean;
  showOnLeaderboard: boolean;
  shareFocusStats: boolean;
  friendsCanSeeActivity: boolean;
  // Notifications — session/friend/achievement sync to backend notificationPrefs.
  notifySessionComplete: boolean;
  notifyDailyReminder: boolean;
  notifyFriendActivity: boolean;
  notifyAchievements: boolean;
  // Daily reminder time (local only — drives the local scheduled notification).
  dailyReminderHour: number;
  dailyReminderMinute: number;
  theme: 'dark' | 'light' | 'system';
  /** 0 = Sunday, 1 = Monday. Drives week ranges in the Calendar tab. */
  weekStartDay: 0 | 1;
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
  dailyReminderHour: 19,
  dailyReminderMinute: 0,
  weekStartDay: 0,
  theme: 'dark',
};

// Which keys belong to each backend surface.
const PRIVACY_KEYS = ['publicProfile', 'showOnLeaderboard', 'shareFocusStats', 'friendsCanSeeActivity'] as const;
const NOTIF_KEYS = ['notifySessionComplete', 'notifyFriendActivity', 'notifyAchievements'] as const;
const REMINDER_KEYS = ['notifyDailyReminder', 'dailyReminderHour', 'dailyReminderMinute'] as const;

function hasAny<T extends string>(updates: Record<string, unknown>, keys: readonly T[]): boolean {
  return keys.some((k) => k in updates);
}

// Map our notification toggles to the backend notificationPrefs categories.
function toBackendNotifPrefs(s: SettingsData): { sessions: boolean; friends: boolean; achievements: boolean } {
  return {
    sessions: s.notifySessionComplete,
    friends: s.notifyFriendActivity,
    achievements: s.notifyAchievements,
  };
}

export const useUserSettingsStore = create<UserSettingsState>((set, get) => ({
  ...DEFAULTS,
  isLoaded: false,

  load: async (userId: string) => {
    // 1) Paint immediately from the local cache.
    let local: SettingsData = { ...DEFAULTS };
    try {
      const raw = await AsyncStorage.getItem(`settings:${userId}`);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<SettingsData>;
        // Normalise on read so an unrecognised stored value can never reach the
        // theme hook. Anything that isn't a known mode falls back to dark.
        const theme: SettingsData['theme'] =
          stored.theme === 'light' || stored.theme === 'system' ? stored.theme : 'dark';
        const weekStartDay: SettingsData['weekStartDay'] = stored.weekStartDay === 1 ? 1 : 0;
        local = { ...DEFAULTS, ...stored, theme, weekStartDay };
      }
    } catch {
      // fall through with defaults
    }
    set({ ...local, isLoaded: true });

    // 2) Reconcile with the backend (authoritative for privacy + notif prefs).
    try {
      const [me, prefs] = await Promise.all([
        api.get<{
          publicProfile?: boolean;
          showOnLeaderboard?: boolean;
          shareFocusStats?: boolean;
          friendsCanSeeActivity?: boolean;
        }>('/auth/me'),
        api.get<{ sessions?: boolean; friends?: boolean; achievements?: boolean }>('/notifications/preferences'),
      ]);

      const merged: SettingsData = { ...get() } as SettingsData;
      if (me.success && me.data) {
        if (typeof me.data.publicProfile === 'boolean') merged.publicProfile = me.data.publicProfile;
        if (typeof me.data.showOnLeaderboard === 'boolean') merged.showOnLeaderboard = me.data.showOnLeaderboard;
        if (typeof me.data.shareFocusStats === 'boolean') merged.shareFocusStats = me.data.shareFocusStats;
        if (typeof me.data.friendsCanSeeActivity === 'boolean') merged.friendsCanSeeActivity = me.data.friendsCanSeeActivity;
      }
      if (prefs.success && prefs.data) {
        if (typeof prefs.data.sessions === 'boolean') merged.notifySessionComplete = prefs.data.sessions;
        if (typeof prefs.data.friends === 'boolean') merged.notifyFriendActivity = prefs.data.friends;
        if (typeof prefs.data.achievements === 'boolean') merged.notifyAchievements = prefs.data.achievements;
      }
      set(merged);
      await AsyncStorage.setItem(`settings:${userId}`, JSON.stringify(merged)).catch(() => {});
    } catch {
      // offline / not reachable — keep the local cache
    }

    // 3) Apply the daily reminder based on the resolved settings.
    const s = get();
    applyDailyReminder(s.notifyDailyReminder, s.dailyReminderHour, s.dailyReminderMinute);
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
      dailyReminderHour: state.dailyReminderHour,
      dailyReminderMinute: state.dailyReminderMinute,
      theme: state.theme,
      weekStartDay: state.weekStartDay,
    };

    // Persist locally first (offline-safe, instant).
    try {
      await AsyncStorage.setItem(`settings:${userId}`, JSON.stringify(data));
    } catch {}

    // Sync privacy columns to the backend.
    if (hasAny(updates, PRIVACY_KEYS)) {
      api.patch('/auth/me/privacy', {
        publicProfile: data.publicProfile,
        showOnLeaderboard: data.showOnLeaderboard,
        shareFocusStats: data.shareFocusStats,
        friendsCanSeeActivity: data.friendsCanSeeActivity,
      }).catch((err) => console.warn('[settings] privacy sync failed:', err));
    }

    // Sync notification preferences to the backend.
    if (hasAny(updates, NOTIF_KEYS)) {
      api.patch('/notifications/preferences', toBackendNotifPrefs(data))
        .catch((err) => console.warn('[settings] notif prefs sync failed:', err));
    }

    // Reschedule / cancel the local daily reminder.
    if (hasAny(updates, REMINDER_KEYS)) {
      applyDailyReminder(data.notifyDailyReminder, data.dailyReminderHour, data.dailyReminderMinute);
    }
  },

  reset: () => set({ ...DEFAULTS, isLoaded: false }),
}));
