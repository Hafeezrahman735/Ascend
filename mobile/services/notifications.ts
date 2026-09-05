import * as Notifications from 'expo-notifications';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform, AppState } from 'react-native';
import { api } from './api';
import { log } from '../lib/log';
import type { TaskGoal } from '../types';
import { goalRemindersToSchedule, isGoalReminderId } from '../lib/goalReminders';

// Expo Go (SDK 53+) no longer supports push notifications and warns on local
// ones, so we disable all notification behavior there. Dev builds (expo-dev-client)
// and production report a non-storeClient environment and keep full behavior.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// The sound file bundled in assets/sounds/ via the expo-notifications plugin.
// Must match the filename exactly — no path prefix (iOS plays bundled sounds by name).
const ALARM_SOUND = 'timer_complete.wav';

// Android channel id — created in setupAndroidChannels, referenced in content.
const ANDROID_CHANNEL = 'ascend-timer';

// EAS project id — required for getExpoPushTokenAsync. Mirrors app.json
// (extra.eas.projectId); it's a public identifier.
const EAS_PROJECT_ID = 'e891b005-10df-49b0-9e5a-2eae20e42b11';

// Stable identifiers for each notification type, so we can cancel/replace
// a specific pending notification without touching the other.
const NOTIFICATION_IDS = {
  FOCUS_DONE: 'ascend-focus-complete',
  BREAK_DONE: 'ascend-break-complete',
  DAILY_REMINDER: 'ascend-daily-reminder',
} as const;

/**
 * Configure how notifications appear when the app is in the foreground.
 * Call once at app startup — before any notification can fire. No permission needed.
 */
export function configureNotificationHandler(): void {
  if (isExpoGo) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      // Foreground-aware: when the app is active, the timer screen already shows
      // an on-screen Alert, so suppress the banner/sound/list entry to avoid a
      // duplicate. When backgrounded/closed the OS presents the notification
      // directly (this handler isn't consulted), so the alarm still fires.
      const isForeground = AppState.currentState === 'active';
      return {
        shouldShowAlert: !isForeground,
        shouldPlaySound: !isForeground,
        shouldSetBadge: false,
        shouldShowBanner: !isForeground,
        shouldShowList: !isForeground,
      };
    },
  });
}

/**
 * Request notification permission. Call the first time the user starts a focus
 * session (or just after login) — iOS only shows the system dialog once.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isExpoGo) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
      allowCriticalAlerts: false,
    },
  });

  return status === 'granted';
}

/**
 * Create the Android notification channel. No-op on iOS.
 */
export async function setupAndroidChannels(): Promise<void> {
  if (isExpoGo) return;
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Trace Timer Alarm',
    importance: Notifications.AndroidImportance.MAX,
    sound: ALARM_SOUND,
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  }).catch(() => {});
}

/**
 * Register this device's Expo push token with the backend so the server can
 * deliver push notifications (friend activity, achievements, social posts…).
 * Requires permission to have been granted. No-op on failure.
 */
export async function registerPushToken(): Promise<void> {
  if (isExpoGo) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
    if (!token) return;
    await api.post('/notifications/push-token', { pushToken: token });
    log('[notifications] push token registered');
  } catch (err) {
    console.warn('[notifications] push token registration failed:', err);
  }
}

/**
 * Full setup — request permission, (on Android) create channels, and register
 * the push token. Safe to call after login; iOS only prompts once.
 */
export async function setupNotifications(): Promise<boolean> {
  const granted = await requestNotificationPermission();
  if (granted) {
    await setupAndroidChannels();
    await registerPushToken();
  }
  return granted;
}

/**
 * Schedule (or replace) the repeating daily reminder at the given local time.
 * Uses a DAILY trigger so it fires every day until cancelled.
 */
export async function scheduleDailyReminder(hour: number, minute: number): Promise<void> {
  if (isExpoGo) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.DAILY_REMINDER).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_IDS.DAILY_REMINDER,
      content: {
        // The daily nudge is the one place the app states its whole premise:
        // no one else is scheduling this for you.
        title: 'No one else is scheduling this',
        body: 'You decide what matters today. Pick one thing and start it.',
        data: { type: 'daily_reminder' },
        ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Math.max(0, Math.min(23, Math.floor(hour))),
        minute: Math.max(0, Math.min(59, Math.floor(minute))),
      },
    });
    log('[notifications] daily reminder scheduled for', hour, ':', minute);
  } catch (err) {
    console.warn('[notifications] schedule daily reminder failed:', err);
  }
}

/** Cancel the repeating daily reminder. */
export async function cancelDailyReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.DAILY_REMINDER).catch(() => {});
}

/**
 * Apply the daily-reminder setting: schedule when enabled, cancel when off.
 * Call on settings load and whenever the toggle / time changes.
 */
export async function applyDailyReminder(
  enabled: boolean,
  hour: number,
  minute: number,
): Promise<void> {
  if (enabled) {
    await scheduleDailyReminder(hour, minute);
  } else {
    await cancelDailyReminder();
  }
}

function timeIntervalTrigger(seconds: number): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: Math.max(1, Math.round(seconds)),
    repeats: false,
  };
}

