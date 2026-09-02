import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
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
import { useHeroCardStore } from '../stores/heroCardStore';
import { useTheme, useIsDark } from '../hooks/useTheme';
import UnlockOverlay from '../components/achievements/UnlockOverlay';
import { setupNotifications, configureNotificationHandler } from '../services/notifications';
import { useNotificationListener } from '../hooks/useNotificationListener';
import { useTimerNotifications } from '../hooks/useTimerNotifications';
import { useTimerLiveActivity } from '../hooks/useTimerLiveActivity';
import { log } from '../lib/log';

// Module-level flag prevents React Strict Mode from running bootstrap twice.
let bootstrapRan = false;

// Blocking hydration: everything the first painted screen needs. Settings come
// first so the theme is correct before the UI appears.
async function hydrateForUser(userId: string): Promise<void> {
  await useUserSettingsStore.getState().load(userId);
  await useTaskStore.getState().hydrateTasks(userId);
  await useGoalStore.getState().hydrateGoals(userId);
  await useTimerStore.getState().hydrate(userId);
  // Before the first paint of the Tasks tab: without the baseline the hero
  // rotation thinks it has never shown overdue work, and the urgency card leads
  // again on every cold launch — the behaviour the cap exists to prevent.
  await useHeroCardStore.getState().load(userId);
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

  // No useFonts here on purpose. The four families are compiled into the binary
  // by the expo-font config plugin (see app.json and assets/fonts), so they are
  // registered before any JavaScript runs and there is nothing to await. That
  // removes a whole class of startup failure: the previous runtime load fetched
  // 1.8 MB across ten requests and gated the entire app on the result, so a
  // download that stalled left the app on a spinner forever.
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

  // Mirrors the running session onto the Lock Screen and Dynamic Island. Root
  // level for the same reason as the notifications above: the card has to
  // outlive the timer screen, not be torn down when the user changes tab.
  useTimerLiveActivity();

  // Configure how notifications render — must run before any can fire, no
  // permission needed, every launch.
  useEffect(() => {
    configureNotificationHandler();
  }, []);

  // The Google OAuth return used to be intercepted here, because
  // ascend://calendar/google-connected matched no route and expo-router landed
  // on its Unmatched Route screen. There are real routes for it now
  // (app/calendar/google-connected.tsx and google-failed.tsx), so the router
  // resolves the deep link itself — including on cold start — and this
  // listener, which raced that navigation, is gone.

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
    // The password-reset screens must open even for someone already signed in.
    // The link arrives by email and gets tapped on whatever device is to hand,
    // which is often one that still holds a session — and without this the
    // guard sees a user inside (auth) and bounces them to the tabs, so the
    // emailed link simply appears broken.
    const onPasswordReset = currentScreen === 'reset-password' || currentScreen === 'forgot-password';
    const needsAuth = !user && !inAuthGroup && !sessionUnavailable;
    const needsApp = !!user && inAuthGroup && !onOnboarding && !onPasswordReset;

    if (!needsAuth && !needsApp) return;
    if (isNavigating.current) return;

    isNavigating.current = true;

    if (needsAuth) {
      log('[auth guard] no user — redirecting to login');
      router.replace('/(auth)/login');
    } else if (isNewUser) {
      log('[auth guard] new user — redirecting to onboarding');
      router.replace('/(auth)/onboarding1');
    } else {
      log('[auth guard] user exists in auth group — redirecting to tabs');
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
        log('[bootstrap] token found:', !!token);

        if (token) {
          try {
            await useAuthStore.getState().loadUser();
          } catch (err: any) {
            log('[bootstrap] loadUser failed:', err?.message);
          }

          const authedUser = useAuthStore.getState().user;
          log('[bootstrap] user:', authedUser?.id, authedUser?.username);

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
        <Stack.Screen name="achievements" />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="groups" />
        <Stack.Screen name="group/[id]" />
        <Stack.Screen name="calendar/google-connected" />
        <Stack.Screen name="calendar/google-failed" />
      </Stack>
      {/* App-level so an unlock is celebrated wherever the user is — sessions
          complete on the Timer tab, not the profile. */}
      <UnlockOverlay />
    </GestureHandlerRootView>
  );
}
