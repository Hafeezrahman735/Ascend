import { useEffect } from 'react';

import { useTimerStore } from '../stores/timerStore';
import { useTaskStore } from '../stores/taskStore';
import { useAppForeground } from './useAppState';
import { syncLiveActivity, reconcileLiveActivity } from '../services/liveActivity';
import type { TimerSnapshot } from '../lib/liveActivityState';

/**
 * Mirrors the timer onto the Lock Screen and Dynamic Island.
 *
 * Built as a subscriber, exactly like `useTimerNotifications`, so that not one
 * line of the timer's state machine has to change: the timer stays frontend-
 * owned and timestamp-based, and this reacts to it from the outside. The Live
 * Activity is never a source of truth.
 *
 * Note what is absent — there is no per-tick work. `tick()` only ever changes
 * `timeLeft`, which is not part of the snapshot below, so a running countdown
 * produces no bridge traffic at all. iOS renders the ticking itself from the end
 * date it was handed when the segment began.
 */
function snapshot(): TimerSnapshot {
  const t = useTimerStore.getState();
  const { tasks, selectedTaskId } = useTaskStore.getState();

  return {
    status: t.status,
    mode: t.mode,
    phase: t.currentPhase,
    settings: t.settings,
    plannedFocusSeconds: t.plannedFocusSeconds,
    elapsedAtPause: t.elapsedAtPause,
    startedAt: t.startedAt,
    taskLabel: selectedTaskId
      ? tasks.find((task) => task.id === selectedTaskId)?.title ?? null
      : null,
  };
}

export function useTimerLiveActivity(): void {
  useEffect(() => {
    const unsubscribe = useTimerStore.subscribe((state, prev) => {
      // The fields that change what the card shows. `timeLeft` is deliberately
      // not among them: it changes every second and iOS already accounts for it.
      const changed =
        state.status !== prev.status ||
        state.startedAt !== prev.startedAt ||
        state.currentPhase !== prev.currentPhase ||
        state.mode !== prev.mode ||
        state.plannedFocusSeconds !== prev.plannedFocusSeconds;

      if (!changed) return;

      syncLiveActivity(snapshot()).catch((err) =>
        console.warn('[liveActivity] sync from timer failed:', err),
      );
    });

    return () => unsubscribe();
  }, []);

  // The task label is on the card, and the selected task can change under a
  // running session.
  useEffect(() => {
    const unsubscribe = useTaskStore.subscribe((state, prev) => {
      if (state.selectedTaskId === prev.selectedTaskId) return;
      syncLiveActivity(snapshot()).catch((err) =>
        console.warn('[liveActivity] sync from task selection failed:', err),
      );
    });

    return () => unsubscribe();
  }, []);

  // Force-quit leaves a frozen card behind with no handle to it. Reuse the
  // existing foreground hook rather than adding another AppState listener.
  useAppForeground(() => {
    reconcileLiveActivity(snapshot()).catch((err) =>
      console.warn('[liveActivity] reconcile failed:', err),
    );
  });
}
