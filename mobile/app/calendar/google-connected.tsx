import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import { useCalendarStore } from '../../stores/calendarStore';

/**
 * Where Google sends the browser back to after a successful connect.
 *
 * The backend redirects to `ascend://calendar/google-connected` (see
 * backend/src/modules/calendar/routes.ts). This file exists so that URL
 * resolves to something: without it expo-router had no matching route and
 * showed its "Unmatched Route" screen, which is what the user actually saw
 * after authorising — the connection had worked, but the app said the page
 * could not be found.
 *
 * There was a listener in app/_layout.tsx trying to intercept the URL before
 * the router could get to it. That is gone: it raced the router's own
 * navigation and, being a workaround for a missing route, stopped being needed
 * the moment the route existed.
 *
 * The screen refreshes connection state and steps aside. It is a landing pad,
 * not a destination, so it never appears in the back stack.
 */
export default function GoogleConnected() {
  const Colors = useTheme();
  const router = useRouter();
  const fetchGoogleStatus = useCalendarStore((s) => s.fetchGoogleStatus);

  useEffect(() => {
    let cancelled = false;
    // Refresh first, so the Calendar tab renders as connected on arrival
    // rather than flashing the "Connect" state and correcting itself.
    fetchGoogleStatus()
      .catch(() => {})
      .finally(() => {
        // replace, not push: returning from an OAuth redirect should not leave
        // a screen behind that the back gesture can land on.
        if (!cancelled) router.replace('/(tabs)/calendar');
      });
    return () => { cancelled = true; };
  }, [fetchGoogleStatus, router]);

  return (
    <View style={{
      flex: 1, backgroundColor: Colors.bg,
      alignItems: 'center', justifyContent: 'center', gap: Space.lg,
    }}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={{ color: Colors.textBright, fontSize: 15, fontFamily: Font.body }}>
        Finishing up with Google…
      </Text>
    </View>
  );
}
