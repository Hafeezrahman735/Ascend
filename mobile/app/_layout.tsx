import '../global.css';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { loadTokensFromStorage } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { useTaskStore } from '../stores/taskStore';
import { useTimerStore } from '../stores/timerStore';
import { Colors } from '../constants/Colors';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const { accessToken } = await loadTokensFromStorage();

      if (!accessToken) {
        useTimerStore.getState().hydrate();
        setIsReady(true);
        return;
      }

      await Promise.allSettled([
        useAuthStore.getState().loadUser(),
        useGamificationStore.getState().fetchProfile(),
        useTaskStore.getState().fetchTasks(),
      ]);

      useTimerStore.getState().hydrate();
      setIsReady(true);
    }

    bootstrap();
  }, []);

  if (!isReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View
          style={{
            flex: 1, backgroundColor: Colors.bg,
            alignItems: 'center', justifyContent: 'center',
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
      </Stack>
    </GestureHandlerRootView>
  );
}
