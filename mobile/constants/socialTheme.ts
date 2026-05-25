import { Colors } from './Colors';
import type { PostType, FreePostTag } from '../types';

export const BORDER_SOFT = '#1C1C48';
export const AMBER       = '#FFB347';
export const AMBER_DIM   = '#3A2800';
export const ROSE        = '#F06292';
export const ROSE_DIM    = '#3A0F20';
export const GOLD        = '#FFD700';
export const GOLD_DIM    = '#3A3000';
export const TEAL        = '#00E5C3';

export const POST_TYPE_META: Record<PostType, { label: string; bg: string; color: string }> = {
  session_recap:      { label: '⚡ Session Recap',        bg: Colors.primaryDim, color: Colors.primarySoft },
  achievement_unlock: { label: '🏅 Achievement Unlocked', bg: GOLD_DIM,          color: GOLD },
  accountability:     { label: '🤝 Accountability',        bg: Colors.tealDim,    color: Colors.accent },
  streak_milestone:   { label: '🔥 Streak Milestone',      bg: AMBER_DIM,         color: AMBER },
  free_post:          { label: '✏️ Free Post',             bg: ROSE_DIM,          color: ROSE },
};

export const FREE_TAG_META: Record<FreePostTag, { emoji: string; label: string }> = {
  study_tip:   { emoji: '💡', label: 'Study Tip' },
  question:    { emoji: '❓', label: 'Question' },
  motivation:  { emoji: '🙌', label: 'Motivation' },
  celebration: { emoji: '🎉', label: 'Celebration' },
  resource:    { emoji: '📖', label: 'Resource' },
  general:     { emoji: '💬', label: 'General' },
};
