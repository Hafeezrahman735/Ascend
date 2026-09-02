import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';

/**
 * Ask for a reset link.
 *
 * Lives in the (auth) group because the root layout redirects any signed-out
 * user whose first segment is not `(auth)` straight to login — and someone who
 * has forgotten their password is, by definition, signed out.
 *
 * The screen shows the same confirmation whatever happened, including when the
 * request failed outright. That mirrors the server, which answers identically
 * for a real address and an unknown one so the endpoint cannot be used to find
 * out who has an account. Surfacing a network error here would not leak that,
 * but it would train people to expect the message to be meaningful, and the
 * whole design rests on it not being.
 */
export default function ForgotPasswordScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || isLoading) return;
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
    } catch {
      // Deliberately swallowed — see the note above.
    } finally {
      setIsLoading(false);
      setSent(true);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            hitSlop={12}
            style={{ marginBottom: 24, alignSelf: 'flex-start' }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>

          {sent ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 }}>
              <Ionicons name="mail-outline" size={44} color={Colors.primary} />
              <Text style={{
                color: Colors.textBright, fontSize: 20, fontWeight: '700', textAlign: 'center',
              }}>
                Check your email
              </Text>
              <Text style={{
                color: Colors.subtext, fontSize: 14, textAlign: 'center', lineHeight: 21,
              }}>
                If an account exists for that address, we&apos;ve sent a reset link. It expires in
                30 minutes and can only be used once.
              </Text>
              <TouchableOpacity
                onPress={() => router.replace('/(auth)/login')}
                accessibilityRole="button"
                style={{
                  marginTop: 12, backgroundColor: Colors.primary, borderRadius: 14,
                  paddingVertical: 15, paddingHorizontal: 32,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                  Back to sign in
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 18 }}>
              <View>
                <Text style={{
                  color: Colors.textBright, fontSize: 24, fontWeight: '800', marginBottom: 8,
                }}>
                  Forgot password
                </Text>
                <Text style={{ color: Colors.subtext, fontSize: 14, lineHeight: 21 }}>
                  Enter the email you signed up with and we&apos;ll send you a link to set a new
                  password.
                </Text>
              </View>

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
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                />
              </View>

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isLoading || !email.trim()}
                accessibilityRole="button"
                style={{
                  backgroundColor: Colors.primary, borderRadius: 14,
                  paddingVertical: 15, alignItems: 'center',
                  opacity: isLoading || !email.trim() ? 0.6 : 1,
                }}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                    Send reset link
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
