import { useMemo } from 'react';
import { useGamificationStore } from '../../stores/gamificationStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTimerStore } from '../../stores/timerStore';
import { useShallow } from 'zustand/react/shallow';
import { calcFocusStats, type FocusStatSnapshot } from '../selectors/analytics';

export function useFocusStats(): FocusStatSnapshot {
  const { totalSessions, totalFocusMinutes, currentStreak, longestStreak, level, xp } =
    useGamificationStore(
      useShallow((s) => ({
        totalSessions: s.totalSessions,
        totalFocusMinutes: s.totalFocusMinutes,
        currentStreak: s.currentStreak,
        longestStreak: s.longestStreak,
        level: s.level,
        xp: s.xp,
      })),
    );

  return useMemo(
    () => calcFocusStats(totalSessions, totalFocusMinutes, currentStreak, longestStreak, level, xp),
    [totalSessions, totalFocusMinutes, currentStreak, longestStreak, level, xp],
  );
}

export function useTaskStats() {
  return useTaskStore(
    useShallow((s) => ({
      totalTasks: s.tasks.length,
      activeTaskId: s.selectedTaskId,
      activeTaskTitle: s.tasks.find((t: any) => t.id === s.selectedTaskId)?.title ?? null,
    })),
  );
}

export function useTimerStats() {
  return useTimerStore(
    useShallow((s) => ({
      pomodoroRounds: s.pomodoroRounds,
      status: s.status,
      settings: s.settings,
    })),
  );
}

export function useLiveTotalFocusMinutes(): number {
  const storedMinutes = useGamificationStore((s) => s.totalFocusMinutes);
  const workDuration = useTimerStore((s) => s.settings.workDuration);
  const timeLeft = useTimerStore((s) => s.timeLeft);
  const status = useTimerStore((s) => s.status);

  return useMemo(() => {
    if (status === 'idle') return storedMinutes;
    const elapsedSeconds = Math.max(0, workDuration - timeLeft);
    return storedMinutes + Math.floor(elapsedSeconds / 60);
  }, [storedMinutes, workDuration, timeLeft, status]);
}
