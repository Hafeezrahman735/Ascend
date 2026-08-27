import {
  useEffect, useRef, useState, useMemo,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
  FlatList,
  Image,
  TextInput,
  ActivityIndicator,
  AppState,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';

import { useAuthStore } from '../../stores/authStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { useGamification } from '../../store/hooks';
import { useTimerStore } from '../../stores/timerStore';
import { useSocialStore } from '../../stores/socialStore';
import type { SocialPost, UserSocialStats, UserListItem } from '../../types';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import { makePostTypeMeta, FREE_TAG_META } from '../../constants/socialTheme';
import {
  getRank, getXpToNextRank, getXpProgressInRank,
  RANK_ORDER, RANK_META,
} from '../../lib/rank';
import type { RankTier } from '../../lib/rank';
import RankSection from '../../components/profile/CurrentRankSection';
import { sectionLabel, fmtXP } from '../../components/profile/shared';
import AchievementsRow from '../../components/achievements/AchievementsRow';
import type { StreakState } from '../../types/profile';
import { Font } from '../../constants/typography';

// ─── Local types ─────────────────────────────────────────────────────────────

/**
 * One achievement as the Profile grid renders it.
 *
 * Built straight from the server catalogue (GET /achievements). It used to be
 * merged from a hardcoded client list whose keys mostly did not exist on the
 * backend — 7 of 10 could never unlock, yet still drew a progress bar that
 * climbed to 100%, because progress was computed client-side while `isUnlocked`
 * came from a server lookup that always missed.
 */
// Ordering, the display shape, and the gold-tier rule all live in
// lib/achievementOrder.ts now: it is pure, so it can be unit-tested, and it
// reads `tier` from the server instead of re-deriving an xpReward threshold
// that was duplicated from the backend.

// ─── Local constants ──────────────────────────────────────────────────────────

function groupAvatarBg(c: ThemeColors): Record<string, string> {
  return { purple: c.primaryDim, teal: c.tealDim, amber: c.AMBER_DIM, rose: c.ROSE_DIM };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AVATAR_EMOJIS = ['🦊', '🐸', '🦁', '🐳', '🦉', '🐰', '🦋', '🐙', '🦚', '🐻', '🦝', '🐵'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STREAK_MILESTONES = new Set([7, 14, 30, 60]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAvatarEmoji(username: string): string {
  let hash = 0;
  for (const c of username) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length];
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

async function buildStreakState(
  currentStreak: number,
  longestStreak: number,
): Promise<StreakState> {
  // thisWeekDays and studiedToday are now derived from server data in the component.
  // This function only provides the streak numbers and streakAtRisk placeholder.
  return {
    currentStreak,
    longestStreak,
    studiedToday: false,
    thisWeekDays: Array(7).fill(false),
    streakAtRisk: false,
  };
}

function fmtFocusMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatPostTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const h12 = d.getHours() % 12 || 12;
  const mins = d.getMinutes().toString().padStart(2, '0');
  const ampm = d.getHours() < 12 ? 'am' : 'pm';
  const timeStr = `${h12}:${mins}${ampm}`;
  if (d.toDateString() === now.toDateString()) return `Today · ${timeStr}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${timeStr}`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()} · ${timeStr}`;
}

// ─── Social stats strip ───────────────────────────────────────────────────────

function SocialStatsStrip({ stats, onFollowers, onFollowing, onFriends }: {
  stats: UserSocialStats;
  onFollowers: () => void;
  onFollowing: () => void;
  onFriends: () => void;
}) {
  const Colors = useTheme();
  const { BORDER_SOFT } = Colors;
  const GROUP_AVATAR_BG = groupAvatarBg(Colors);
  return (
    <View style={{
      flexDirection: 'row', marginTop: 14, paddingTop: 12,
      borderTopWidth: 0.5, borderTopColor: BORDER_SOFT,
    }}>
      <Pressable onPress={onFollowers} style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', fontFamily: Font.mono }}>
          {stats.followerCount}
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
          Followers
        </Text>
      </Pressable>

      <View style={{ width: 0.5, backgroundColor: BORDER_SOFT }} />

      <Pressable onPress={onFollowing} style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', fontFamily: Font.mono }}>
          {stats.followingCount}
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
          Following
        </Text>
      </Pressable>

      <View style={{ width: 0.5, backgroundColor: BORDER_SOFT }} />

      <Pressable onPress={onFriends} style={{ flex: 1, alignItems: 'center' }}>
        {stats.friendCount === 0 ? (
          <Text style={{ color: Colors.primarySoft, fontSize: 11 }}>Find friends →</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {stats.friendPreviews.slice(0, 4).map((f, i) => (
              <View key={f.userId} style={{
                width: 24, height: 24, borderRadius: 8,
                backgroundColor: GROUP_AVATAR_BG[f.avatarColor] ?? Colors.primaryDim,
                borderWidth: 2, borderColor: Colors.surface,
                alignItems: 'center', justifyContent: 'center',
                marginLeft: i > 0 ? -6 : 0, zIndex: 4 - i,
              }}>
                <Text style={{ fontSize: 12 }}>{f.avatarEmoji}</Text>
              </View>
            ))}
            {stats.friendCount > 4 && (
              <Text style={{ color: Colors.primarySoft, fontSize: 10, marginLeft: 6 }}>
                +{stats.friendCount - 4}
              </Text>
            )}
          </View>
        )}
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
          Friends
        </Text>
      </Pressable>
    </View>
  );
}

// ─── User list modal (followers / following / friends) ────────────────────────

function UserListModal({ visible, title, items, isLoading, onClose, renderAction, onItemPress }: {
  visible: boolean;
  title: string;
  items: UserListItem[];
  isLoading: boolean;
  onClose: () => void;
  renderAction?: (item: UserListItem) => React.ReactNode;
  onItemPress?: (item: UserListItem) => void;
}) {
  const Colors = useTheme();
  const [search, setSearch] = useState('');
  const filtered = items.filter(
    (i) => i.displayName.toLowerCase().includes(search.toLowerCase()) ||
            i.handle.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '82%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>{title}</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>
          <View style={{
            marginHorizontal: 16, marginBottom: 12,
            backgroundColor: Colors.raised, borderRadius: 12,
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 12, paddingVertical: 8,
          }}>
            <Ionicons name="search" size={16} color={Colors.subtext} />
            <TextInput
              value={search} onChangeText={setSearch}
              placeholder="Search..." placeholderTextColor={Colors.subtext}
              style={{ flex: 1, marginLeft: 8, color: Colors.textBright, fontSize: 14 }}
            />
          </View>
          {isLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 32 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.userId}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <Text style={{ color: Colors.subtext, fontSize: 13 }}>No results</Text>
                </View>
              }
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onItemPress?.(item)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}
                >
                  <View style={{
                    width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.raised,
                    alignItems: 'center', justifyContent: 'center', marginRight: 12,
                  }}>
                    <Text style={{ fontSize: 22 }}>{item.avatarEmoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 14 }}>{item.displayName}</Text>
                    <Text style={{ color: Colors.subtext, fontSize: 12 }}>@{item.handle}</Text>
                  </View>
                  {renderAction?.(item)}
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Compact post card ────────────────────────────────────────────────────────

function CompactPostCard({ post, onPress }: { post: SocialPost; onPress: () => void }) {
  const Colors = useTheme();
  const POST_TYPE_META = makePostTypeMeta(Colors);
  const meta = POST_TYPE_META[post.type] ?? POST_TYPE_META.free_post;
  const tagLabel = post.type === 'free_post' && post.contentTag
    ? `${FREE_TAG_META[post.contentTag].emoji} ${FREE_TAG_META[post.contentTag].label}`
    : meta.label;

  const topReactions = Object.entries(post.reactions ?? {})
    .map(([emoji, ids]) => ({ emoji, count: ids.length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);

  const hasStats = post.sessionCount != null || post.focusMinutes != null ||
    post.streakAtPost != null || (post.attachedStats?.length ?? 0) > 0;

  return (
    <Pressable onPress={onPress} style={{
      backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
      marginHorizontal: 16, marginBottom: 10, padding: 12,
    }}>
      <View style={{ alignSelf: 'flex-start', backgroundColor: meta.bg, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 6 }}>
        <Text style={{ color: meta.color, fontSize: 10, fontWeight: '600' }}>{tagLabel}</Text>
      </View>

      {post.caption ? (
        <Text style={{ color: Colors.text, fontSize: 12, lineHeight: 17, marginBottom: 6 }} numberOfLines={2}>
          {post.caption}
        </Text>
      ) : null}

      {post.photoUrl ? (
        <Image source={{ uri: post.photoUrl }} style={{ width: '100%', height: 80, borderRadius: 10, marginBottom: 6 }} resizeMode="cover" />
      ) : null}

      {hasStats && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
          {post.sessionCount != null && (
            <View style={{ backgroundColor: Colors.raised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700' }}>{post.sessionCount}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 9 }}>Sessions</Text>
            </View>
          )}
          {post.focusMinutes != null && (
            <View style={{ backgroundColor: Colors.raised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700' }}>{fmtFocusMins(post.focusMinutes)}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 9 }}>Focus</Text>
            </View>
          )}
          {post.streakAtPost != null && (
            <View style={{ backgroundColor: Colors.raised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700' }}>{post.streakAtPost}d</Text>
              <Text style={{ color: Colors.subtext, fontSize: 9 }}>Streak</Text>
            </View>
          )}
          {(post.attachedStats ?? []).map((s, i) => (
            <View key={i} style={{ backgroundColor: Colors.raised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 4 }}>
              <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700' }}>{s.value}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 9 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
        <Text style={{ color: Colors.subtext, fontSize: 11 }}>{formatPostTime(post.createdAt)}</Text>
        {topReactions.length > 0 && (
          <Text style={{ color: Colors.subtext, fontSize: 11 }}>
            {topReactions.map((r) => `${r.emoji} ${r.count}`).join('  ')}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── Posts pane ───────────────────────────────────────────────────────────────

function PostsPane({ posts, isLoading, hasMore, onLoadMore, onPostPress }: {
  posts: SocialPost[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onPostPress: (post: SocialPost) => void;
}) {
  const Colors = useTheme();
  const router = useRouter();
  if (posts.length === 0 && !isLoading) {
    return (
      <View style={{ padding: 32, alignItems: 'center' }}>
        <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
          {"You haven't posted anything yet. Share your progress from the Social tab."}
        </Text>
        <Pressable
          onPress={() => router.push('/(tabs)/social')}
          style={{ marginTop: 14, backgroundColor: Colors.primaryDim, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: Colors.primary, fontWeight: '600', fontSize: 13 }}>Go to Social</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 12 }}>
      {posts.map((post) => (
        <CompactPostCard key={post.id} post={post} onPress={() => onPostPress(post)} />
      ))}
      {isLoading && <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 16 }} />}
      {hasMore && !isLoading && (
        <Pressable onPress={onLoadMore} style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>Load more</Text>
        </Pressable>
      )}
      <View style={{ height: 20 }} />
    </View>
  );
}

// ─── XP bar fill ─────────────────────────────────────────────────────────────

function XPBarFill({ progress, reduceMotion }: { progress: number; reduceMotion: boolean }) {
  const Colors = useTheme();
  const fill = useSharedValue(reduceMotion ? progress : 0);

  useEffect(() => {
    fill.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: 600, easing: Easing.out(Easing.ease) });
  }, [progress, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(1, fill.value) * 100}%`,
  }));

  return (
    <Animated.View
      style={[fillStyle, {
        height: 8,
        backgroundColor: Colors.primary,
        borderRadius: 4,
      }]}
    />
  );
}

