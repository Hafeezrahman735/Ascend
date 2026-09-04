import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../../stores/taskStore';
import { useTimerStore } from '../../stores/timerStore';
import { useGamificationStore } from '../../stores/gamificationStore';

/**
 * Grouped store reads, for the few places that genuinely need several fields at
 * once.
 *
 * This layer used to be much larger: 34 hooks across five files, backed by a
 * `selectors/` directory, of which exactly five hooks were ever imported. The
 * other 29 and the selectors under them were written speculatively and never
 * called, so they were deleted rather than maintained.
 *
 * The rule that keeps it small: a hook belongs here ONLY when a component needs
 * a GROUP of fields and `useShallow` is what stops it re-rendering on unrelated
 * state. For a single field, call the store directly with a selector —
 * `useTimerStore((s) => s.timeLeft)` — the way app/(tabs)/focus.tsx does
 * throughout. Wrapping one field in a named hook buys nothing and is how the
 * previous 29 came to exist.
 */

/** Tasks — the list and the selection are single fields, read directly. */
export function useTasksList() {
  return useTaskStore((s) => s.tasks);
}

export function useSelectedTaskId() {
  return useTaskStore((s) => s.selectedTaskId);
}

/** The task-mutation surface, as one stable object. */
export function useTaskActions() {
  return useTaskStore(
    useShallow((s) => ({
      fetchTasks: s.fetchTasks,
      createTask: s.createTask,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      selectTask: s.selectTask,
      incrementTaskSession: s.incrementTaskSession,
      toggleComplete: s.toggleComplete,
    })),
  );
}

/** Timer settings as one object — durations, targets and cycle length together. */
export function useSettings() {
  return useTimerStore(useShallow((s) => s.settings));
}

/** XP, streak, lifetime totals and achievements, plus the actions that move them. */
export function useGamification() {
  return useGamificationStore(
    useShallow((s) => ({
      xp: s.xp,
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
