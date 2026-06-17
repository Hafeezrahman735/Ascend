import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Pressable, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useTaskStore } from '../../stores/taskStore';
import { useTheme } from '../../hooks/useTheme';

type Mode = 'login' | 'register';

export default function AuthScreen() {
  const Colors = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const { login, register, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function switchMode(m: Mode) {
    setMode(m);
    setLocalError(null);
    clearError();
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
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match');
        return;
      }
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters');
        return;
      }
      const success = await register(email, username, password);
      if (success) {
        useTaskStore.getState().fetchTasks(true);
      }
    }
  }

  const displayError = localError || error;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={{ alignItems: 'center', marginBottom: 40 }}>
            <Text style={{ fontSize: 56, marginBottom: 10 }}>🧠</Text>
            <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800', letterSpacing: 0.5 }}>
              Ascend
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 14, marginTop: 6 }}>
              Focus. Track. Achieve.
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

            <View>
              <Text style={{
                color: Colors.subtext, fontSize: 12, fontWeight: '600',
                letterSpacing: 0.5, marginBottom: 7,
              }}>
                PASSWORD
              </Text>
              <TextInput
                style={{
                  backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                  borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                  color: Colors.textBright, fontSize: 15,
                }}
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                placeholderTextColor={Colors.subtext}
                value={password}
                onChangeText={(t) => { setPassword(t); clearError(); setLocalError(null); }}
                secureTextEntry
                autoComplete={mode === 'register' ? 'new-password' : 'password'}
              />
            </View>

            {mode === 'register' && (
              <View>
                <Text style={{
                  color: Colors.subtext, fontSize: 12, fontWeight: '600',
                  letterSpacing: 0.5, marginBottom: 7,
                }}>
                  CONFIRM PASSWORD
                </Text>
                <TextInput
                  style={{
                    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                    color: Colors.textBright, fontSize: 15,
                  }}
                  placeholder="Confirm your password"
                  placeholderTextColor={Colors.subtext}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); clearError(); setLocalError(null); }}
                  secureTextEntry
                  autoComplete="new-password"
                />
              </View>
            )}

            <TouchableOpacity
              style={{
                backgroundColor: Colors.primary, borderRadius: 14,
                paddingVertical: 15, alignItems: 'center', marginTop: 6,
                opacity: isLoading ? 0.7 : 1,
              }}
              onPress={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                  {mode === 'login' ? 'Log In' : 'Create Account'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
