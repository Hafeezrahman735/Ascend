import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_HERO_MEMORY, nextHeroMemory, type HeroCardMemory } from '../lib/heroCard';

/**
 * What the hero rotation remembers about overdue work between launches.
 *
 * Its own store rather than a corner of an existing one. Not userSettingsStore:
 * that holds user preferences and syncs shapes the user chose, and this is
 * derived UI memory nobody set. Not taskStore: that is a server mirror and this
 * is device-local. Not useState: it has to survive the focus reset in
 * useHeroCard, which is the entire reason it exists.
 *
 * Keyed per user, because authStore.logout does not reset the settings stores —
 * the key is the only isolation there is, and an unscoped one would leak one
 * account's overdue baseline to the next on a shared device.
 */

const MEMORY_KEY = (userId: string) => `heroCard:${userId}`;

interface HeroCardStoreState {
  memory: HeroCardMemory;
  load: (userId: string) => Promise<void>;
  /** Records that urgency led today with this many overdue items. */
  markLed: (userId: string, count: number, today: string) => void;
  clear: (userId: string) => void;
}

export const useHeroCardStore = create<HeroCardStoreState>((set) => ({
  memory: EMPTY_HERO_MEMORY,

  load: async (userId: string) => {
    if (!userId) return;
    try {
      const raw = await AsyncStorage.getItem(MEMORY_KEY(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<HeroCardMemory>;
      // Defaulted field by field: this is unvalidated JSON from disk, and an
      // undefined overdueSeen would make every comparison against it NaN, which
      // is false either way and would silently disable the cap.
      set({
        memory: {
          overdueSeen: typeof parsed.overdueSeen === 'number' ? parsed.overdueSeen : 0,
          ledOn: typeof parsed.ledOn === 'string' ? parsed.ledOn : null,
        },
      });
    } catch {
      // Fails open: no baseline means urgency may lead once, which is the safe
      // direction. Failing closed would let it lead forever.
    }
  },

  markLed: (userId: string, count: number, today: string) => {
    const memory = nextHeroMemory(count, today);
    set({ memory });
    if (!userId) return;
    AsyncStorage.setItem(MEMORY_KEY(userId), JSON.stringify(memory))
      .catch((err) => console.warn('[heroCard] persist failed:', err));
  },

  clear: (userId: string) => {
    set({ memory: EMPTY_HERO_MEMORY });
    if (userId) AsyncStorage.removeItem(MEMORY_KEY(userId)).catch(() => {});
  },
}));
