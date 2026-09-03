import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import PasswordField from '../../components/PasswordField';
import { validateNewPassword } from '../../lib/passwordRules';

/**
 * Where the emailed link lands: ascend://reset-password?token=…
 *
 * The (auth) group is load-bearing and invisible in the URL. Expo Router
 * excludes group names from the path, and the root layout's auth guard bounces
 * any signed-out user whose first segment is not `(auth)` to login. Put this
 * screen anywhere else and the deep link redirects to the login page before it
 * can read the token — for the one person guaranteed to be signed out.
 */
export default function ResetPasswordScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);

    // Checked here as well as on the server so a typo costs a keystroke rather
    // than a round trip. The server is what enforces it — resetSchema reuses
    // registerSchema's password rule — and this shares one rule with the
    // register form for the same reason.
    const passwordError = validateNewPassword(password, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.post<{ message: string }>('/auth/reset-password', { token, password });
      if (res.success) {
        setDone(true);
      } else {
        // The server gives one message for expired and already-used, on purpose.
        setError(res.error ?? 'Could not reset your password. Request a new link.');
      }
    } catch {
      setError('Could not reach the server. Try again in a moment.');
    } finally {
      setIsLoading(false);
    }
  }

  // A link opened without a token is a mangled email, not a bug worth a form.
  if (!token) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 }}>
          <Ionicons name="alert-circle-outline" size={44} color={Colors.ROSE} />
          <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
            This link is incomplete
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
            Open the link from your email again, or request a new one.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/(auth)/forgot-password')}
            accessibilityRole="button"
            style={{
              marginTop: 12, backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 15, paddingHorizontal: 32,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
              Request a new link
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 }}>
          <Ionicons name="checkmark-circle-outline" size={44} color={Colors.trace} />
          <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
            Password updated
          </Text>
          {/* Says it plainly rather than letting it be a surprise: the reset
              revokes every existing session, so any other device is now signed
              out too. That is the point of the feature, and a user who is not
              told will read it as a bug. */}
          <Text style={{ color: Colors.subtext, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
            You&apos;ve been signed out everywhere else. Sign in with your new password.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/(auth)/login')}
            accessibilityRole="button"
            style={{
              marginTop: 12, backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 15, paddingHorizontal: 32,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={{ color: Colors.textBright, fontSize: 24, fontWeight: '800', marginBottom: 8 }}>
              Set a new password
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 14, lineHeight: 21 }}>
              Choose something you haven&apos;t used before. This link works once.
            </Text>
          </View>

          {error && (
            <View style={{
              backgroundColor: Colors.ROSE_DIM, borderRadius: 10, padding: 12,
            }}>
              <Text style={{ color: Colors.ROSE, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          <PasswordField
            label="NEW PASSWORD"
            accessibilityName="new password"
            placeholder="At least 8 characters"
            value={password}
            onChangeText={(t) => { setPassword(t); setError(null); }}
            autoComplete="new-password"
          />

          <PasswordField
            label="CONFIRM NEW PASSWORD"
            accessibilityName="confirm new password"
            placeholder="Type it again"
            value={confirmPassword}
            onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
            autoComplete="new-password"
          />

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isLoading}
            accessibilityRole="button"
            style={{
              backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 15, alignItems: 'center', opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                Update password
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
