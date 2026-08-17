import '../global.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, Linking } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { loadTokensFromStorage } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { useTaskStore, initTaskStore } from '../stores/taskStore';
import { useTimerStore, initTimerStore } from '../stores/timerStore';
import { useSocialStore } from '../stores/socialStore';
import { useGoalStore } from '../stores/goalStore';
import { useUserSettingsStore } from '../stores/userSettingsStore';
import { useTheme, useIsDark } from '../hooks/useTheme';
import { setupNotifications, configureNotificationHandler } from '../services/notifications';
import { useNotificationListener } from '../hooks/useNotificationListener';
import { useTimerNotifications } from '../hooks/useTimerNotifications';

// Module-level flag prevents React Strict Mode from running bootstrap twice.
let bootstrapRan = false;

// Blocking hydration: everything the first painted screen needs. Settings come
// first so the theme is correct before the UI appears.
async function hydrateForUser(userId: string): Promise<void> {
  await useUserSettingsStore.getState().load(userId);
  await useTaskStore.getState().hydrateTasks(userId);
  await useGoalStore.getState().hydrateGoals(userId);
  await useTimerStore.getState().hydrate(userId);
}

// Non-blocking refresh. Deliberately unawaited — these populate screens the
// user has not reached yet.
function refreshBackgroundData(): void {
  useTaskStore.getState().fetchTasks(true);
  useTaskStore.getState().spawnRecurringTasks();
  // Reset the overall day-streak immediately if a day was missed (mirrors
  // the immediate recurring-streak reset), before fetchProfile reads it.
  useGamificationStore.getState().checkAndResetDayStreak();
  useGoalStore.getState().fetchGoals(true);
  useGamificationStore.getState().fetchProfile();
  useGamificationStore.getState().fetchAchievements();
  useSocialStore.getState().fetchNotifications();
  useSocialStore.getState().fetchStudyGroups();
  useTimerStore.getState().fetchWeekSessions();
}

