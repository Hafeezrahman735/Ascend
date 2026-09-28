import { useEffect } from 'react';
import { useTimerStore } from '../stores/timerStore';
import { useUserSettingsStore } from '../stores/userSettingsStore';
import {
  scheduleFocusDoneNotification,
  scheduleBreakEndNotification,
  cancelAllTimerNotifications,
} from '../services/notifications';
import { timerNotificationSound } from '../lib/alarmPolicy';

/**
 * Subscribes to the timer store and schedules / cancels local notifications as
 * the timer state changes — without touching any timer action, so the timer's
 * state machine stays frozen.
 *
 * The store exposes the remaining time directly as `timeLeft` (seconds) — there
 * is no getRemainingMs(). `timeLeft` is the authoritative remaining seconds and
 * is recomputed by start()/complete()/pause()/resume(), so reading it at the
 * moment a running segment begins is correct even after a pause/resume.
 *
 * We key off `startedAt`: it becomes a *new* non-null value every time a running
 * segment begins (fresh start, resume, or break start) and is untouched by the
 * per-second tick — so this fires exactly on segment boundaries, never per tick.
 *
 * Store reality (see stores/timerStore.ts):
 *   - status:       'idle' | 'running' | 'paused' | 'break'
 *   - currentPhase: 'focus' | 'shortBreak' | 'longBreak'
 *   - timeLeft:     remaining seconds
 *   - mode:         'pomodoro' | 'stopwatch'   (stopwatch never schedules)
 */
export function useTimerNotifications(): void {
  useEffect(() => {
    const unsubscribe = useTimerStore.subscribe((state, prev) => {
      // A new running segment began: startedAt flipped to a new non-null value
      // while running. Pomodoro only — the stopwatch counts up and never alarms.
      const enteredRunningSegment =
        state.mode === 'pomodoro' &&
        state.status === 'running' &&
        state.startedAt != null &&
        state.startedAt !== prev.startedAt;

      // Left the running state (pause / skip / complete / reset): any pending
      // notification is no longer valid and must be cancelled.
      const leftRunning = prev.status === 'running' && state.status !== 'running';

      if (leftRunning) {
        cancelAllTimerNotifications();
      }

      if (enteredRunningSegment) {
        // Respect the user's "Session Complete" notification toggle.
        const settings = useUserSettingsStore.getState();
        if (!settings.notifySessionComplete) return;
        // The alarm switches apply to the notification as well as the in-app
        // sound. Read at segment start, like timeLeft: a change mid-segment
        // takes effect from the next start or resume.
        const sound = timerNotificationSound({
          enabled: settings.alarmSound,
          overrideSilentSwitch: settings.alarmOverridesSilent,
        });

        // timeLeft is the authoritative remaining seconds at segment start.
        const remainingSeconds = Math.max(1, state.timeLeft);
        if (state.currentPhase === 'focus') {
          scheduleFocusDoneNotification(remainingSeconds, sound);
        } else {
          scheduleBreakEndNotification(remainingSeconds, state.currentPhase === 'longBreak', sound);
        }
      }
    });

    return () => unsubscribe();
  }, []);
}