// ─── Flame (streak icon with pulse anim) ─────────────────────────────────────

function FlameIcon({ isMilestone, reduceMotion }: { isMilestone: boolean; reduceMotion: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isMilestone && !reduceMotion) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.35, { duration: 180 }),
          withTiming(1, { duration: 180 }),
        ),
        3,
        false,
      );
    }
  }, [isMilestone, reduceMotion]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Text style={{ fontSize: 42 }}>🔥</Text>
    </Animated.View>
  );
}

// ─── Rank-up overlay ─────────────────────────────────────────────────────────

function RankUpOverlay({ tier, reduceMotion }: { tier: RankTier; reduceMotion: boolean }) {
  const Colors = useTheme();
  const { GOLD } = Colors;
  const scale = useSharedValue(reduceMotion ? 1 : 0.3);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (!reduceMotion) {
      scale.value = withSpring(1, { damping: 14, stiffness: 160 });
      opacity.value = withTiming(1, { duration: 250 });
    }
  }, []);

  const bgStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[bgStyle, {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(8,8,26,0.93)',
      alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }]}>
      <Animated.View style={[iconStyle, { alignItems: 'center' }]}>
        <Ionicons name={RANK_META[tier].icon} size={80} color={GOLD} />
        <Text style={{
          color: GOLD, fontSize: 30, fontWeight: '800',
          marginTop: 20, letterSpacing: 2, textTransform: 'uppercase',
        }}>
          {tier}
        </Text>
        <Text style={{ color: Colors.textBright, fontSize: 15, marginTop: 8, opacity: 0.8 }}>
          New rank unlocked!
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