export default function RootLayout() {
  const Colors = useTheme();
  const isDark = useIsDark();
  const [isReady, setIsReady] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);
  const isNewUser = useAuthStore((s) => s.isNewUser);
  const sessionUnavailable = useAuthStore((s) => s.sessionUnavailable);
  const isNavigating = useRef(false);

  // Subscribes to the timer store and schedules/cancels timer notifications, and
  // routes the user to the timer tab when they tap one. Mounted at the root so
  // they stay alive across tab navigation — never inside the timer screen.
  useTimerNotifications();
  useNotificationListener();

  // Configure how notifications render — must run before any can fire, no
  // permission needed, every launch.
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // Google OAuth returns the browser to ascend://calendar/google-connected (or
  // -failed). Handle it here rather than letting expo-router try to resolve a
  // route that doesn't exist and land on +not-found.
  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url || !url.includes('calendar/google-')) return;
      const connected = url.includes('google-connected');
      import('../stores/calendarStore').then(({ useCalendarStore }) => {
        if (connected) useCalendarStore.getState().fetchGoogleStatus();
      });
      if (connected) {
        router.replace('/(tabs)/calendar');
      } else {
        Alert.alert('Google Calendar', "That connection didn't complete. Please try again.");
      }
    }

    // Cold start: the app may have been launched by the redirect itself.
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  // Auth guard — fires only after Stack is mounted (isReady === true).
  // The isNavigating ref stops the guard from re-firing on intermediate segment changes.
  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    // segments is typed as a 1-tuple but is a plain array at runtime; index 1 is
    // the screen within the group (e.g. '(auth)' / 'onboarding1').
    const currentScreen = (segments as string[])[1] as string | undefined;
    const onOnboarding = !!user && isNewUser && (currentScreen === 'onboarding1' || currentScreen === 'onboarding2');
    // Having no user because the server was unreachable is not the same as being
    // signed out. Redirecting in that case strands the user on a login screen
    // that cannot work either — the retry screen below handles it instead.
    const needsAuth = !user && !inAuthGroup && !sessionUnavailable;
    const needsApp = !!user && inAuthGroup && !onOnboarding;

    if (!needsAuth && !needsApp) return;
    if (isNavigating.current) return;

    isNavigating.current = true;

    if (needsAuth) {
      console.log('[auth guard] no user — redirecting to login');
      router.replace('/(auth)/login');
    } else if (isNewUser) {
      console.log('[auth guard] new user — redirecting to onboarding');
      router.replace('/(auth)/onboarding1');
    } else {
      console.log('[auth guard] user exists in auth group — redirecting to tabs');
      router.replace('/(tabs)');
    }

    setTimeout(() => { isNavigating.current = false; }, 500);
  }, [isReady, user, isNewUser, segments]);

  // Bootstrap — loads data only, never touches the router.
  useEffect(() => {
    async function bootstrap() {
      if (bootstrapRan) return;
      bootstrapRan = true;

      // Wire up cross-store subscriptions now that all modules are loaded.
      initTaskStore();
      initTimerStore();

      try {
        // loadTokensFromStorage seeds the in-memory accessToken used by apiRequest.
        const { accessToken: token } = await loadTokensFromStorage();
        console.log('[bootstrap] token found:', !!token);

        if (token) {
          try {
            await useAuthStore.getState().loadUser();
          } catch (err: any) {
            console.log('[bootstrap] loadUser failed:', err?.message);
          }

          const authedUser = useAuthStore.getState().user;
          console.log('[bootstrap] user:', authedUser?.id, authedUser?.username);

          if (authedUser) {
            await hydrateForUser(authedUser.id);
          } else {
            await useTimerStore.getState().hydrate('');
          }
        }

        // Always set ready — the auth guard handles all navigation from here.
        setIsReady(true);

        // Non-blocking background refresh after Stack mounts.
        if (useAuthStore.getState().user) {
          refreshBackgroundData();
        }

      } catch (err) {
        console.error('[bootstrap] unexpected error:', err);
        setIsReady(true);
      }
    }

    bootstrap();
  }, []);

  // Request notification permission once a user is logged in — not on the cold
  // launch splash. iOS only shows the system prompt once, so timing matters.
  useEffect(() => {
    if (user) {
      setupNotifications();
    }
  }, [user]);

  // Retry after the server was unreachable at launch. Runs the same hydration
  // bootstrap does, so a successful retry lands on a fully populated app rather
  // than an empty one.
  const retryConnection = useCallback(async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await useAuthStore.getState().loadUser();
      const authedUser = useAuthStore.getState().user;
      if (authedUser) {
        await hydrateForUser(authedUser.id);
        refreshBackgroundData();
      }
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying]);

  if (!isReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View
          style={{
            flex: 1,
            backgroundColor: Colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      </GestureHandlerRootView>
    );
  }

  // We hold tokens but could not reach the server to validate them. The login
  // screen would fail for the same reason, so offer a retry rather than a
  // misleading "signed out".
  if (sessionUnavailable && !user) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View
          style={{
            flex: 1,
            backgroundColor: Colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '600', textAlign: 'center' }}>
            Can&apos;t reach the server
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 14, textAlign: 'center', marginTop: 8 }}>
            You&apos;re still signed in. This usually clears up in a moment.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isRetrying}
            onPress={retryConnection}
            style={{
              marginTop: 24,
              minHeight: 48,
              justifyContent: 'center',
              paddingHorizontal: 28,
              borderRadius: 12,
              backgroundColor: Colors.primary,
              opacity: isRetrying ? 0.6 : 1,
            }}
          >
            <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>
              {isRetrying ? 'Retrying…' : 'Try again'}
            </Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="achievement/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="friend/[id]" />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="groups" />
      </Stack>
    </GestureHandlerRootView>
  );
}
