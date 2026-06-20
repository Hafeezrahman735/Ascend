import '../global.css';
import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import * as Notifications from 'expo-notifications';
import { setupNotifications, subscribeTimerNotifications } from '../services/notifications';

// Module-level flag prevents React Strict Mode from running bootstrap twice.
let bootstrapRan = false;

export default function RootLayout() {
  const Colors = useTheme();
  const isDark = useIsDark();
  const [isReady, setIsReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);
  const isNewUser = useAuthStore((s) => s.isNewUser);
  const isNavigating = useRef(false);

  // Auth guard — fires only after Stack is mounted (isReady === true).
  // The isNavigating ref stops the guard from re-firing on intermediate segment changes.
  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';
    const currentScreen = segments[1] as string | undefined;
    const onOnboarding = !!user && isNewUser && (currentScreen === 'onboarding1' || currentScreen === 'onboarding2');
    const needsAuth = !user && !inAuthGroup;
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
            // Load settings first so the theme is correct before the UI paints.
            await useUserSettingsStore.getState().load(authedUser.id);
            await useTaskStore.getState().hydrateTasks(authedUser.id);
            await useGoalStore.getState().hydrateGoals(authedUser.id);
            await useTimerStore.getState().hydrate(authedUser.id);
          } else {
            await useTimerStore.getState().hydrate('');
          }
        }

        // Always set ready — the auth guard handles all navigation from here.
        setIsReady(true);

        // Non-blocking background refresh after Stack mounts.
        if (useAuthStore.getState().user) {
          useTaskStore.getState().fetchTasks(true);
          useGoalStore.getState().fetchGoals(true);
          useGamificationStore.getState().fetchProfile();
          useGamificationStore.getState().fetchAchievements();
          useSocialStore.getState().fetchNotifications();
          useSocialStore.getState().fetchStudyGroups();
          useTimerStore.getState().fetchWeekSessions();
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

  // Local timer notifications: a store observer schedules/cancels them (no timer
  // logic is modified), plus a listener that routes the user to the timer when
  // they tap a delivered notification.
  useEffect(() => {
    const unsubscribe = subscribeTimerNotifications();
    const responseSub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/(tabs)');
    });
    return () => {
      unsubscribe();
      responseSub.remove();
    };
  }, []);

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
