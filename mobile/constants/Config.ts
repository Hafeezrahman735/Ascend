// =============================================================================
// App Configuration
// =============================================================================
// Backend URLs come from EXPO_PUBLIC_* environment variables and nowhere else.
//
// This file used to carry fallbacks — a hardcoded LAN IP for __DEV__ and the
// production Railway URL otherwise:
//
//   API_URL: process.env.EXPO_PUBLIC_API_URL || (isDev ? DEV_API_URL : PROD_API_URL)
//
// That is a trap rather than a safety net. EAS Build never receives .env files
// (they are git-ignored, so they are not in the uploaded archive), which meant a
// cloud build silently took the fallback: a `development` build talked to a
// stale LAN IP over cleartext, and — far worse — a `preview` build, where
// __DEV__ is false, silently read and wrote PRODUCTION data. Every network call
// in the app flows through here (services/api.ts, services/socket.ts), so the
// blast radius was the whole app, and the symptom was a timeout or wrong data
// rather than anything naming the real cause.
//
// Values are supplied by:
//   local dev  — mobile/.env and mobile/.env.local
//   EAS build  — the EAS environment named by each eas.json build profile
//   EAS update — `eas update --environment <env>` (SDK 55+ ignores .env files)
// =============================================================================

import { Platform } from 'react-native';

/**
 * Fails immediately on a missing public URL, and says how to fix it.
 *
 * Throwing at module load is deliberate. A build with no backend URL is not
 * shippable, so surfacing it as a launch-time crash during testing is strictly
 * better than routing traffic somewhere unintended and finding out later.
 *
 * The value is passed IN rather than read via `process.env[name]`. Expo inlines
 * EXPO_PUBLIC_* by statically substituting the literal `process.env.EXPO_PUBLIC_X`
 * member expression at build time; a dynamic lookup is never substituted and
 * would be undefined in every build, so this would throw unconditionally.
 */
function requireUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[config] ${name} is not set.\n` +
      `Local dev: add it to mobile/.env.\n` +
      `EAS build/update: add it to the matching EAS environment ` +
      `(\`eas env:create --environment <development|preview|production> --name ${name} ...\`) ` +
      `— .env files are never uploaded to EAS.`,
    );
  }
  return value;
}

export const Config = {
  API_URL: requireUrl('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL),
  WS_URL: requireUrl('EXPO_PUBLIC_WS_URL', process.env.EXPO_PUBLIC_WS_URL),
  SOCIAL_WS_URL: requireUrl('EXPO_PUBLIC_SOCIAL_WS_URL', process.env.EXPO_PUBLIC_SOCIAL_WS_URL),

  // Timer defaults
  DEFAULT_FOCUS_MINUTES: 25,
  DEFAULT_SHORT_BREAK_MINUTES: 5,
  DEFAULT_LONG_BREAK_MINUTES: 15,
  POMODOROS_BEFORE_LONG_BREAK: 4,

  // Platform
  IS_IOS: Platform.OS === 'ios',
  IS_ANDROID: Platform.OS === 'android',
};
