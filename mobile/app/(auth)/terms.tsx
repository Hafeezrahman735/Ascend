import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { TermsDocument } from '../../components/auth/TermsDocument';
import { TermsConsentRow } from '../../components/auth/TermsConsentRow';
import { AUTH_CONTENT_MAX_WIDTH } from '../../components/auth/authLayout';
import { useTermsConsentStore } from '../../stores/termsConsentStore';

/**
 * Read and accept the Terms, for someone creating an account.
 *
 * The whole document on one scrollable page, with the checkbox at the foot of
 * it. That ordering is the design: the signup form previously carried a
 * checkbox next to a link, so the path of least resistance was to tick it
 * without ever opening the terms. Consent collected that way is consent in name
 * only, and App Store Guideline 1.2 asks for the agreement to be PRESENTED, not
 * merely available. Now the only way to reach the checkbox is to scroll past
 * the clauses it refers to.
 *
 * Lives in the (auth) group because it must be reachable before anyone has an
 * account — the root guard sends any signed-out user outside this group back to
 * login.
 *
 * The answer travels back to the form through termsConsentStore, because router
 * params cannot carry a value backwards. Leaving without agreeing clears it, so
 * backing out is never mistaken for consent.
 */
export default function TermsScreen() {
  const Colors = useTheme();
  const router = useRouter();

  const storeAccepted = useTermsConsentStore((s) => s.accepted);
  const setAccepted = useTermsConsentStore((s) => s.setAccepted);
  const [checked, setChecked] = useState(storeAccepted);

  function handleAgree() {
    setAccepted(true);
    router.back();
  }

  function handleBack() {
    // Backing out is not consent. If they had previously agreed and have now
    // returned and unticked, that must stick too.
    setAccepted(false);
    router.back();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingBottom: 40,
          width: '100%',
          maxWidth: AUTH_CONTENT_MAX_WIDTH,
          alignSelf: 'center',
        }}
      >
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back without agreeing"
          hitSlop={12}
          style={{ marginBottom: 20, alignSelf: 'flex-start' }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>

        <TermsDocument />

        {/* The consent block closes the document, inside the same scroll. */}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: Colors.border,
            paddingTop: 20,
            marginTop: 4,
          }}
        >
          <TermsConsentRow checked={checked} onToggle={setChecked} />

          <TouchableOpacity
            onPress={handleAgree}
            disabled={!checked}
            accessibilityRole="button"
            accessibilityState={{ disabled: !checked }}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 14,
              paddingVertical: 15,
              alignItems: 'center',
              marginTop: 20,
              opacity: checked ? 1 : 0.5,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              Agree and continue
            </Text>
          </TouchableOpacity>

          {!checked && (
            <Text
              style={{ color: Colors.subtext, fontSize: 12, textAlign: 'center', marginTop: 10 }}
            >
              Tick the box above to continue
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