/**
 * Schedule a notification for when the focus session ends.
 *
 * @param remainingSeconds - seconds LEFT in the current session (the timer store's
 *   `timeLeft`, which is accurate after pauses/resumes). NOT the total duration.
 */
export async function scheduleFocusDoneNotification(remainingSeconds: number): Promise<void> {
  if (isExpoGo) return;
  const seconds = Math.max(1, Math.round(remainingSeconds));
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.FOCUS_DONE).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_IDS.FOCUS_DONE,
      content: {
        title: 'Session done',
        body: 'Take the break. It is part of the work.',
        sound: ALARM_SOUND,
        data: { type: 'focus_complete' },
        ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL }),
      },
      trigger: timeIntervalTrigger(seconds),
    });
    log('[notifications] focus complete scheduled in', seconds, 'seconds');
  } catch (err) {
    console.warn('[notifications] schedule focus failed:', err);
  }
}

/**
 * Schedule a notification for when the break ends.
 *
 * @param remainingSeconds - seconds LEFT in the break (the store's `timeLeft`).
 * @param isLongBreak - affects the notification text.
 */
export async function scheduleBreakEndNotification(
  remainingSeconds: number,
  isLongBreak: boolean,
): Promise<void> {
  if (isExpoGo) return;
  const seconds = Math.max(1, Math.round(remainingSeconds));
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.BREAK_DONE).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_IDS.BREAK_DONE,
      content: {
        title: isLongBreak ? 'Long break over' : 'Break time is up',
        body: 'Break is over. What is next?',
        sound: ALARM_SOUND,
        data: { type: 'break_complete' },
        ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL }),
      },
      trigger: timeIntervalTrigger(seconds),
    });
    log(
      '[notifications] break end scheduled in',
      seconds,
      'seconds (',
      isLongBreak ? 'long' : 'short',
      ')',
    );
  } catch (err) {
    console.warn('[notifications] schedule break failed:', err);
  }
}

/** Cancel the pending focus-done notification (on pause / reset). */
export async function cancelFocusNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.FOCUS_DONE).catch(() => {});
}

/** Cancel the pending break-end notification (on skip / reset). */
export async function cancelBreakNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.BREAK_DONE).catch(() => {});
}

/** Cancel all timer notifications (on reset, or stale settings change). */
export async function cancelAllTimerNotifications(): Promise<void> {
  await Promise.allSettled([
    Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.FOCUS_DONE),
    Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.BREAK_DONE),
  ]);
}

/**
 * Bring the pending goal reminders in line with the goals as they are now.
 *
 * Every other notification in this app uses one of three FIXED identifiers and
 * a cancel-then-schedule pair. Goal reminders are DYNAMIC — one per goal, an
 * unknown number of them — so keeping them correct means first asking the OS
 * what is currently pending. `getAllScheduledNotificationsAsync` is the only
 * way to know that, and this is its first use in the codebase.
 *
 * Reconciles rather than appends: cancel every goal reminder we own, then
 * schedule the wanted set. Simple and idempotent, which matters because this
 * runs on every goal change and every hydrate. The cost is bounded by
 * MAX_GOAL_REMINDERS, and pending notifications are cheap to replace.
 *
 * Only identifiers matching the goal prefix are touched. The daily reminder and
 * the two timer alarms are scheduled by the same OS queue and must survive.
 *
 * Reminders are local, so they fire only on the device that scheduled them. A
 * goal created on another device gets one here the next time this device
 * hydrates — that is the accepted cost of having no server-side scheduler.
 */
export async function syncGoalReminders(goals: TaskGoal[]): Promise<void> {
  if (isExpoGo) return;
  try {
    const wanted = goalRemindersToSchedule(goals, new Date());

    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.allSettled(
      pending
        .filter((n) => isGoalReminderId(n.identifier))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );

    for (const r of wanted) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: {
          title: r.title,
          body: r.body,
          data: { type: 'goal_due', goalId: r.goalId },
          ...(Platform.OS === 'android' && { channelId: ANDROID_CHANNEL }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.fireAt,
        },
      });
    }

    log('[notifications] goal reminders synced:', wanted.length);
  } catch (err) {
    // Never fatal. A missing reminder is a worse day, not a broken app, and
    // this runs off the back of every goal write.
    console.warn('[notifications] goal reminder sync failed:', err);
  }
}

/** Drop every goal reminder — on logout, or when goals are cleared. */
export async function cancelGoalReminders(): Promise<void> {
  if (isExpoGo) return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.allSettled(
      pending
        .filter((n) => isGoalReminderId(n.identifier))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch (err) {
    console.warn('[notifications] goal reminder cancel failed:', err);
  }
}

/**
 * Extract the notification type from a tap response, for navigation routing.
 */
export function getNotificationType(
  response: Notifications.NotificationResponse,
): 'focus_complete' | 'break_complete' | 'daily_reminder' | 'goal_due' | null {
  const data = response.notification.request.content.data;
  if (!data) return null;
  return (data.type as 'focus_complete' | 'break_complete' | 'daily_reminder' | 'goal_due') ?? null;
}
