import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../hooks/useTheme';
import { TermsDocument } from '../../components/auth/TermsDocument';
import { TermsConsentRow } from '../../components/auth/TermsConsentRow';
import { AUTH_CONTENT_MAX_WIDTH } from '../../components/auth/authLayout';
import { CURRENT_TERMS_VERSION } from '../../constants/legal';

/**
 * Read and accept the Terms, for an account that has not yet done so.
 *
 * This is the LOGIN half of App Store Guideline 1.2's "before registering or
 * logging in". Signup records consent through its own flow, but every account
 * that existed before the terms did has termsAcceptedAt null, and a returning
 * user never touches the signup form again — they bootstrap straight through
 * /auth/me. The auth guard in app/_layout.tsx routes those accounts here.
 *
 * Presents the whole document with the checkbox at the foot, for the same
 * reason (auth)/terms does: an agreement nobody scrolled through is not one
 * they can be said to have read.
 *
 * ─── Why this screen can never trap anyone ──────────────────────────────────
 *
 * It is the only thing standing between a signed-in user and their app, so
 * every failure mode has an exit:
 *
 *  - Accept fails     → inline error and the button stays live, never a dead end.
 *  - Accept keeps     → Continue anyway. If the backend cannot record consent
 *    failing              (an outage, or a deploy where /auth/accept-terms does
 *                          not exist yet) the honest answer is to let people in.
 *                          A gate that bricks the app on a server hiccup is a
 *                          worse failure than a missing consent row.
 *  - Won't accept     → the back arrow signs out and returns to login.
 */
export default function TermsGateScreen() {
  const Colors = useTheme();
  const acceptTerms = useAuthStore((s) => s.acceptTerms);
  const logout = useAuthStore((s) => s.logout);

  const [checked, setChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleAccept() {
    if (!checked || isSubmitting) return;
    setIsSubmitting(true);
    setFailed(false);
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
   * exists so a backend problem degrades to "we could not write the consent row"
   * rather than "nobody can open the app". Sets the version as well as the
   * timestamp, because the guard compares against CURRENT_TERMS_VERSION and a
   * timestamp alone would bounce the user straight back here. The gate reappears
   * on the next launch, so nothing is permanently skipped.
   */
  function handleContinueAnyway() {
    useAuthStore.setState((state) =>
      state.user
        ? {
            user: {
              ...state.user,
              termsAcceptedAt: new Date().toISOString(),
              termsVersion: CURRENT_TERMS_VERSION,
            },
          }
        : state,
    );
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
          onPress={() => void logout()}
          accessibilityRole="button"
          accessibilityLabel="Sign out and go back"
          hitSlop={12}
          style={{ marginBottom: 20, alignSelf: 'flex-start' }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>

        <Text style={{ color: Colors.subtext, fontSize: 14, lineHeight: 21, marginBottom: 24 }}>
          We&apos;ve published Terms of Service covering what can be posted on Ascend and how we
          handle reports. Please read them and accept at the bottom to carry on.
        </Text>

        <TermsDocument />

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
            onPress={handleAccept}
            disabled={!checked || isSubmitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !checked || isSubmitting }}
            style={{
              backgroundColor: Colors.primary,
              borderRadius: 14,
              paddingVertical: 15,
              alignItems: 'center',
              marginTop: 20,
              opacity: !checked || isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                Accept and continue
              </Text>
            )}
          </TouchableOpacity>

          {!checked && (
            <Text
              style={{ color: Colors.subtext, fontSize: 12, textAlign: 'center', marginTop: 10 }}
            >
              Tick the box above to continue
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
