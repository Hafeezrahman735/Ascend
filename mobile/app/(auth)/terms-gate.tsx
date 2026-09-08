import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';
import { TermsConsentRow } from '../../components/auth/TermsConsentRow';
import { AUTH_CONTENT_MAX_WIDTH } from '../../components/auth/authLayout';

/**
 * One-time Terms acceptance for accounts that never gave it.
 *
 * This is the LOGIN half of App Store Guideline 1.2's "before registering or
 * logging in". Signup records consent inline, but every account that existed
 * before the terms did has termsAcceptedAt null — and a returning user never
 * touches the signup form again, they bootstrap straight through /auth/me. The
 * auth guard in app/_layout.tsx routes those accounts here before the app.
 *
 * ─── Why this screen can never trap anyone ──────────────────────────────────
 *
 * It is the only thing standing between a signed-in user and their app, so every
 * failure mode has an exit:
 *
 *  - Accept fails       → inline error and Try again, never a dead button.
 *  - Accept keeps       → Continue anyway. If the backend cannot record consent
 *    failing                (an outage, or a deploy where /auth/accept-terms does
 *                            not exist yet) the honest answer is to let people in.
 *                            A gate that bricks the whole app on a server hiccup
 *                            is a worse failure than a missing consent row.
 *  - Won't accept       → the back arrow signs out and returns to login.
 */
export default function TermsGateScreen() {
  const Colors = useTheme();
  const acceptTerms = useAuthStore((s) => s.acceptTerms);
  const logout = useAuthStore((s) => s.logout);

  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleAccept() {
    if (!accepted || isSubmitting) return;
    setIsSubmitting(true);
    const ok = await acceptTerms();
    setIsSubmitting(false);
    if (!ok) setFailed(true);
    // On success the guard sees the updated user and routes onward; there is
    // nothing to navigate to from here.
  }

  /**
   * Let the user through without a recorded acceptance.
   *
   * Only reachable after a failed attempt, so it is never the easy path — but it
   * exists so that a backend problem degrades to "we could not write the consent
   * row" rather than "nobody can open the app". The guard will show this screen
   * again on the next launch, so nothing is permanently skipped.
   */
  function handleContinueAnyway() {
    useAuthStore.setState((state) =>
      state.user ? { user: { ...state.user, termsAcceptedAt: new Date().toISOString() } } : state,
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 24,
          width: '100%',
          maxWidth: AUTH_CONTENT_MAX_WIDTH,
          alignSelf: 'center',
        }}
      >
        <TouchableOpacity
          onPress={() => void logout()}
          accessibilityRole="button"
          accessibilityLabel="Sign out and go back"
          hitSlop={12}
          style={{ marginBottom: 28, alignSelf: 'flex-start' }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text
            accessibilityRole="header"
            style={{
              color: Colors.textBright,
              fontFamily: Font.display,
              fontSize: 27,
              letterSpacing: -0.7,
              marginBottom: 12,
            }}
          >
            Before you continue
          </Text>

          <Text style={{ color: Colors.subtext, fontSize: 14, lineHeight: 21, marginBottom: 28 }}>
            We&apos;ve published Terms of Use covering what can be posted on Ascend and how we
            handle reports. Please read and accept them to carry on.
          </Text>

          <TermsConsentRow checked={accepted} onToggle={setAccepted} />

          <TouchableOpacity
            onPress={handleAccept}
            disabled={!accepted || isSubmitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !accepted || isSubmitting }}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 14,
              paddingVertical: 15,
              alignItems: 'center',
              marginTop: 24,
              opacity: !accepted || isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Accept and continue</Text>
            )}
          </TouchableOpacity>

          {!accepted && (
            <Text
              style={{ color: Colors.subtext, fontSize: 12, textAlign: 'center', marginTop: 10 }}
            >
              Agree to the terms to continue
            </Text>
          )}

          {failed && (
            <View style={{ marginTop: 18 }}>
              <View
                style={{
                  backgroundColor: '#7f1d1d20',
                  borderWidth: 1,
                  borderColor: '#ef4444',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ color: '#ef4444', fontSize: 13 }}>
                  We couldn&apos;t save that. Check your connection and try again.
                </Text>
              </View>

              <TouchableOpacity
                onPress={handleContinueAnyway}
                accessibilityRole="button"
                hitSlop={8}
                style={{ alignSelf: 'center', marginTop: 14 }}
              >
                <Text style={{ color: Colors.subtext, fontSize: 13, fontWeight: '600' }}>
                  Continue anyway
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
