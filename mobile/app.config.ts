// =============================================================================
// Expo App Config — extends app.json with dynamic values
// =============================================================================
// TODO: Replace YOUR_EXPO_PROJECT_ID with your actual Expo project ID
// 1. Go to https://expo.dev and sign up / log in
// 2. Create a new project
// 3. Copy the project ID and paste it below
// =============================================================================

import { ExpoConfig, ConfigContext } from 'expo/config';

const EXPO_PROJECT_ID = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || 'YOUR_EXPO_PROJECT_ID';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Pomodoro',
  slug: 'pomodoro',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'pomodoro',
  userInterfaceStyle: 'automatic',
  splash: {
    backgroundColor: '#0F0F0F',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.yourname.pomodoroapp',
    infoPlist: {
      UIBackgroundModes: ['remote-notification', 'fetch'],
      NSUserNotificationUsageDescription:
        'Pomodoro sends you reminders when your focus session ends and when your friends start focusing.',
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#0F0F0F',
    },
    package: 'com.yourname.pomodoroapp',
    permissions: ['RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'POST_NOTIFICATIONS'],
  },
  plugins: [
    'expo-router',
    '@react-native-community/datetimepicker',
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#FF6B6B',
      },
    ],
  ],
  extra: {
    eas: {
      projectId: EXPO_PROJECT_ID,
    },
  },
});
