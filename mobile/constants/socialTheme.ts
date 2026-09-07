import type { PostType, FreePostTag } from '../types';
import type { ThemeColors } from '../hooks/useTheme';

// ─── Social brand palettes ────────────────────────────────────────────────────
// Same key sets, dark + light variants. Merged onto the object returned by
// useTheme(), so components read AMBER / ROSE / GOLD / BORDER_SOFT off Colors.

export const darkSocialTheme = {
  BORDER_SOFT: '#1C1C48',
  AMBER:       '#FFB347',
  AMBER_DIM:   '#3A2800',
  ROSE:        '#F06292',
  ROSE_DIM:    '#3A0F20',
  GOLD:        '#FFD700',
  GOLD_DIM:    '#3A3000',
};

export const lightSocialTheme: typeof darkSocialTheme = {
  BORDER_SOFT: '#E8DDD5',
  AMBER:       '#D4820A',
  AMBER_DIM:   '#FEF3E2',
  ROSE:        '#D04070',
  ROSE_DIM:    '#FEE8EF',
  GOLD:        '#B07010',
  GOLD_DIM:    '#FEF6D8',
};

// Standalone exports retained for any module-level/static use (default dark).
export const {
  BORDER_SOFT, AMBER, AMBER_DIM, ROSE, ROSE_DIM, GOLD, GOLD_DIM,
} = darkSocialTheme;

// ─── Post type badge metadata ─────────────────────────────────────────────────
// Built from the active theme so badge colors stay readable in both modes.
export function makePostTypeMeta(
  c: ThemeColors,
): Record<PostType, { label: string; bg: string; color: string }> {
  return {
    session_recap:      { label: '⚡ Session Recap',        bg: c.primaryDim, color: c.primarySoft },
    achievement_unlock: { label: '🏅 Achievement Unlocked', bg: c.GOLD_DIM,   color: c.GOLD },
    accountability:     { label: '🤝 Accountability',        bg: c.accentDim,    color: c.accent },
    streak_milestone:   { label: '🔥 Streak Milestone',      bg: c.AMBER_DIM,  color: c.AMBER },
    free_post:          { label: '✏️ Free Post',             bg: c.ROSE_DIM,   color: c.ROSE },
  };
}

// Free-post tags carry no color — static is fine in both themes.
export const FREE_TAG_META: Record<FreePostTag, { emoji: string; label: string }> = {
  study_tip:   { emoji: '💡', label: 'Study Tip' },
  question:    { emoji: '❓', label: 'Question' },
  motivation:  { emoji: '🙌', label: 'Motivation' },
  celebration: { emoji: '🎉', label: 'Celebration' },
  resource:    { emoji: '📖', label: 'Resource' },
  general:     { emoji: '💬', label: 'General' },
};
