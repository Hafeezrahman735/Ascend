import { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useGamificationStore } from '../../stores/gamificationStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { useTheme } from '../../hooks/useTheme';
import { getRank, RANK_META, getXpToNextRank, getXpProgressInRank } from '../../lib/rank';

function fmtXP(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export default function AccountScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const xp = useGamificationStore((s) => s.xp);
  const level = useGamificationStore((s) => s.level);
  const currentStreak = useGamificationStore((s) => s.currentStreak);
  const totalSessions = useGamificationStore((s) => s.totalSessions);
  const totalFocusMinutes = useGamificationStore((s) => s.totalFocusMinutes);
  const profile = useUserProfileStore();

  const rank = getRank(xp);
  const xpToNext = getXpToNextRank(xp);
  const xpProgress = getXpProgressInRank(xp);

  useEffect(() => {
    if (user) {
      profile.load(user.id, user.username);
    }
  }, [user?.id]);

  const displayName = profile.displayName || user?.username || '';
  const handle = profile.handle || user?.username || '';
  const avatarEmoji = profile.avatarEmoji || '🦊';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 14,
      }}>
        <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '700' }}>Profile</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings')}
          style={{ padding: 6 }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name="settings-outline" size={22} color={Colors.subtext} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Avatar + Name card */}
        <View style={{
          marginHorizontal: 16, marginTop: 4, marginBottom: 20,
          backgroundColor: Colors.surface, borderRadius: 20,
          borderWidth: 1, borderColor: Colors.border,
          padding: 24, alignItems: 'center', overflow: 'hidden',
        }}>
          <View style={{
            position: 'absolute', top: -30, right: -30,
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: Colors.primary + '18',
          }} />

          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: Colors.raised,
            borderWidth: 2, borderColor: Colors.border,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}>
            <Text style={{ fontSize: 42 }}>{avatarEmoji}</Text>
          </View>

          <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '800' }}>
            {displayName}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 14, marginTop: 4 }}>
            @{handle}
          </Text>

          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            marginTop: 10, backgroundColor: Colors.raised,
            borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6,
          }}>
            <Text style={{ fontSize: 16 }}>{RANK_META[rank].icon}</Text>
            <Text style={{ color: Colors.text, fontWeight: '600', fontSize: 13 }}>
              {rank} · Level {level}
            </Text>
          </View>

          {/* XP bar */}
          <View style={{ width: '100%', marginTop: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: Colors.subtext, fontSize: 12 }}>XP</Text>
              <Text style={{ color: Colors.subtext, fontSize: 12, fontFamily: 'monospace' }}>
                {fmtXP(xpToNext)} to next rank
              </Text>
            </View>
            <View style={{ height: 6, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{
                height: 6,
                width: `${Math.min(1, xpProgress) * 100}%`,
                backgroundColor: Colors.primary, borderRadius: 3,
              }} />
            </View>
          </View>
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', marginHorizontal: 16, gap: 12, marginBottom: 20 }}>
          {[
            { value: String(totalSessions), label: 'Sessions' },
            { value: `${Math.round(totalFocusMinutes / 60)}h`, label: 'Focus' },
            { value: `${currentStreak}d`, label: 'Streak' },
          ].map((stat) => (
            <View key={stat.label} style={{
              flex: 1, backgroundColor: Colors.surface, borderRadius: 14,
              borderWidth: 1, borderColor: Colors.border,
              paddingVertical: 16, alignItems: 'center',
            }}>
              <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '700', fontFamily: 'monospace' }}>
                {stat.value}
              </Text>
              <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 3 }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Settings shortcut */}
        <View style={{ marginHorizontal: 16 }}>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            style={{
              backgroundColor: Colors.surface, borderRadius: 14,
              borderWidth: 1, borderColor: Colors.border,
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 18, paddingVertical: 16, gap: 14,
            }}
          >
            <Ionicons name="settings-outline" size={20} color={Colors.subtext} />
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 15 }}>Account & Settings</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.subtext} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
