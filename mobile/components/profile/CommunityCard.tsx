/**
 * The way into Community from You (design DD4, DD9, DD13).
 *
 *   ┌──────────────────────────────────────────┐
 *   │ (people)  Community                    > │  -> Community, feed
 *   │           Feed, groups and posts         │
 *   │ ┌──────────────────┐ ┌─────────────────┐ │
 *   │ │ #4               │ │ (pen)           │ │
 *   │ │ on Leaderboard   │ │ Share update    │ │
 *   │ └──────────────────┘ └─────────────────┘ │
 *   └──────────────────────────────────────────┘
 *     -> Community,         -> Community, then
 *        Leaderboard tab       the post composer
 *
 * The rank is the user's global all-time position, fetched here each time You
 * gains focus and kept in local state (not socialStore, where Community's
 * Friends filter would change it). Unread notifications are not shown here;
 * the bell on Today owns them.
 */
import { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';
import { useUserSettingsStore } from '../../stores/userSettingsStore';
import { requestFocusLeaderboard, FOCUS_LEADERBOARD_PERIOD } from '../../stores/socialStore';
import { leaderboardTilePosition, type RankFetch } from '../../lib/communityCard';
import { sectionLabel } from './shared';

const TILE_MIN_HEIGHT = 72;

function useGlobalRank(optedOut: boolean): RankFetch {
  const [rank, setRank] = useState<RankFetch>({ status: 'loading' });
  useFocusEffect(
    useCallback(() => {
      if (optedOut) return;
      let cancelled = false;
      requestFocusLeaderboard('global', FOCUS_LEADERBOARD_PERIOD)
        .then((page) => {
          if (cancelled) return;
          if (!page) {
            console.warn('[CommunityCard] leaderboard request failed');
            setRank({ status: 'error' });
            return;
          }
          setRank({ status: 'loaded', position: page.myEntry?.position ?? null });
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn('[CommunityCard] leaderboard request failed:', err);
          setRank({ status: 'error' });
        });
      return () => { cancelled = true; };
    }, [optedOut]),
  );
  return rank;
}

export default function CommunityCard() {
  const Colors = useTheme();
  const router = useRouter();
  const optedOut = useUserSettingsStore((s) => !s.showOnLeaderboard);
  const position = leaderboardTilePosition(optedOut, useGlobalRank(optedOut));

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel(Colors)}>Community</Text>
      <View style={{
        backgroundColor: Colors.surface, borderRadius: 16,
        borderWidth: 1, borderColor: Colors.BORDER_SOFT, overflow: 'hidden',
      }}>
        <Pressable
          onPress={() => router.push('/community')}
          accessibilityRole="button"
          accessibilityLabel="Open Community"
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingHorizontal: 16, paddingVertical: 14, minHeight: 44,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{
            width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primaryDim,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="people-outline" size={20} color={Colors.primarySoft} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700' }}>Community</Text>
            <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>Feed, groups and posts</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.text} />
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 }}>
          <Pressable
            onPress={() => router.push({ pathname: '/community', params: { tab: 'leaderboard' } })}
            accessibilityRole="button"
            accessibilityLabel={position != null
              ? `Number ${position} on the leaderboard. Open the leaderboard`
              : 'Open the leaderboard'}
            style={({ pressed }) => ({
              flex: 1, minHeight: TILE_MIN_HEIGHT, borderRadius: 12, padding: 12,
              backgroundColor: Colors.raised, justifyContent: 'space-between',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {position != null ? (
              <Text style={{ color: Colors.accent, fontFamily: Font.monoMedium, fontSize: 24, fontWeight: '700' }}>
                #{position}
              </Text>
            ) : (
              <Ionicons name="trophy-outline" size={24} color={Colors.accent} />
            )}
            <Text style={{ color: Colors.text, fontSize: 12, fontWeight: '600' }}>
              {position != null ? 'on Leaderboard' : 'Leaderboard'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push({ pathname: '/community', params: { compose: '1' } })}
            accessibilityRole="button"
            accessibilityLabel="Share update. Opens Community and the post form"
            style={({ pressed }) => ({
              flex: 1, minHeight: TILE_MIN_HEIGHT, borderRadius: 12, padding: 12,
              backgroundColor: Colors.primary, justifyContent: 'space-between',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Share update</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