interface HeroCardProps {
  username: string;
  avatarEmoji: string;
  xp: number;
  level: number;
  rank: RankTier;
  totalSessions: number;
  totalFocusMinutes: number;
  longestStreak: number;
  xpProgress: number;
  xpToNextRank: number;
  nextRank: RankTier | null;
  reduceMotion: boolean;
  onSettings: () => void;
  socialStats?: UserSocialStats | null;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
  onFriendsPress?: () => void;
}

function HeroCard({
  username, avatarEmoji, xp, level, rank,
  totalSessions, totalFocusMinutes, longestStreak,
  xpProgress, xpToNextRank, nextRank,
  reduceMotion, onSettings,
  socialStats, onFollowersPress, onFollowingPress, onFriendsPress,
}: HeroCardProps) {
  const Colors = useTheme();
  const { GOLD_DIM, GOLD, BORDER_SOFT } = Colors;
  const isNewUser = xp === 0;
  const focusHours = Math.round(totalFocusMinutes / 60);

  return (
    <View style={{
      backgroundColor: Colors.surface,
      marginHorizontal: 16, marginTop: 12,
      borderRadius: 20, padding: 20,
      borderWidth: 1, borderColor: Colors.border,
      overflow: 'hidden',
    }}>
      {/* Radial glow — top right */}
      <View style={{
        position: 'absolute', top: -40, right: -40,
        width: 160, height: 160, borderRadius: 80,
        backgroundColor: Colors.primary + '20',
      }} />

      {/* Top row: avatar + name | rank badge + settings */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: Colors.raised,
            borderWidth: 2, borderColor: Colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 28 }}>{avatarEmoji}</Text>
          </View>
          <View>
            <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>
              {username}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 2 }}>
              @{username.toLowerCase().replace(/\s/g, '')} · Lv. {level}
            </Text>
          </View>
        </View>

        {/* Rank badge + settings — right side, no overlap */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            backgroundColor: GOLD_DIM,
            borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
            flexDirection: 'row', alignItems: 'center', gap: 4,
          }}>
            <Ionicons name={RANK_META[rank].icon} size={14} color={GOLD} />
            <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
              {rank.toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onSettings}
            style={{ padding: 6 }}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <Ionicons name="settings-outline" size={18} color={Colors.subtext} />
          </TouchableOpacity>
        </View>
      </View>

      {/* XP section */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>
            XP
          </Text>
          {!isNewUser && (
            <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
              {fmtXP(xp)} / {fmtXP(xp + xpToNextRank)} XP
            </Text>
          )}
        </View>

        <View style={{
          height: 8, backgroundColor: Colors.inactive,
          borderRadius: 4, overflow: 'hidden',
        }}>
          {isNewUser ? null : <XPBarFill progress={xpProgress} reduceMotion={reduceMotion} />}
        </View>

        {isNewUser ? (
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 6 }}>
            Complete your first session to earn XP
          </Text>
        ) : nextRank ? (
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 6, fontFamily: Font.mono }}>
            {fmtXP(xpToNextRank)} XP until {nextRank}
          </Text>
        ) : (
          <Text style={{ color: GOLD, fontSize: 12, marginTop: 6, fontWeight: '600' }}>
            Maximum rank achieved
          </Text>
        )}
      </View>

      {/* Social stats strip */}
      {socialStats != null && onFollowersPress && onFollowingPress && onFriendsPress && (
        <SocialStatsStrip
          stats={socialStats}
          onFollowers={onFollowersPress}
          onFollowing={onFollowingPress}
          onFriends={onFriendsPress}
        />
      )}

      {/* Bottom stat row */}
      <View style={{
        flexDirection: 'row', marginTop: 18,
        paddingTop: 16,
        borderTopWidth: 1, borderTopColor: BORDER_SOFT,
      }}>
        {[
          { value: String(totalSessions), label: 'Sessions' },
          { value: `${focusHours}h`, label: 'Focus' },
          { value: `${longestStreak}d`, label: 'Best Streak' },
        ].map((stat, i) => (
          <View key={stat.label} style={{
            flex: 1, alignItems: 'center',
            borderRightWidth: i < 2 ? 1 : 0,
            borderRightColor: BORDER_SOFT,
          }}>
            <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700', fontFamily: Font.mono }}>
              {stat.value}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Week dots ────────────────────────────────────────────────────────────────

function WeekDots({ days, studiedToday }: { days: boolean[]; studiedToday: boolean }) {
  const Colors = useTheme();
  const { AMBER_DIM, AMBER } = Colors;
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
      {days.map((studied, idx) => {
        const isToday = idx === todayIdx;
        const isFuture = idx > todayIdx;
        const isDone = studied || (isToday && studiedToday);

        return (
          <View key={idx} style={{ flex: 1, alignItems: 'center', gap: 5 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 8,
              backgroundColor: isDone ? AMBER_DIM : isFuture ? Colors.inactive : Colors.raised,
              borderWidth: 1.5,
              borderColor: isDone ? AMBER : isToday ? AMBER : isFuture ? Colors.border : Colors.border,
              alignItems: 'center', justifyContent: 'center',
              opacity: isFuture ? 0.4 : 1,
            }}>
              {isDone && (
                <Text style={{ color: AMBER, fontSize: 14, fontWeight: '700' }}>✓</Text>
              )}
            </View>
            <Text style={{
              fontSize: 10, fontWeight: isToday ? '700' : '400',
              color: isToday ? AMBER : Colors.subtext,
            }}>
              {DAY_LABELS[idx]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Streak Section ───────────────────────────────────────────────────────────

function StreakSection({
  streakState,
  reduceMotion,
}: {
  streakState: StreakState;
  reduceMotion: boolean;
}) {
  const Colors = useTheme();
  const { AMBER, TEAL } = Colors;
  const { currentStreak, longestStreak, studiedToday, thisWeekDays, streakAtRisk } = streakState;
  const isMilestone = STREAK_MILESTONES.has(currentStreak);
  const isPersonalBest = currentStreak > 0 && currentStreak >= longestStreak;
  const weeklyTotal = thisWeekDays.filter(Boolean).length;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel(Colors)}>Streak</Text>

      {/* Banner + side cards */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {/* Main streak card */}
        <View style={{
          flex: 1, backgroundColor: Colors.surface,
          borderRadius: 16, padding: 18,
          borderWidth: 1, borderColor: Colors.border,
          overflow: 'hidden',
        }}>
          {/* Amber glow */}
          <View style={{
            position: 'absolute', top: -30, right: -30,
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: '#FFB34715',
          }} />

          <FlameIcon isMilestone={isMilestone} reduceMotion={reduceMotion} />

          <Text style={{
            color: currentStreak > 0 ? AMBER : Colors.subtext,
            fontSize: 40, fontWeight: '800', fontFamily: Font.mono,
            marginTop: 4, opacity: currentStreak === 0 ? 0.5 : 1,
          }}>
            {currentStreak}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 2 }}>day streak</Text>

          {currentStreak === 0 && (
            <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 8 }}>
              Start studying to build your streak
            </Text>
          )}

          {isPersonalBest && currentStreak > 0 && (
            <Text style={{ color: AMBER, fontSize: 12, fontWeight: '600', marginTop: 6 }}>
              🔥 Personal best!
            </Text>
          )}

          {!isPersonalBest && longestStreak > 0 && (
            <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 6 }}>
              Best: {longestStreak} days
            </Text>
          )}

          {streakAtRisk && (
            <Text style={{ color: AMBER, fontSize: 12, fontWeight: '600', marginTop: 8 }}>
              Study today — streak at risk ⚠
            </Text>
          )}
        </View>

        {/* Side stat cards */}
        <View style={{ width: 88, gap: 10 }}>
          <View style={{
            flex: 1, backgroundColor: Colors.surface,
            borderRadius: 14, padding: 12,
            borderWidth: 1, borderColor: Colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: Colors.primary, fontSize: 22, fontWeight: '700', fontFamily: Font.mono }}>
              {weeklyTotal}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 3, textAlign: 'center' }}>
              sessions this week
            </Text>
          </View>

          <View style={{
            flex: 1, backgroundColor: Colors.surface,
            borderRadius: 14, padding: 12,
            borderWidth: 1, borderColor: Colors.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: TEAL, fontSize: 22, fontWeight: '700', fontFamily: Font.mono }}>
              {longestStreak}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 3, textAlign: 'center' }}>
              personal best
            </Text>
          </View>
        </View>
      </View>

      {/* Week dots */}
      <WeekDots days={thisWeekDays} studiedToday={studiedToday} />
    </View>
  );
}


