import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useTimerStore } from '../stores/timerStore';

const FOCUS_ID = 'focus-done';
const BREAK_ID = 'break-done';

// Show the banner + play sound even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Requests notification permission (and sets up the Android channel). Call once,
// AFTER the user is logged in — iOS only grants one system prompt, so the moment
// matters: it should appear when the user understands what the app is, not on the
// cold launch splash.
export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('timer', {
      name: 'Timer',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    }).catch(() => {});
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

function timeIntervalTrigger(seconds: number): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: Math.max(1, Math.round(seconds)),
    repeats: false,
  };
}

export async function scheduleFocusDoneNotification(seconds: number): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(FOCUS_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_ID,
      content: {
        title: 'Focus session complete',
        body: 'Great work. Time for a break.',
        sound: true,
        data: { type: 'focus' },
      },
      trigger: timeIntervalTrigger(seconds),
    });
  } catch (err) {
    console.warn('[notifications] schedule focus failed:', err);
  }
}

export async function scheduleBreakEndNotification(seconds: number, isLongBreak: boolean): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BREAK_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: BREAK_ID,
      content: {
        title: isLongBreak ? 'Long break over' : 'Break time is up',
        body: 'Ready for your next focus session?',
        sound: true,
        data: { type: 'break' },
      },
      trigger: timeIntervalTrigger(seconds),
    });
  } catch (err) {
    console.warn('[notifications] schedule break failed:', err);
  }
}

export async function cancelFocusNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(FOCUS_ID).catch(() => {});
}

export async function cancelBreakEndNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(BREAK_ID).catch(() => {});
}

export async function cancelAllTimerNotifications(): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(FOCUS_ID).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(BREAK_ID).catch(() => {}),
  ]);
}

// ─── Non-invasive timer wiring ───────────────────────────────────────────────
// Schedules/cancels local notifications by *observing* the timer store — without
// modifying any timer action, so timer-completion logic stays frozen. The OS
// fires the scheduled notification at the right time even when the app is
// backgrounded (the whole point); foreground completion still shows the in-app
// alert as before. Call once at app start; returns an unsubscribe function.
export function subscribeTimerNotifications(): () => void {
  return useTimerStore.subscribe((state, prev) => {
    // A new running segment began (fresh start, resume, or break start):
    // startedAt becomes a new non-null value while running. Per-second ticks do
    // NOT change startedAt, so this won't fire every tick.
    const enteredRunningSegment =
      state.mode === 'pomodoro' &&
      state.status === 'running' &&
      state.startedAt != null &&
      state.startedAt !== prev.startedAt;

    // Left the running state (pause / skip / complete / reset): a still-pending
    // notification is no longer valid.
    const leftRunning = prev.status === 'running' && state.status !== 'running';

    if (leftRunning) {
      cancelAllTimerNotifications();
    }

    if (enteredRunningSegment) {
      // timeLeft is the store's authoritative remaining seconds and is accurate
      // at the moment each running segment begins (set by start/complete/pause).
      const seconds = Math.max(1, state.timeLeft);
      if (state.currentPhase === 'focus') {
        scheduleFocusDoneNotification(seconds);
      } else {
        scheduleBreakEndNotification(seconds, state.currentPhase === 'longBreak');
      }
    }
  });
}
