import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useGamificationStore } from '../stores/gamificationStore';
import { useTheme } from '../hooks/useTheme';
import { orderAchievements, allUnlocked as everyAchievementUnlocked } from '../lib/achievementOrder';
import AchievementsGrid from '../components/profile/AchievementsGrid';

/**
 * "View All" — the full achievements catalogue.
 *
 * Fetches for itself rather than trusting the store to be warm. The profile row
 * that links here hides itself while the catalogue is empty, so a cold start or
 * a deep link straight to this route would otherwise render a blank screen
 * forever, with nothing on the path having triggered a load.
 */
export default function AchievementsScreen() {
  const Colors = useTheme();
  const router = useRouter();

  const achievements = useGamificationStore((s) => s.achievements);
  const isLoading = useGamificationStore((s) => s.isLoadingAchievements);
  const error = useGamificationStore((s) => s.achievementsError);
  const fetchAchievements = useGamificationStore((s) => s.fetchAchievements);

  useEffect(() => {
    if (achievements.length === 0) fetchAchievements();
    // Deliberately mount-only: refetching on every list change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordered = useMemo(() => orderAchievements(achievements), [achievements]);
  const allDone = everyAchievementUnlocked(ordered);

  const earned = ordered.filter((a) => a.isUnlocked).length;

  const onRefresh = useCallback(() => { fetchAchievements(); }, [fetchAchievements]);

  // Only a truly empty list is a blocking state. Once anything is loaded, a
  // failed refresh shows the stale list rather than throwing it away.
  const showSpinner = isLoading && achievements.length === 0;
  const showError = !!error && achievements.length === 0 && !isLoading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 12,
      }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ minWidth: 32, minHeight: 32, justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700' }}>
            Achievements
          </Text>
          {ordered.length > 0 && (
            <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>
              {earned} of {ordered.length} earned
            </Text>
          )}
        </View>
      </View>

      {showSpinner ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : showError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={28} color={Colors.subtext} />
          <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '600', marginTop: 12, textAlign: 'center' }}>
            Couldn&apos;t load achievements
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
            {error === 'offline'
              ? 'Check your connection and try again.'
              : 'The server is taking a moment. Try again.'}
          </Text>
          <Pressable
            onPress={onRefresh}
            accessibilityRole="button"
            style={{
              marginTop: 20, minHeight: 44, justifyContent: 'center',
              paddingHorizontal: 24, borderRadius: 12, backgroundColor: Colors.primary,
            }}
          >
            <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          <AchievementsGrid achievements={ordered} allUnlocked={allDone} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
