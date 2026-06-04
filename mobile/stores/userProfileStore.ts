import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AVATAR_EMOJIS = ['🦊', '🐸', '🦁', '🐳', '🦉', '🐰', '🦋', '🐙', '🦚', '🐻', '🦝', '🐵'];

function defaultAvatarEmoji(username: string): string {
  let hash = 0;
  for (const c of username) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff;
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

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  displayName: '',
  handle: '',
  avatarEmoji: '',
  isLoaded: false,

  load: async (userId: string, username: string) => {
    try {
      const raw = await AsyncStorage.getItem(`profile:${userId}`);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<ProfileData>;
        set({
          displayName: stored.displayName ?? username,
          handle: stored.handle ?? username.toLowerCase().replace(/\s+/g, ''),
          avatarEmoji: stored.avatarEmoji ?? defaultAvatarEmoji(username),
          isLoaded: true,
        });
      } else {
        set({
          displayName: username,
          handle: username.toLowerCase().replace(/\s+/g, ''),
          avatarEmoji: defaultAvatarEmoji(username),
          isLoaded: true,
        });
      }
    } catch {
      set({
        displayName: username,
        handle: username.toLowerCase().replace(/\s+/g, ''),
        avatarEmoji: defaultAvatarEmoji(username),
        isLoaded: true,
      });
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
    try {
      await AsyncStorage.setItem(`profile:${userId}`, JSON.stringify(next));
    } catch {}
  },

  reset: () => set({ displayName: '', handle: '', avatarEmoji: '', isLoaded: false }),
}));
