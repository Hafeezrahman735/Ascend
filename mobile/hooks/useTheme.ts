import { darkColors, lightColors } from '../constants/Colors';
import { darkSocialTheme, lightSocialTheme } from '../constants/socialTheme';
import { useUserSettingsStore } from '../stores/userSettingsStore';

export type ThemeColors = typeof darkColors & typeof darkSocialTheme;

// Two states only — 'dark' (Deep Focus Midnight, default) and 'light' (Warm Dawn).
// No system following. Anything that isn't 'light' resolves to dark.
export function useTheme(): ThemeColors {
  const stored = useUserSettingsStore((s) => s.theme);
  const isLight = stored === 'light';

  const colors = isLight ? lightColors : darkColors;
  const social = isLight ? lightSocialTheme : darkSocialTheme;

  return { ...colors, ...social };
}

export function useIsDark(): boolean {
  const stored = useUserSettingsStore((s) => s.theme);
  return stored !== 'light';
}
