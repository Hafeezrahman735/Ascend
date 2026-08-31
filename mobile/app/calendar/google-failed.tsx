import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../../components/AppPressable';

/**
 * Where Google sends the browser back to when the connect did not complete —
 * the user declined, closed the sheet, or the token exchange failed.
 *
 * A screen rather than an alert, because an alert fired from a deep-link
 * listener can arrive before anything is mounted to show it, and because
 * "cancelled" deserves a way forward rather than an OK button.
 *
 * Deliberately does not name a cause. The backend redirects here for every
 * failure path it has, and guessing which one happened would be worse than
 * saying plainly that it did not finish.
 */
export default function GoogleFailed() {
  const Colors = useTheme();
  const router = useRouter();

  return (
    <View style={{
      flex: 1, backgroundColor: Colors.bg,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: Space.section, gap: Space.lg,
    }}>
      <Ionicons name="calendar-outline" size={40} color={Colors.subtext} />

      <Text style={{
        color: Colors.textBright, fontSize: 19, textAlign: 'center',
        fontFamily: Font.display,
      }}>
        That didn’t finish
      </Text>

      <Text style={{
        color: Colors.text, fontSize: 14, lineHeight: 21, textAlign: 'center',
      }}>
        Google Calendar wasn’t connected. Nothing changed on your account, and
        you can try again whenever you like.
      </Text>

      <View style={{ flexDirection: 'row', gap: Space.md, marginTop: Space.md }}>
        <AppPressable
          onPress={() => router.replace('/(tabs)/calendar')}
          accessibilityRole="button"
          style={{
            paddingHorizontal: Space.xxl, paddingVertical: Space.md,
            borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
            minHeight: 44, justifyContent: 'center',
          }}
        >
          <Text style={{ color: Colors.text, fontSize: 14, fontWeight: '600' }}>Not now</Text>
        </AppPressable>

        <AppPressable
          onPress={() => router.replace('/settings')}
          accessibilityRole="button"
          style={{
            paddingHorizontal: Space.xxl, paddingVertical: Space.md,
            borderRadius: Radius.md, backgroundColor: Colors.primary,
            minHeight: 44, justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Try again</Text>
        </AppPressable>
      </View>
    </View>
  );
}
