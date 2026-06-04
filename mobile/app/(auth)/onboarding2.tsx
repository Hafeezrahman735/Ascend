import { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { Colors } from '../../constants/Colors';

const AVATAR_EMOJIS = [
  '🦊', '🐸', '🦁', '🐳', '🦉', '🐰',
  '🦋', '🐙', '🦚', '🐻', '🦝', '🐵',
  '🐼', '🦄', '🐧', '🦭', '🐯', '🦦',
  '🐨', '🦩', '🐝', '🐲', '🦕', '🐬',
];

export default function Onboarding2Screen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setIsNewUser = useAuthStore((s) => s.setIsNewUser);
  const avatarEmojiFromStore = useUserProfileStore((s) => s.avatarEmoji);
  const saveProfile = useUserProfileStore((s) => s.save);

  const [selected, setSelected] = useState(avatarEmojiFromStore || AVATAR_EMOJIS[0]);

  async function handleFinish() {
    if (user) {
      await saveProfile(user.id, { avatarEmoji: selected });
    }
    setIsNewUser(false);
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: 48 }}>
        {/* Progress dots */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 44 }}>
          <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.raised }} />
          <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: Colors.primary }} />
        </View>

        <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800', marginBottom: 8 }}>
          Pick your avatar
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 15, marginBottom: 28, lineHeight: 22 }}>
          Choose an emoji that represents you
        </Text>

        {/* Selected preview */}
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: Colors.surface,
            borderWidth: 2, borderColor: Colors.primary,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 44 }}>{selected}</Text>
          </View>
        </View>

        {/* Emoji grid */}
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {AVATAR_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => setSelected(emoji)}
                style={{
                  width: 64, height: 64, borderRadius: 16,
                  backgroundColor: selected === emoji ? Colors.primaryDim : Colors.surface,
                  borderWidth: 2,
                  borderColor: selected === emoji ? Colors.primary : Colors.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 32 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ height: 16 }} />
        </ScrollView>

        <TouchableOpacity
          style={{
            backgroundColor: Colors.primary, borderRadius: 14,
            paddingVertical: 16, alignItems: 'center', marginTop: 12, marginBottom: 32,
          }}
          onPress={handleFinish}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
