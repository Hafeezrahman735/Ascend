import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../hooks/useTheme';

/**
 * Field, stepper and card styles shared by Today's sheets and forms, and by
 * the goal form and tag sheet extracted from it.
 */
export function getStyles(c: ThemeColors) {
  return StyleSheet.create({
    input: { backgroundColor: c.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.textBright, marginBottom: 16, fontSize: 14, borderWidth: 1, borderColor: c.border },
    fieldLabel: { color: c.subtext, fontSize: 11, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
    stepper: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 0.5, borderColor: c.border, padding: 16 },
  });
}
