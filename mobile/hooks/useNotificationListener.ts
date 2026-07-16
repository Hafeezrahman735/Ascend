import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { getNotificationType, isExpoGo } from '../services/notifications';

/**
 * Handles what happens when the user taps a timer notification (from the lock
 * screen, background, or a cold launch), plus foreground receipt logging.
 */
export function useNotificationListener(): void {
  useEffect(() => {
    // Expo Go emits no notifications (see services/notifications.ts), so skip the
    // subscriptions — they'd otherwise trigger Expo Go's "not fully supported" warning.
    if (isExpoGo) return;

    // Fired when the user taps a notification — works backgrounded, closed, or
    // on the lock screen.
    const tapSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const type = getNotificationType(response);

      if (type === 'focus_complete' || type === 'break_complete' || type === 'daily_reminder') {
        // Route to the timer tab. On a cold launch the router may not be ready
        // yet — retry once after a tick.
        try {
          router.replace('/(tabs)');
        } catch {
          setTimeout(() => {
            router.replace('/(tabs)');
          }, 100);
        }
      }
    });

    // Fired when a notification arrives while the app is foregrounded; the
    // handler set in configureNotificationHandler shows it.
    const receiveSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const type = notification.request.content.data?.type;
      console.log('[notifications] received in foreground:', type);
    });

    return () => {
      tapSubscription.remove();
      receiveSubscription.remove();
    };
  }, []);
}
