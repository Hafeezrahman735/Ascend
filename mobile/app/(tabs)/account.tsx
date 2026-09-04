import { useShallow } from 'zustand/react/shallow';
import { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useGamificationStore } from '../../stores/gamificationStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../../components/AppPressable';
import { getRank, RANK_META, getXpToNextRank, getXpProgressInRank } from '../../lib/rank';

function fmtXP(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * One number and what it counts.
 *
 * Left-aligned rather than centred: three centred tiles read as a KPI strip,
 * where the eye has to re-find the baseline on every tile. Sharing a left edge
 * lets them read as a column of evidence instead.
 */
function StatTile({ value, label, wide = false }: {
  value: string;
  label: string;
  wide?: boolean;
}) {
  const Colors = useTheme();
  return (
    <View style={{
      flex: wide ? undefined : 1,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      paddingVertical: wide ? Space.xl : Space.lg,
      paddingHorizontal: Space.lg,
    }}>
      <Text style={{
        color: Colors.textBright,
        fontSize: wide ? 34 : 24,
        fontWeight: '700',
        fontFamily: Font.mono,
      }}>
        {value}
      </Text>
      <Text style={{ color: Colors.text, fontSize: 12, marginTop: Space.xs }}>
        {label}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const xp = useGamificationStore((s) => s.xp);
  const currentStreak = useGamificationStore((s) => s.currentStreak);
  const totalSessions = useGamificationStore((s) => s.totalSessions);
  const totalFocusMinutes = useGamificationStore((s) => s.totalFocusMinutes);
  // Selected fields rather than the whole store — see the note in app/(tabs)/index.tsx.
  const profile = useUserProfileStore(
    useShallow((s) => ({
      avatarEmoji: s.avatarEmoji,
      displayName: s.displayName,
      handle: s.handle,
      load: s.load,
    })),
  );

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
        paddingHorizontal: Space.xl, paddingVertical: Space.lg,
      }}>
        <Text style={{ color: Colors.textBright, fontSize: 22, fontFamily: Font.display }}>
          Profile
        </Text>
        <AppPressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={{ padding: Space.sm }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name="settings-outline" size={22} color={Colors.subtext} />
        </AppPressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Space.page }}>
        {/* Identity card — avatar beside the name, sharing one left edge. The
            previous version stacked everything on the centreline, which reads
            as a profile template and gives the name no more weight than the
            handle under it. */}
        <View style={{
          marginHorizontal: Space.lg, marginTop: Space.xs, marginBottom: Space.xl,
          backgroundColor: Colors.surface, borderRadius: Radius.xl,
          borderWidth: 1, borderColor: Colors.border,
          padding: Space.xxl,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.lg }}>
            <View style={{
              width: 72, height: 72, borderRadius: Radius.lg,
              backgroundColor: Colors.raised,
              borderWidth: 2, borderColor: Colors.border,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 38 }}>{avatarEmoji}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '800' }}>
                {displayName}
              </Text>
              <Text style={{ color: Colors.text, fontSize: 14, marginTop: 2 }}>
                @{handle}
              </Text>

              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: Space.sm,
                alignSelf: 'flex-start', marginTop: Space.sm,
                backgroundColor: Colors.raised,
                borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: Space.xs,
              }}>
                <Ionicons name={RANK_META[rank].icon} size={16} color={Colors.text} />
                <Text style={{ color: Colors.text, fontWeight: '600', fontSize: 13 }}>
                  {rank}
                </Text>
              </View>
            </View>
          </View>

          {/* XP bar */}
          <View style={{ width: '100%', marginTop: Space.xl }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Space.sm }}>
              <Text style={{ color: Colors.text, fontSize: 12 }}>XP</Text>
              <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
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

        {/* Stats — bento rather than three equal tiles, so the headline number
            carries the weight it earned instead of being one third of a strip. */}
        <View style={{ marginHorizontal: Space.lg, marginBottom: Space.xl, gap: Space.md }}>
          <StatTile wide value={`${Math.round(totalFocusMinutes / 60)}h`} label="Focus" />
          <View style={{ flexDirection: 'row', gap: Space.md }}>
            <StatTile value={String(totalSessions)} label="Sessions" />
            <StatTile value={`${currentStreak}d`} label="Streak" />
          </View>
        </View>

        {/* Settings shortcut */}
        <View style={{ marginHorizontal: Space.lg }}>
          <AppPressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            scaleOnPress={false}
            style={{
              backgroundColor: Colors.surface, borderRadius: Radius.lg,
              borderWidth: 1, borderColor: Colors.border,
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: Space.xl, paddingVertical: Space.lg, gap: Space.lg,
            }}
          >
            <Ionicons name="settings-outline" size={20} color={Colors.subtext} />
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 15 }}>Account & Settings</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.subtext} />
          </AppPressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
