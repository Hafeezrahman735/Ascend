import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const OVERRIDES_KEY = 'tag:overrides';

// ─── 10-color token map ───────────────────────────────────────────────────────
// Each color has: bar (dot/bar accent), bg (chip background), text (chip label)
export const TAG_COLOR_TOKENS = [
  { key: 'purple',   bar: '#7B6EF6', bg: '#2a2560', text: '#A89CF9' },
  { key: 'teal',     bar: '#00E5C3', bg: '#003d35', text: '#5CF5E0' },
  { key: 'coral',    bar: '#F06292', bg: '#3A0F20', text: '#F48FB1' },
  { key: 'amber',    bar: '#F59E0B', bg: '#2D1E02', text: '#FBBF24' },
  { key: 'lavender', bar: '#C084FC', bg: '#2A1A40', text: '#D8B4FE' },
  { key: 'mint',     bar: '#6EE7B7', bg: '#052E1C', text: '#A7F3D0' },
  { key: 'sky',      bar: '#38BDF8', bg: '#082F49', text: '#7DD3FC' },
  { key: 'peach',    bar: '#FDBA74', bg: '#2C1002', text: '#FED7AA' },
  { key: 'rose',     bar: '#FB7185', bg: '#3B0020', text: '#FDA4AF' },
  { key: 'emerald',  bar: '#34D399', bg: '#022C22', text: '#6EE7B7' },
] as const;

export type TagColorKey = typeof TAG_COLOR_TOKENS[number]['key'];
export type TagColorToken = typeof TAG_COLOR_TOKENS[number];

// ─── 16-icon pool ─────────────────────────────────────────────────────────────
export const TAG_ICONS = [
  '📚', '🧮', '🔬', '🎨', '📝', '🌍', '💡', '⚡',
  '🎯', '🔭', '🎵', '💻', '📖', '🏆', '🌱', '⚗️',
] as const;
export type TagIcon = typeof TAG_ICONS[number];

// ─── Stable hash (same result on every device/restart) ───────────────────────
function stableHash(s: string): number {
  let h = 0;
  for (const c of s) h = ((h * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return h;
}

export function getTagColor(tag: string): TagColorToken {
  return TAG_COLOR_TOKENS[stableHash(tag) % TAG_COLOR_TOKENS.length];
}

export function getTagIcon(tag: string): string {
  // Use a different seed than getTagColor so color and icon don't always pair identically
  return TAG_ICONS[stableHash(tag + '#icon') % TAG_ICONS.length];
}

// ─── Full style object ────────────────────────────────────────────────────────
export interface TagStyle {
  bar: string;   // accent color for bars and dots
  bg: string;    // chip / card background
  text: string;  // chip / card text
  icon: string;  // emoji icon
}

export interface TagOverride {
  colorKey: TagColorKey;
  icon: string;
}

export function getTagStyle(tag: string, override?: TagOverride): TagStyle {
  if (override) {
    const token = TAG_COLOR_TOKENS.find((t) => t.key === override.colorKey) ?? getTagColor(tag);
    return { bar: token.bar, bg: token.bg, text: token.text, icon: override.icon };
  }
  const token = getTagColor(tag);
  return { bar: token.bar, bg: token.bg, text: token.text, icon: getTagIcon(tag) };
}

// ─── Override store ───────────────────────────────────────────────────────────
interface TagOverrideStore {
  overrides: Record<string, TagOverride>;
  loaded: boolean;
  loadOverrides: () => Promise<void>;
  setOverride: (tag: string, colorKey: TagColorKey, icon: string) => Promise<void>;
  clearOverride: (tag: string) => Promise<void>;
}

export const useTagOverrideStore = create<TagOverrideStore>((set, get) => ({
  overrides: {},
  loaded: false,

  loadOverrides: async () => {
    if (get().loaded) return;
    try {
      const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
      const overrides: Record<string, TagOverride> = raw ? JSON.parse(raw) : {};
      set({ overrides, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setOverride: async (tag, colorKey, icon) => {
    const overrides = { ...get().overrides, [tag]: { colorKey, icon } };
    set({ overrides });
    AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)).catch(() => {});
  },

  clearOverride: async (tag) => {
    const overrides = { ...get().overrides };
    delete overrides[tag];
    set({ overrides });
    AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)).catch(() => {});
  },
}));

// ─── Hook: resolves override → falls back to deterministic hash ───────────────
// Called with an empty string when the tag chip is conditionally rendered;
// returns a transparent no-op style so the wasted render is harmless.
export function useTagStyle(tag: string): TagStyle {
  const overrides = useTagOverrideStore((s) => s.overrides);
  if (!tag) return { bar: 'transparent', bg: 'transparent', text: 'transparent', icon: '' };
  return getTagStyle(tag, overrides[tag]);
}
