import { useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../../hooks/useTheme';
import { useGamificationStore } from '../../stores/gamificationStore';
import {
  orderAchievements, selectRowAchievements, stabilizeOrder,
  type OrderedAchievement,
} from '../../lib/achievementOrder';
import { sectionLabel } from '../profile/shared';

/**
 * Compact achievements strip for the profile.
 *
 * Shows what you have earned (hardest first) followed by whatever is closest to
 * being earned, so the row always ends on something reachable rather than a
 * blank shelf. The full grid lives behind "View All".
 *
 * Deliberately NOT a bare horizontal ScrollView: it caps at VISIBLE_TILES and
 * ends on a "+N more" tile. A row that runs off the screen edge with no terminal
 * marker reads as complete, which makes the rest of the catalogue
 * undiscoverable.
 */

const VISIBLE_TILES = 4;
const TILE = 64; // >= 44pt minimum touch target, with room for the label

function Tile({ achievement, onPress }: {
  achievement: OrderedAchievement;
  onPress: () => void;
}) {
  const Colors = useTheme();
  const { GOLD } = Colors;
  const { isUnlocked, isGold, progress, icon, name, currentValue, threshold } = achievement;

  const accent = isGold ? GOLD : Colors.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The emoji alone announces as its raw glyph name, which tells a screen
      // reader user nothing. Spell out state and progress instead.
      accessibilityLabel={
        isUnlocked
          ? `${name}, earned`
          : `${name}, locked, ${currentValue} of ${threshold}`
      }
      style={{ width: TILE, alignItems: 'center' }}
    >
      <View style={{
        width: TILE - 12, height: TILE - 12, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: isUnlocked ? Colors.raised : Colors.surface,
        borderWidth: 1,
        borderColor: isUnlocked ? `${accent}55` : Colors.border,
        // Locked tiles recede but stay legible — they are the next goal, not chrome.
        opacity: isUnlocked ? 1 : 0.55,
      }}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>

      {/* Progress bar, matching the idiom used everywhere else in the app. */}
      <View style={{
        width: TILE - 12, height: 3, borderRadius: 2, marginTop: 6,
        backgroundColor: Colors.inactive, overflow: 'hidden',
      }}>
        <View style={{
          width: `${Math.round(Math.min(1, progress) * 100)}%`,
          height: '100%', borderRadius: 2, backgroundColor: accent,
        }} />
      </View>

      <Text
        numberOfLines={1}
        style={{ color: Colors.subtext, fontSize: 9, marginTop: 4, maxWidth: TILE }}
      >
        {name}
      </Text>
    </Pressable>
  );
}

function MoreTile({ remaining, onPress }: { remaining: number; onPress: () => void }) {
  const Colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`View all achievements, ${remaining} more`}
      style={{ width: TILE, alignItems: 'center' }}
    >
      <View style={{
        width: TILE - 12, height: TILE - 12, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: Colors.surface,
        borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
      }}>
        <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '700' }}>
          +{remaining}
        </Text>
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 9, marginTop: 10 }}>more</Text>
    </Pressable>
  );
}

function SkeletonTile() {
  const Colors = useTheme();
  return (
    <View style={{ width: TILE, alignItems: 'center' }}>
      <View style={{
        width: TILE - 12, height: TILE - 12, borderRadius: 14,
        backgroundColor: Colors.surface, opacity: 0.5,
      }} />
    </View>
  );
}

export default function AchievementsRow() {
  const Colors = useTheme();
  const router = useRouter();

  const achievements = useGamificationStore((s) => s.achievements);
  const isLoading = useGamificationStore((s) => s.isLoadingAchievements);
  const error = useGamificationStore((s) => s.achievementsError);
  const fetchAchievements = useGamificationStore((s) => s.fetchAchievements);

  useEffect(() => {
    if (achievements.length === 0) fetchAchievements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hold the rendered order steady across background refetches so tiles cannot
  // reorder under a finger mid-scroll. Only a change in the SET reshuffles.
  const renderedKeys = useRef<string[]>([]);
  const ordered = useMemo(() => {
    const fresh = orderAchievements(achievements);
    const stable = stabilizeOrder(renderedKeys.current, fresh);
    renderedKeys.current = stable.map((a) => a.key);
    return stable;
  }, [achievements]);

  const { visible, remaining } = selectRowAchievements(ordered, VISIBLE_TILES);
  const openAll = () => router.push('/achievements');

  const showSkeleton = isLoading && achievements.length === 0;
  // An empty row and a failed fetch look identical without this — the exact
  // silent failure the error state exists to prevent.
  const showError = !!error && achievements.length === 0 && !isLoading;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={sectionLabel(Colors)}>Achievements</Text>
        {ordered.length > 0 && (
          <Pressable
            onPress={openAll}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="View all achievements"
            style={{ marginBottom: 12 }}
          >
            <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '600' }}>
              View All
            </Text>
          </Pressable>
        )}
      </View>

      {showSkeleton ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {Array.from({ length: VISIBLE_TILES }, (_, i) => <SkeletonTile key={i} />)}
        </View>
      ) : showError ? (
        <Pressable
          onPress={() => fetchAchievements()}
          accessibilityRole="button"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingVertical: 14, paddingHorizontal: 14,
            backgroundColor: Colors.surface, borderRadius: 12,
            borderWidth: 1, borderColor: Colors.border, minHeight: 44,
          }}
        >
          <Ionicons name="refresh" size={15} color={Colors.subtext} />
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>
            {error === 'offline'
              ? "Couldn't load achievements. Tap to retry."
              : 'Achievements are taking a moment. Tap to retry.'}
          </Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {visible.map((a) => (
            <Tile key={a.key} achievement={a} onPress={openAll} />
          ))}
          {remaining > 0 && <MoreTile remaining={remaining} onPress={openAll} />}
        </ScrollView>
      )}
    </View>
  );
}
