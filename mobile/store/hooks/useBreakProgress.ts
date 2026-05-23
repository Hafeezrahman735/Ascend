import { useTimerStore } from '../../stores/timerStore';
import { useGamificationStore } from '../../stores/gamificationStore';
import { useShallow } from 'zustand/react/shallow';
import {
  calcBreakBlocks,
  calcBreakLabel,
  calcRewardEmoji,
  calcRewardLabel,
} from '../selectors/break';
import { calcSessionInCycle } from '../selectors/timer';

export function useBreakBlocks() {
  const pomodoroRounds = useTimerStore((s) => s.pomodoroRounds);
  const sessionsUntilLong = useTimerStore((s) => s.settings.sessionsUntilLong);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcBreakBlocks(pomodoroRounds, sessionsUntilLong, currentPhase);
}

export function useBreakLabel() {
  return useTimerStore((s) => calcBreakLabel(s.currentPhase));
}

export function useRewardEmoji() {
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcRewardEmoji(currentPhase);
}

export function useRewardLabel() {
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcRewardLabel(currentPhase);
}

export function useSessionInCycle() {
  const pomodoroRounds = useTimerStore((s) => s.pomodoroRounds);
  const sessionsUntilLong = useTimerStore((s) => s.settings.sessionsUntilLong);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcSessionInCycle(pomodoroRounds, sessionsUntilLong, currentPhase);
}

export function useGamification() {
  return useGamificationStore(
    useShallow((s) => ({
      xp: s.xp,
      level: s.level,
      currentStreak: s.currentStreak,
      longestStreak: s.longestStreak,
      totalSessions: s.totalSessions,
      totalFocusMinutes: s.totalFocusMinutes,
      achievements: s.achievements,
      pendingRewards: s.pendingRewards,
      fetchProfile: s.fetchProfile,
      fetchAchievements: s.fetchAchievements,
      applySessionReward: s.applySessionReward,
      clearPendingRewards: s.clearPendingRewards,
    })),
  );
}
