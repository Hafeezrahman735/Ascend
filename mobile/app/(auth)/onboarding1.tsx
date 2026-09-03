import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { useTheme } from '../../hooks/useTheme';

function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

export default function Onboarding1Screen() {
  const Colors = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const saveProfile = useUserProfileStore((s) => s.save);

  const [displayName, setDisplayName] = useState(user?.username ?? '');
  const [handle, setHandle] = useState(slugify(user?.username ?? ''));
  const [handleEdited, setHandleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDisplayNameChange(text: string) {
    setDisplayName(text);
    if (!handleEdited) setHandle(slugify(text));
    setError(null);
  }

  function onHandleChange(text: string) {
    setHandle(text.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
    setHandleEdited(true);
    setError(null);
  }

  async function handleContinue() {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (handle.length < 3) {
      setError('Handle must be at least 3 characters');
      return;
    }
    if (user) {
      await saveProfile(user.id, { displayName: displayName.trim(), handle });
    }
    router.replace('/(auth)/onboarding2');
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 48 }}>
          {/* Progress dots */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 44 }}>
            <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.primary }} />
            <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.inactive }} />
          </View>

          {/* The product has no positioning anywhere else, so onboarding is
              where it gets stated: no manager, no fixed schedule, no structure
              handed to you — this is the structure. */}
          <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800', marginBottom: 8 }}>
            No one is telling you what to do next
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 15, marginBottom: 36, lineHeight: 22 }}>
            That is the hard part of working for yourself. Trace is the structure
            you would otherwise have to invent every morning. First — what should
            we call you?
          </Text>

          {error ? (
            <View style={{
              backgroundColor: '#7f1d1d20', borderWidth: 1, borderColor: '#ef4444',
              borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
            }}>
              <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text>
            </View>
          ) : null}

          <View style={{ gap: 22 }}>
            <View>
              <Text style={{
                color: Colors.subtext, fontSize: 12, fontWeight: '600',
                letterSpacing: 0.5, marginBottom: 8,
              }}>
                DISPLAY NAME
              </Text>
              <TextInput
                style={{
                  backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                  borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                  color: Colors.textBright, fontSize: 16,
                }}
                placeholder="Your name or nickname"
                placeholderTextColor={Colors.subtext}
                value={displayName}
                onChangeText={onDisplayNameChange}
                autoCorrect={false}
                maxLength={40}
              />
            </View>

            <View>
              <Text style={{
                color: Colors.subtext, fontSize: 12, fontWeight: '600',
                letterSpacing: 0.5, marginBottom: 8,
              }}>
                HANDLE
              </Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
                borderRadius: 12, paddingHorizontal: 16,
              }}>
                <Text style={{ color: Colors.subtext, fontSize: 16 }}>@</Text>
                <TextInput
                  style={{
                    flex: 1, paddingVertical: 14, paddingLeft: 4,
                    color: Colors.textBright, fontSize: 16,
                  }}
                  placeholder="your_handle"
                  placeholderTextColor={Colors.subtext}
                  value={handle}
                  onChangeText={onHandleChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                />
                {handle.length >= 3 && (
                  <Text style={{ color: Colors.trace, fontSize: 14, fontWeight: '700' }}>✓</Text>
                )}
              </View>
              <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 6 }}>
                Letters, numbers, and underscores only
              </Text>
            </View>
          </View>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={{
              backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 16, alignItems: 'center', marginBottom: 32,
            }}
            onPress={handleContinue}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
