import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { fetchMe, invalidateMe } from '../services/me';

import { applyDailyReminder } from '../services/notifications';

export interface SettingsData {
  // Social & privacy — synced to the backend (User columns).
  publicProfile: boolean;
  showOnLeaderboard: boolean;
  shareFocusStats: boolean;
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
  /**
   * Remind the user to switch on a Focus when a session starts.
   *
   * iOS gives no app the ability to turn Focus on, so this only gates a nudge —
   * it never blocks starting a session. Local-only: deliberately absent from
   * PRIVACY_KEYS / NOTIF_KEYS / REMINDER_KEYS so `update()` never ships it to
   * the backend, same as `theme` and `weekStartDay`.
   */
  remindFocusMode: boolean;
  /**
   * Play a sound in-app when the timer reaches zero.
   *
   * Separate from `notifySessionComplete`, which gates the OS NOTIFICATION — the
   * signal for when you are away from the app. This gates the sound for when you
   * are in it. Two different moments, two different switches.
   *
   * Local-only, like `remindFocusMode`: absent from PRIVACY_KEYS / NOTIF_KEYS /
   * REMINDER_KEYS so `update()` never ships it to the backend. An alarm is a
   * property of the device in your hand, not of your account — a tablet and a
   * phone can honestly want different answers.
   */
  alarmSound: boolean;
  /**
   * Let the alarm through the iOS ringer switch and Do Not Disturb.
   *
   * iOS only; Android's media stream is already independent of the ringer, so
   * the row is not rendered there rather than shown doing nothing.
   */
  alarmOverridesSilent: boolean;
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
  notifySessionComplete: true,
  notifyDailyReminder: true,
  notifyFriendActivity: true,
  notifyAchievements: true,
  dailyReminderHour: 19,
  dailyReminderMinute: 0,
  weekStartDay: 0,
  theme: 'dark',
  // Off by default: an unprompted nudge on first session would read as nagging.
  remindFocusMode: false,
  // On: a timer that finishes without making a noise has failed its one job.
  alarmSound: true,
  // Also on, and this is the more aggressive of the two, so it gets the argument:
  // the person who silenced their phone in order to focus is precisely this app's
  // user, and they are the one who most needs to be told the session ended.
  // Overriding the switch they just flipped is a real imposition, which is why it
  // is a setting rather than a hardcoded behaviour.
  alarmOverridesSilent: true,
};

// Which keys belong to each backend surface.
const PRIVACY_KEYS = ['publicProfile', 'showOnLeaderboard', 'shareFocusStats'] as const;
const NOTIF_KEYS = ['notifySessionComplete', 'notifyFriendActivity', 'notifyAchievements'] as const;
const REMINDER_KEYS = ['notifyDailyReminder', 'dailyReminderHour', 'dailyReminderMinute'] as const;

function hasAny<T extends string>(updates: Record<string, unknown>, keys: readonly T[]): boolean {
  return keys.some((k) => k in updates);
}

/**
 * The shape written to AsyncStorage, derived from DEFAULTS rather than listed.
 *
 * This was a field-by-field object literal. A field added to `SettingsData` and
 * `DEFAULTS` but missed in that literal was set in memory, silently dropped from
 * the write, and reverted to its default on the next launch — a toggle that works
 * until you restart the app, which manual QA does not catch. `DEFAULTS` is typed
 * as `SettingsData`, so the compiler already guarantees it names every key;
 * reading the key set off it makes the omission impossible rather than merely
 * documented.
 */
function persistedSettings(state: SettingsData): SettingsData {
  const keys = Object.keys(DEFAULTS) as (keyof SettingsData)[];
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = state[key];
  return out as unknown as SettingsData;
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
        fetchMe<{
          publicProfile?: boolean;
          showOnLeaderboard?: boolean;
          shareFocusStats?: boolean;
        }>(),
        api.get<{ sessions?: boolean; friends?: boolean; achievements?: boolean }>('/notifications/preferences'),
      ]);

      const merged: SettingsData = { ...get() } as SettingsData;
      if (me.success && me.data) {
        if (typeof me.data.publicProfile === 'boolean') merged.publicProfile = me.data.publicProfile;
        if (typeof me.data.showOnLeaderboard === 'boolean') merged.showOnLeaderboard = me.data.showOnLeaderboard;
        if (typeof me.data.shareFocusStats === 'boolean') merged.shareFocusStats = me.data.shareFocusStats;
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

    const data = persistedSettings(state);

    // Persist locally first (offline-safe, instant).
    try {
      await AsyncStorage.setItem(`settings:${userId}`, JSON.stringify(data));
    } catch {}

    // Sync privacy columns to the backend.
    if (hasAny(updates, PRIVACY_KEYS)) {
      invalidateMe();
      api.patch('/auth/me/privacy', {
        publicProfile: data.publicProfile,
        showOnLeaderboard: data.showOnLeaderboard,
        shareFocusStats: data.shareFocusStats,
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
