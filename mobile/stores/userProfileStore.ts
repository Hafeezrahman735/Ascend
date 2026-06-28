import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';

// Must stay in lockstep with the backend's getAvatarEmoji (same list, same hash,
// same seed = userId) so an un-picked user shows the SAME default emoji on the
// client and on every backend-driven surface (leaderboard, posts, profiles).
const AVATAR_EMOJIS = ['🦊', '🐸', '🦁', '🐳', '🦉', '🐰', '🦋', '🐙', '🦚', '🐻', '🦝', '🐵'];

function defaultAvatarEmoji(seed: string): string {
  let hash = 0;
  for (const c of seed) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length];
}

interface ProfileData {
  displayName: string;
  handle: string;
  avatarEmoji: string;
}

interface UserProfileState extends ProfileData {
  isLoaded: boolean;
  load: (userId: string, username: string) => Promise<void>;
  save: (userId: string, updates: Partial<ProfileData>) => Promise<void>;
  reset: () => void;
}

function persist(userId: string, data: ProfileData) {
  AsyncStorage.setItem(`profile:${userId}`, JSON.stringify(data)).catch(() => {});
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  displayName: '',
  handle: '',
  avatarEmoji: '',
  isLoaded: false,

  load: async (userId: string, username: string) => {
    // 1) Paint from the local cache (or sensible defaults).
    let stored: Partial<ProfileData> = {};
    try {
      const raw = await AsyncStorage.getItem(`profile:${userId}`);
      if (raw) stored = JSON.parse(raw) as Partial<ProfileData>;
    } catch {
      // ignore — fall back to defaults
    }
    const base: ProfileData = {
      displayName: stored.displayName ?? username,
      handle: stored.handle ?? username.toLowerCase().replace(/\s+/g, ''),
      avatarEmoji: stored.avatarEmoji ?? defaultAvatarEmoji(userId),
    };
    set({ ...base, isLoaded: true });

    // 2) Reconcile the avatar with the backend (the source of truth, so it's
    //    consistent across devices and matches what others see).
    try {
      const me = await api.get<{ avatarEmoji?: string | null }>('/auth/me');
      if (me.success && me.data) {
        const backendEmoji = me.data.avatarEmoji;
        if (backendEmoji && backendEmoji.trim()) {
          if (backendEmoji !== base.avatarEmoji) {
            const next = { ...base, avatarEmoji: backendEmoji };
            set(next);
            persist(userId, next);
          }
        } else {
          // Backend has no avatar yet — push our current one up so every
          // backend-driven surface shows the same emoji.
          api.patch('/auth/me/profile', { avatarEmoji: base.avatarEmoji }).catch(() => {});
        }
      }
    } catch {
      // offline — keep the local value
    }
  },

  save: async (userId: string, updates: Partial<ProfileData>) => {
    const current = get();
    const next: ProfileData = {
      displayName: updates.displayName ?? current.displayName,
      handle: updates.handle ?? current.handle,
      avatarEmoji: updates.avatarEmoji ?? current.avatarEmoji,
    };
    set(next);
    persist(userId, next);

    // Sync the chosen avatar to the backend so it propagates everywhere.
    if (updates.avatarEmoji) {
      api.patch('/auth/me/profile', { avatarEmoji: next.avatarEmoji })
        .catch((err) => console.warn('[profile] avatar sync failed:', err));
    }
  },

  reset: () => set({ displayName: '', handle: '', avatarEmoji: '', isLoaded: false }),
}));
