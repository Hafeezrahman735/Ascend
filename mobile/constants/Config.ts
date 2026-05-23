// =============================================================================
// App Configuration
// =============================================================================
// IMPORTANT: Find your local machine IP address:
//   - Mac:  System Settings > Network, or run `ifconfig | grep inet`
//   - Win:  Run `ipconfig` in Command Prompt, look for "IPv4 Address"
// Replace YOUR_LOCAL_IP below with your actual IP (e.g. 192.168.1.100)
// =============================================================================

import { Platform } from 'react-native';

const DEV_API_URL = 'http://192.168.1.100:3001';
const DEV_WS_URL = 'http://192.168.1.100:3001';
const DEV_SOCIAL_WS_URL = 'http://192.168.1.100:3001';

// Production URLs — replace with your deployed backend URLs before release
const PROD_API_URL = 'https://api.pomodoro.app';
const PROD_WS_URL = 'https://ws.pomodoro.app';
const PROD_SOCIAL_WS_URL = 'https://social-ws.pomodoro.app';

// Auto-switch between dev and prod based on __DEV__ (Expo global)
// __DEV__ is true in development builds and Expo Go, false in production builds
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export const Config = {
  API_URL: process.env.EXPO_PUBLIC_API_URL || (isDev ? DEV_API_URL : PROD_API_URL),
  WS_URL: process.env.EXPO_PUBLIC_WS_URL || (isDev ? DEV_WS_URL : PROD_WS_URL),
  SOCIAL_WS_URL: process.env.EXPO_PUBLIC_SOCIAL_WS_URL || (isDev ? DEV_SOCIAL_WS_URL : PROD_SOCIAL_WS_URL),

  // TODO: Replace with your Expo project ID from https://expo.dev
  // After setting up your Expo account at expo.dev, create a project and paste its ID here
  EXPO_PROJECT_ID: process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || 'YOUR_EXPO_PROJECT_ID',

  // Timer defaults
  DEFAULT_FOCUS_MINUTES: 25,
  DEFAULT_SHORT_BREAK_MINUTES: 5,
  DEFAULT_LONG_BREAK_MINUTES: 15,
  POMODOROS_BEFORE_LONG_BREAK: 4,

  // Platform
  IS_IOS: Platform.OS === 'ios',
  IS_ANDROID: Platform.OS === 'android',
};
