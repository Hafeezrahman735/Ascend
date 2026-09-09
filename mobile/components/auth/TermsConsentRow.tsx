import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { PRIVACY_POLICY_URL } from '../../constants/legal';
import { openExternal } from '../../lib/openExternal';

/**
 * "I agree to the Terms of Service and Privacy Policy", with a real checkbox.
 *
 * Shared by the signup form and the terms gate so the wording a user consents to
 * is identical in both places — which matters when the thing being recorded is
 * consent.
 *
 * The Terms open an in-app screen; the Privacy Policy opens the hosted page.
 * That asymmetry is intentional rather than an oversight: the terms are what is
 * being agreed to here and must be readable offline and without leaving the app,
 * whereas the privacy policy is referenced, already lives on Notion, and is
 * linked the same way from Settings.
 *
 * React Native has no checkbox primitive, so this is a Pressable that reports
 * itself as one. accessibilityRole and accessibilityState are what make it a
 * checkbox to VoiceOver rather than an unlabelled button.
 */
export function TermsConsentRow({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const Colors = useTheme();
  const router = useRouter();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Pressable
        onPress={() => onToggle(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        // The box is 22pt but the target is 44 — the iOS minimum. Without the
        // hitSlop this is one of the easiest controls in the app to miss, and
        // missing it looks like the signup button being broken.
        hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
        style={{ paddingTop: 1 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: checked ? Colors.primary : Colors.border,
            backgroundColor: checked ? Colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked && <Ionicons name="checkmark" size={15} color="#fff" />}
        </View>
      </Pressable>

      {/* The sentence is one Text so the links wrap inline with the words they
          belong to, rather than sitting in a separate row that reads as
          navigation. */}
      <Text style={{ color: Colors.subtext, fontSize: 13, lineHeight: 19, flex: 1 }}>
        I agree to the{' '}
        <Text
          onPress={() => router.push('/(auth)/terms')}
          accessibilityRole="link"
          style={{ color: Colors.primarySoft, fontWeight: '600' }}
        >
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          onPress={() => openExternal(PRIVACY_POLICY_URL)}
          accessibilityRole="link"
          style={{ color: Colors.primarySoft, fontWeight: '600' }}
        >
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}
