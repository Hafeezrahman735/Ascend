import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { PRIVACY_POLICY_URL } from '../../constants/legal';
import { openExternal } from '../../lib/openExternal';

/**
 * "I have read and agree", with a real checkbox.
 *
 * Lives at the BOTTOM of the terms, inside the same scroll view, and nowhere
 * else. It used to sit on the signup form beside a link, which meant the common
 * path was to tick it without ever opening the document — and a consent record
 * produced that way is worth very little. Reaching this checkbox now requires
 * scrolling past the clauses it refers to.
 *
 * The Privacy Policy stays a link because it is referenced by the Terms rather
 * than agreed to here, and it is hosted rather than bundled.
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

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Pressable
        onPress={() => onToggle(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I have read and agree to the Terms of Service"
        // The box is 22pt but the target is 44 — the iOS minimum. Without the
        // hitSlop this is one of the easiest controls in the app to miss, and
        // missing it looks like the button below being broken.
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

      <Text style={{ color: Colors.text, fontSize: 13, lineHeight: 19, flex: 1 }}>
        I have read and agree to the Terms of Service above, and to the{' '}
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
