import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Pressable, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../stores/authStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTheme } from '../../hooks/useTheme';
import PasswordField from '../../components/PasswordField';
import { AscendMark } from '../../components/AscendMark';
import { Font } from '../../constants/typography';
import { validateNewPassword } from '../../lib/passwordRules';
import { TermsConsentRow } from '../../components/auth/TermsConsentRow';
import { AUTH_CONTENT_MAX_WIDTH } from '../../components/auth/authLayout';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const { login, register, isLoading, error, clearError } = useAuthStore(
    useShallow((s) => ({
      login: s.login,
      register: s.register,
      isLoading: s.isLoading,
      error: s.error,
      clearError: s.clearError,
    })),
  );

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  function switchMode(m: Mode) {
    setMode(m);
    setLocalError(null);
    clearError();
    // Consent is reset on every mode switch. A box ticked, then a trip through
    // the Log in tab, then back, would otherwise submit consent the user gave to
    // a form they have since left — and consent is the one thing here that must
    // be unambiguous.
    setAcceptedTerms(false);
  }

  async function handleSubmit() {
    setLocalError(null);
    if (mode === 'login') {
      if (!email || !password) {
        setLocalError('All fields are required');
        return;
      }
      const success = await login(email, password);
      if (success) {
        useTaskStore.getState().fetchTasks(true);
      }
    } else {
      if (!email || !username || !password) {
        setLocalError('All fields are required');
        return;
      }
      const passwordError = validateNewPassword(password, confirmPassword);
      if (passwordError) {
        setLocalError(passwordError);
        return;
      }
      if (!acceptedTerms) {
        // Belt and braces: the button is disabled without this, but the check is
        // cheap and the alternative is an account created without consent.
        setLocalError('Please agree to the Terms of Use to continue');
        return;
      }
      const success = await register(email, username, password, acceptedTerms);
      if (success) {
        useTaskStore.getState().fetchTasks(true);
      }
    }
  }

  const displayError = localError || error;
  // Only the signup tab is gated; logging in has its own consent step (the terms
  // gate) for accounts that predate the terms.
  const submitBlocked = mode === 'register' && !acceptedTerms;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40,
            width: '100%', maxWidth: AUTH_CONTENT_MAX_WIDTH, alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={{ alignItems: 'center', marginBottom: 40 }}>
            {/* The mark carries the identity here, so the emoji that used to
                stand in for it is gone rather than sitting beside it. */}
            <AscendMark size={64} />
            <Text style={{
              color: Colors.textBright, fontFamily: Font.display, fontSize: 30,
              letterSpacing: -0.8, marginTop: 14,
            }}>
              Ascend
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 14, marginTop: 6 }}>
              Plan it. Lock in. Ascend.
            </Text>
          </View>

          {/* Toggle pill */}
          <View style={{
            flexDirection: 'row', backgroundColor: Colors.surface,
            borderRadius: 14, padding: 4, marginBottom: 28,
            borderWidth: 1, borderColor: Colors.border,
          }}>
            {(['login', 'register'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => switchMode(m)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 10,
                  alignItems: 'center',
                  backgroundColor: mode === m ? Colors.primary : 'transparent',
                }}
              >
                <Text style={{
                  color: mode === m ? '#fff' : Colors.subtext,
                  fontWeight: '600', fontSize: 14,
                }}>
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Error */}
          {displayError ? (
            <View style={{
              backgroundColor: '#7f1d1d20', borderWidth: 1, borderColor: '#ef4444',
              borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16,
            }}>
              <Text style={{ color: '#ef4444', fontSize: 13 }}>{displayError}</Text>
            </View>
          ) : null}

          {/* Fields */}
          <View style={{ gap: 14 }}>
            {mode === 'register' && (
              <View>
                <Text style={{
                  color: Colors.subtext, fontSize: 12, fontWeight: '600',
                  letterSpacing: 0.5, marginBottom: 7,
                }}>
                  USERNAME
                </Text>
                <TextInput
                  style={{
                    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                    color: Colors.textBright, fontSize: 15,
                  }}
                  placeholder="Choose a username"
                  placeholderTextColor={Colors.subtext}
                  value={username}
                  onChangeText={(t) => { setUsername(t); clearError(); setLocalError(null); }}
                  autoCapitalize="none"
                  autoComplete="username"
                />
              </View>
            )}

            <View>
              <Text style={{
                color: Colors.subtext, fontSize: 12, fontWeight: '600',
                letterSpacing: 0.5, marginBottom: 7,
              }}>
                EMAIL
              </Text>
              <TextInput
                style={{
                  backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                  borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                  color: Colors.textBright, fontSize: 15,
                }}
                placeholder="your@email.com"
                placeholderTextColor={Colors.subtext}
                value={email}
                onChangeText={(t) => { setEmail(t); clearError(); setLocalError(null); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <PasswordField
              label="PASSWORD"
              accessibilityName="password"
              placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChangeText={(t) => { setPassword(t); clearError(); setLocalError(null); }}
              autoComplete={mode === 'register' ? 'new-password' : 'password'}
            />

            {mode === 'register' && (
              <PasswordField
                label="CONFIRM PASSWORD"
                accessibilityName="confirm password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); clearError(); setLocalError(null); }}
                autoComplete="new-password"
              />
            )}

            {mode === 'login' && (
              <TouchableOpacity
                onPress={() => router.push('/(auth)/forgot-password')}
                accessibilityRole="button"
                hitSlop={8}
                style={{ alignSelf: 'flex-end', marginTop: -6 }}
              >
                <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600' }}>
                  Forgot password?
                </Text>
              </TouchableOpacity>
            )}

            {mode === 'register' && (
              <View style={{ marginTop: 4 }}>
                <TermsConsentRow checked={acceptedTerms} onToggle={setAcceptedTerms} />
              </View>
            )}

            <TouchableOpacity
              style={{
                backgroundColor: Colors.primary, borderRadius: 14,
                paddingVertical: 15, alignItems: 'center', marginTop: 6,
                opacity: isLoading || submitBlocked ? 0.5 : 1,
              }}
              onPress={handleSubmit}
              disabled={isLoading || submitBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: isLoading || submitBlocked }}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                  {mode === 'login' ? 'Log In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>

            {/* A disabled button with no stated reason is the classic dead end —
                especially for anyone who has not noticed the checkbox above it. */}
            {submitBlocked && (
              <Text style={{ color: Colors.subtext, fontSize: 12, textAlign: 'center', marginTop: -2 }}>
                Agree to the terms to continue
              </Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
