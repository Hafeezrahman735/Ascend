import { useColorScheme } from 'react-native';
import { darkColors, lightColors } from '../constants/Colors';
import { darkSocialTheme, lightSocialTheme } from '../constants/socialTheme';
import { useUserSettingsStore } from '../stores/userSettingsStore';

export type ThemeColors = typeof darkColors & typeof darkSocialTheme;

/**
 * Three states: 'dark' (Deep Focus Midnight), 'light' (Warm Dawn), and 'system'
 * (follow the OS).
 *
 * Anything unrecognised resolves to dark, so a stored value written by an older
 * build can never break the UI.
 */
function useIsLight(): boolean {
  const stored = useUserSettingsStore((s) => s.theme);
  const system = useColorScheme(); // 'light' | 'dark' | null

  if (stored === 'system') return system === 'light';
  return stored === 'light';
}

export function useTheme(): ThemeColors {
  const isLight = useIsLight();

  const colors = isLight ? lightColors : darkColors;
  const social = isLight ? lightSocialTheme : darkSocialTheme;

  return { ...colors, ...social };
}

export function useIsDark(): boolean {
  return !useIsLight();
}