// ─── Section label style ──────────────────────────────────────────────────────

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const Colors = useTheme();
  const router = useRouter();
  const auth = useAuthStore();
  const profileAvatar = useUserProfileStore((s) => s.avatarEmoji);
  const loadProfile = useUserProfileStore((s) => s.load);
  const gamification = useGamification();
  const social = useSocialStore();

  const weekActiveDates = useTimerStore(s => s.weekActiveDates);

  const xp = gamification.xp;
  const currentRank = getRank(xp);
  const xpProgress = getXpProgressInRank(xp);
  const xpToNextRank = getXpToNextRank(xp);
  const currentRankIdx = RANK_ORDER.indexOf(currentRank);
  const nextRank: RankTier | null =
    currentRankIdx + 1 < RANK_ORDER.length ? RANK_ORDER[currentRankIdx + 1] : null;

  const [reduceMotion, setReduceMotion] = useState(false);
  const [streakState, setStreakState] = useState<StreakState>({
    currentStreak: gamification.currentStreak,
    longestStreak: gamification.longestStreak,
    studiedToday: false,
    thisWeekDays: Array(7).fill(false),
    streakAtRisk: false,
  });
  const [rankUpTier, setRankUpTier] = useState<RankTier | null>(null);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [showFriends, setShowFriends] = useState(false);

  const prevRankRef = useRef<RankTier>(currentRank);


  // Compute week dots and studiedToday from server-fetched activeDates
  const serverDerivedStreak = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekStart = getMonday(today);
    const thisWeekDays = Array<boolean>(7).fill(false);
    for (const dateStr of weekActiveDates) {
      const date = new Date(dateStr + 'T00:00:00');
      const diff = Math.floor((date.getTime() - weekStart.getTime()) / 86_400_000);
      if (diff >= 0 && diff < 7) thisWeekDays[diff] = true;
    }
    const studiedToday = weekActiveDates.includes(todayStr);
    const streakAtRisk = !studiedToday && today.getHours() >= 18 && gamification.currentStreak > 0;
    return { thisWeekDays, studiedToday, streakAtRisk };
  }, [weekActiveDates, gamification.currentStreak]);

  // (progressStats removed — achievement progress is now computed server-side
  // and returned by GET /achievements, so the client no longer recomputes it.)


  // Load data on mount
  useEffect(() => {
    gamification.fetchProfile();
    gamification.fetchAchievements();
    social.fetchUserSocialStats();
    social.fetchUserPosts();
    social.loadFriends();
    useTimerStore.getState().fetchWeekSessions();
    // Load the saved avatar/profile so the hero card matches settings & social.
    if (auth.user) loadProfile(auth.user.id, auth.user.username);
  }, [auth.user?.id]);

  // Reduced motion
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Streak state — compute from session history
  useEffect(() => {
    buildStreakState(gamification.currentStreak, gamification.longestStreak)
      .then(setStreakState);
  }, [gamification.currentStreak, gamification.longestStreak]);

  // Re-compute streak on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        buildStreakState(gamification.currentStreak, gamification.longestStreak)
          .then(setStreakState);
      }
    });
    return () => sub.remove();
  }, [gamification.currentStreak, gamification.longestStreak]);

  // Rank-up detection
  useEffect(() => {
    if (prevRankRef.current !== currentRank) {
      setRankUpTier(currentRank);
      const t = setTimeout(() => setRankUpTier(null), 2500);
      prevRankRef.current = currentRank;
      return () => clearTimeout(t);
    }
  }, [currentRank]);

  // Unlock celebration is handled app-wide by <UnlockOverlay /> in _layout.tsx.
  // It used to live here as a toast, which meant it only fired if the user
  // happened to be on the profile — sessions complete on the Timer tab.

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: Colors.bg }}
    >
      {/* Hero Card — fixed, does not scroll */}
      <HeroCard
        username={auth.user?.username ?? 'User'}
        avatarEmoji={profileAvatar || getAvatarEmoji(auth.user?.username ?? 'User')}
        xp={xp}
        level={gamification.level}
        rank={currentRank}
        totalSessions={gamification.totalSessions}
        totalFocusMinutes={gamification.totalFocusMinutes}
        longestStreak={gamification.longestStreak}
        xpProgress={xpProgress}
        xpToNextRank={xpToNextRank}
        nextRank={nextRank}
        reduceMotion={reduceMotion}
        onSettings={() => router.push('/settings')}
        socialStats={social.userSocialStats ? { ...social.userSocialStats, friendCount: social.friends.length } : null}
        onFollowersPress={() => { setShowFollowers(true); social.fetchFollowers(); }}
        onFollowingPress={() => { setShowFollowing(true); social.fetchFollowing(); }}
        onFriendsPress={() => { setShowFriends(true); social.loadFriends(); }}
      />

      {/* Scrollable sections */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <StreakSection streakState={{ ...streakState, ...serverDerivedStreak }} reduceMotion={reduceMotion} />
        <RankSection xp={xp} level={gamification.level} currentRank={currentRank} />

        <AchievementsRow />

        {/* Posts, formerly behind an Awards|Posts switcher. One scroll now:
            rank, then what you earned, then what you shared. */}
        <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={sectionLabel(Colors)}>Your Posts</Text>
        </View>
        <PostsPane
          posts={social.userPosts}
          isLoading={social.isLoadingUserPosts}
          hasMore={social.userPostsCursor !== null}
          onLoadMore={social.fetchMoreUserPosts}
          onPostPress={(post) => router.push(`/post/${post.id}`)}
        />
      </ScrollView>

      {/* Followers modal */}
      <UserListModal
        visible={showFollowers}
        title="Followers"
        items={social.followers}
        isLoading={social.isLoadingFollowers}
        onClose={() => setShowFollowers(false)}
        onItemPress={(item) => { setShowFollowers(false); router.push(`/user/${item.userId}` as never); }}
      />

      {/* Following modal */}
      <UserListModal
        visible={showFollowing}
        title="Following"
        items={social.following}
        isLoading={social.isLoadingFollowing}
        onClose={() => setShowFollowing(false)}
        onItemPress={(item) => { setShowFollowing(false); router.push(`/user/${item.userId}` as never); }}
      />

      {/* Friends modal */}
      <UserListModal
        visible={showFriends}
        title="Friends"
        items={social.friends.map(f => ({
          userId: f.id,
          displayName: f.username,
          handle: f.username.toLowerCase().replace(/\s/g, ''),
          avatarEmoji: f.avatarEmoji,
          rank: '',
        }))}
        isLoading={social.isLoadingFriends}
        onClose={() => setShowFriends(false)}
        onItemPress={(item) => { setShowFriends(false); router.push(`/user/${item.userId}` as never); }}
      />

      {/* Rank-up overlay */}
      {rankUpTier && (
        <RankUpOverlay tier={rankUpTier} reduceMotion={reduceMotion} />
      )}

    </SafeAreaView>
  );
}
