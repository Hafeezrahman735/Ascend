/**
 * Ascend — the landing tab.
 *
 * This is the screen formerly known as Circle/Social. It owns the (tabs) index
 * route on purpose: the app opens on what the people around you have been
 * doing, and the timer is one tap away at /(tabs)/focus rather than the front
 * door. The store, the API surface and every type below are unchanged — only
 * the route position and the name moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, ScrollView,
  TextInput, ActivityIndicator, Modal, RefreshControl,
  KeyboardAvoidingView, Platform, Share, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useSocialStore } from '../../stores/socialStore';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useGamification } from '../../store/hooks';
import { useTimerStore } from '../../stores/timerStore';
import { getSessionHistory, type SessionRecord } from '../../store/sync';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import { makePostTypeMeta, FREE_TAG_META } from '../../constants/socialTheme';
import { AscendWordmark } from '../../components/AscendMark';
import {
  RecapCardShell, RecapCardHeader, RecapCardLabel, RecapStats, RecapLine,
  type RecapStat,
} from '../../components/recap/RecapCard';
import { computeTodayRecap, isRecapEmpty, formatRecapDuration } from '../../lib/todayRecap';
import { useTaskStore } from '../../stores/taskStore';
import { useUserProfileStore } from '../../stores/userProfileStore';
import { getLocalDateString } from '../../utils/date';
import { Font } from '../../constants/typography';
import type { SocialPost, StudyGroup, FocusLeaderboardEntry, PostType, FreePostTag, AttachedStat } from '../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const AVATAR_EMOJIS = ['🦊','🐸','🦁','🐳','🦉','🐰','🦋','🐙','🦚','🐻','🦝','🐵'];
const REACTIONS = ['🔥','🫡','❤️','💪'] as const;

// Theme-aware group chip palettes, derived from the active Colors object.
function groupBg(c: ThemeColors): Record<string, string> {
  return { purple: c.primaryDim, teal: c.accentDim, amber: c.AMBER_DIM, rose: c.ROSE_DIM };
}
function groupBorderColor(c: ThemeColors): Record<string, string> {
  return { purple: c.primary, teal: c.accent, amber: c.AMBER, rose: c.ROSE };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAvatarEmoji(seed: string): string {
  let h = 0;
  for (const c of seed) h = ((h * 31) + c.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_EMOJIS[h % AVATAR_EMOJIS.length];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d}d ago`;
}

function formatFocusMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function isGoldRank(rank: string): boolean {
  return rank === 'Champion' || rank === 'Legend';
}

// ─── Focus Group chips ───────────────────────────────────────────────────────

function GroupChip({ group, selected, onPress }: {
  group: StudyGroup; selected: boolean; onPress: () => void;
}) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const GROUP_BG = groupBg(Colors);
  const GROUP_BORDER_COLOR = groupBorderColor(Colors);
  const border = selected ? Colors.primary : (GROUP_BORDER_COLOR[group.color] ?? Colors.border);
  const bg = GROUP_BG[group.color] ?? SURFACE;
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', marginRight: 12, width: 64 }}>
      <View style={{
        width: 44, height: 44, borderRadius: 14, backgroundColor: bg,
        borderWidth: selected ? 2 : 1, borderColor: border,
        alignItems: 'center', justifyContent: 'center',
        ...(selected ? { shadowColor: Colors.primary, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 } : {}),
      }}>
        <Text style={{ fontSize: 22 }}>{group.emoji}</Text>
        {group.hasRecentActivity && (
          <View style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: Colors.accent, borderWidth: 1.5, borderColor: Colors.bg,
          }} />
        )}
      </View>
      <Text numberOfLines={1} style={{ color: Colors.subtext, fontSize: 10, marginTop: 4, textAlign: 'center', width: 60 }}>
        {group.name}
      </Text>
    </Pressable>
  );
}

/**
 * The public feed as a chip, sitting first in the same row as the groups.
 * Where a post goes and where you read it are the same set of destinations, so
 * they belong in one strip. "No group selected" used to mean the public feed
 * implicitly, with nothing on screen saying so.
 */
function PublicFeedChip({ selected, onPress }: { selected: boolean; onPress: () => void }) {
  const Colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel="Public feed"
      style={{ alignItems: 'center', marginRight: 12, width: 64 }}
    >
      <View style={{
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: selected ? Colors.primary : Colors.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? Colors.primary : Colors.border,
        alignItems: 'center', justifyContent: 'center',
        ...(selected ? { shadowColor: Colors.primary, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 } : {}),
      }}>
        <Ionicons name="earth" size={22} color={selected ? '#fff' : Colors.subtext} />
      </View>
      <Text numberOfLines={1} style={{
        color: selected ? Colors.primarySoft : Colors.subtext,
        fontSize: 10, marginTop: 4, textAlign: 'center', width: 60,
        fontWeight: selected ? '700' : '400',
      }}>
        Public
      </Text>
    </Pressable>
  );
}

function JoinChip({ onPress }: { onPress: () => void }) {
  const Colors = useTheme();
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', marginRight: 12, width: 64 }}>
      <View style={{
        width: 44, height: 44, borderRadius: 14,
        borderWidth: 1.5, borderColor: Colors.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name="add" size={20} color={Colors.subtext} />
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 4 }}>Join</Text>
    </Pressable>
  );
}

// ─── Post type tag ───────────────────────────────────────────────────────────


function PostTypeTag({ type, contentTag }: { type: PostType; contentTag?: FreePostTag | null }) {
  const Colors = useTheme();
  const POST_TYPE_META = makePostTypeMeta(Colors);
  const base = POST_TYPE_META[type];
  const label = type === 'free_post' && contentTag
    ? `${FREE_TAG_META[contentTag].emoji} ${FREE_TAG_META[contentTag].label}`
    : base.label;
  return (
    <View style={{
      alignSelf: 'flex-start', backgroundColor: base.bg, borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8,
    }}>
      <Text style={{ color: base.color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ─── The stat row a post carries ─────────────────────────────────────────────

/**
 * Which numbers this post puts on its receipt.
 *
 * One function rather than a stat block per post type, because the row is the
 * card's constant: whatever kind of post it is, the reader looks in the same
 * place for "what did they actually do". A type with nothing to count returns
 * an empty row and the card simply has no stats — that is a valid post, not a
 * missing one.
 *
 * A count of 1 gets a singular label. "1 SESSIONS" on a card whose whole job is
 * to look like an honest receipt undoes a lot of that work for one character.
 */
function recapStatsFor(post: SocialPost): RecapStat[] {
  if (post.type === 'session_recap') {
    const sessions = post.sessionCount ?? 0;
    const stats: RecapStat[] = [
      { label: sessions === 1 ? 'SESSION' : 'SESSIONS', value: String(sessions) },
      { label: 'FOCUSED', value: formatFocusMinutes(post.focusMinutes ?? 0) },
    ];
    // Only on auto-generated daily recaps; a hand-written recap has no task count
    // and must not be given a fake zero.
    if (post.tasksCompleted != null) {
      stats.push({ label: post.tasksCompleted === 1 ? 'TASK DONE' : 'TASKS DONE', value: String(post.tasksCompleted) });
    }
    if (post.streakAtPost != null) {
      stats.push({ label: 'STREAK', value: `${post.streakAtPost}d`, emphasis: true });
    }
    return stats;
  }

  if (post.type === 'streak_milestone') {
    return [
      { label: 'STREAK', value: `${post.streakAtPost ?? 0}d`, emphasis: true },
      { label: 'SESSIONS', value: String(post.totalSessionsAtPost ?? 0) },
      { label: 'ALL-TIME FOCUS', value: `${post.totalFocusHoursAtPost ?? 0}h` },
    ];
  }

  // Whatever the author chose to attach to a written post.
  if (post.type === 'free_post') {
    return (post.attachedStats ?? []).map((s) => ({ label: s.label.toUpperCase(), value: s.value }));
  }

  return [];
}

// ─── Type-specific content blocks ────────────────────────────────────────────

function AchievementUnlockBlock({ post }: { post: SocialPost }) {
  const Colors = useTheme();
  const { GOLD, GOLD_DIM } = Colors;
  return (
    <View style={{
      backgroundColor: GOLD_DIM, borderRadius: 12, borderWidth: 1,
      borderColor: GOLD + '40', padding: 12, marginBottom: 10,
      flexDirection: 'row', alignItems: 'center',
    }}>
      <Text style={{ fontSize: 32, marginRight: 12 }}>{post.achievementIcon ?? '🏅'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: GOLD, fontWeight: '700', fontSize: 14 }}>{post.achievementName ?? 'Achievement'}</Text>
        {post.achievementDescription ? (
          <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>{post.achievementDescription}</Text>
        ) : null}
        {post.achievementXpReward != null && (
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 3 }}>
            +{post.achievementXpReward} XP{post.achievementRank ? ` · ${post.achievementRank} rank` : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

function AccountabilityBlock({ post }: { post: SocialPost }) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const ch = post.challenge;
  if (!ch) return null;
  const completed = Object.values(ch.memberProgress).reduce((a, b) => a + b, 0);
  const pct = ch.targetValue > 0 ? Math.min(100, Math.round((completed / ch.targetValue) * 100)) : 0;
  const dl = Math.ceil((new Date(ch.deadline).getTime() - Date.now()) / 86400000);
  return (
    <View style={{
      backgroundColor: Colors.accentDim, borderRadius: 12, borderWidth: 1,
      borderColor: Colors.accent + '40', padding: 12, marginBottom: 10,
    }}>
      <Text style={{ color: Colors.accent, fontWeight: '700', fontSize: 13, marginBottom: 6 }}>
        🎯 Group Challenge
      </Text>
      <Text style={{ color: Colors.textBright, fontSize: 13, marginBottom: 8 }}>{ch.title}</Text>
      <View style={{ backgroundColor: Colors.bg, borderRadius: 6, height: 6, marginBottom: 6 }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 6, backgroundColor: Colors.accent }} />
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 11 }}>
        {ch.metric === 'focus_hours'
          ? `${completed.toFixed(1)} / ${Number(ch.targetValue).toFixed(1)} focus hours`
          : `${completed} / ${ch.targetValue} sessions`}
        {` · ${pct}% · `}{dl > 0 ? `${dl} days left` : 'Deadline passed'}
      </Text>
      {(ch.memberEmojis ?? []).length > 0 && (
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          {(ch.memberEmojis ?? []).slice(0, 5).map((e, i) => (
            <View key={i} style={{
              width: 24, height: 24, borderRadius: 7, backgroundColor: SURFACE,
              alignItems: 'center', justifyContent: 'center', marginRight: 4,
            }}>
              <Text style={{ fontSize: 14 }}>{e}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Your own recap, today ───────────────────────────────────────────────────

/**
 * The card at the top of your feed.
 *
 * Drawn from the device's own session and task caches, never from the feed
 * response. Three things follow from that, and all three are the point:
 *
 *  - the landing screen is never empty, even for somebody who installed the app
 *    a minute ago and follows nobody;
 *  - it is correct the instant a session ends, rather than after the next feed
 *    fetch happens to come back;
 *  - it works offline.
 *
 * The server writes an equivalent post for other people to see. This is not
 * that post — it is the same day told locally, which is why the matching server
 * post is filtered out of the list below rather than rendered twice.
 */
function OwnRecapCard({ emoji, sessionCount, focusSeconds, tasksCompleted, streakDays, onStartSession }: {
  emoji: string;
  sessionCount: number;
  focusSeconds: number;
  tasksCompleted: number;
  streakDays: number;
  onStartSession: () => void;
}) {
  const Colors = useTheme();
  const empty = isRecapEmpty({ sessionCount, focusSeconds, tasksCompleted, streakDays });

  const stats: RecapStat[] = [
    { label: sessionCount === 1 ? 'SESSION' : 'SESSIONS', value: String(sessionCount) },
    { label: 'FOCUSED', value: formatRecapDuration(focusSeconds) },
    { label: tasksCompleted === 1 ? 'TASK DONE' : 'TASKS DONE', value: String(tasksCompleted) },
    { label: 'STREAK', value: `${streakDays}d`, emphasis: true },
  ];

  return (
    <RecapCardShell own>
      <RecapCardLabel text="YOUR TRACE · TODAY" />
      <RecapCardHeader
        emoji={emoji}
        name="You"
        meta={empty ? 'Nothing yet · Public' : 'Today · Public'}
      />

      {empty ? (
        // An invitation, not a scolding. The empty state is the first thing a
        // new user ever sees on this screen, and it should read as a door.
        <>
          <Text style={{ color: Colors.text, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
            No recap yet today. Run a session and it shows up here.
          </Text>
          <Pressable
            onPress={onStartSession}
            accessibilityRole="button"
            style={{
              alignSelf: 'flex-start', backgroundColor: Colors.primary,
              borderRadius: 20, paddingHorizontal: 18, paddingVertical: 9,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Start a session</Text>
          </Pressable>
        </>
      ) : (
        <>
          <RecapStats stats={stats} />
          <View style={{ marginTop: 11 }}><RecapLine /></View>
        </>
      )}
    </RecapCardShell>
  );
}

// ─── Header streak pill ──────────────────────────────────────────────────────

function StreakPill({ days }: { days: number }) {
  const Colors = useTheme();
  return (
    <View
      accessibilityLabel={`${days} day streak`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: Colors.accentDim, borderRadius: 9,
        paddingHorizontal: 10, paddingVertical: 6, marginRight: 10,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.accent }} />
      <Text style={{ color: Colors.accent, fontFamily: Font.monoMedium, fontSize: 12 }}>{days}d</Text>
    </View>
  );
}

// ─── Reaction row ────────────────────────────────────────────────────────────

function ReactionRow({ post, currentUserId, onToggle }: {
  post: SocialPost; currentUserId: string; onToggle: (emoji: string) => void;
}) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const { BORDER_SOFT } = Colors;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {REACTIONS.map((emoji) => {
        const count = (post.reactions[emoji] ?? []).length;
        const reacted = (post.reactions[emoji] ?? []).includes(currentUserId);
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: reacted ? Colors.primaryDim : SURFACE,
              borderWidth: 1, borderColor: reacted ? Colors.primary : BORDER_SOFT,
              borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6,
            }}
          >
            <Text style={{ fontSize: 13 }}>{emoji}</Text>
            {count > 0 && (
              <Text style={{ color: reacted ? Colors.primarySoft : Colors.subtext, fontSize: 11, marginLeft: 4, fontWeight: '600' }}>
                {count}
              </Text>
            )}
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => Share.share({ message: 'Check out this study post!' })}
        style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}
      >
        <Ionicons name="share-outline" size={14} color={Colors.subtext} />
        <Text style={{ color: Colors.subtext, fontSize: 12, marginLeft: 4 }}>Share</Text>
      </Pressable>
    </View>
  );
}

// ─── Free Post block ─────────────────────────────────────────────────────────

/**
 * The photo on a written post. Any stats the author attached are drawn by the
 * card's own stat row (see recapStatsFor) rather than here, so every card puts
 * its numbers in the same place regardless of type.
 */
function FreePostBlock({ post }: { post: SocialPost }) {
  const [photoFullscreen, setPhotoFullscreen] = useState(false);
  if (!post.photoUrl) return null;

  return (
    <View style={{ marginBottom: 10 }}>
      <Pressable onPress={() => setPhotoFullscreen(true)}>
        <Image
          source={{ uri: post.photoUrl }}
          style={{ width: '100%', height: 220, borderRadius: 12 }}
          resizeMode="cover"
        />
      </Pressable>
      <Modal visible={photoFullscreen} transparent animationType="fade" onRequestClose={() => setPhotoFullscreen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000000EE', justifyContent: 'center' }} onPress={() => setPhotoFullscreen(false)}>
          <Image source={{ uri: post.photoUrl! }} style={{ width: '100%', height: '70%' }} resizeMode="contain" />
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Post card ───────────────────────────────────────────────────────────────

function PostCard({ post, currentUserId, onToggleReaction, onAuthorPress }: {
  post: SocialPost; currentUserId: string;
  onToggleReaction: (postId: string, emoji: string) => void;
  onAuthorPress?: (authorId: string) => void;
}) {
  const Colors = useTheme();
  const { BORDER_SOFT, GOLD } = Colors;
  const rankColor = isGoldRank(post.authorRank) ? GOLD : Colors.primarySoft;
  const isOwnPost = post.authorId === currentUserId;

  const handleReport = () => {
    Alert.alert(
      'Report Post',
      'Report this post as inappropriate? Our team will review it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            await api.post(`/social/posts/${post.id}/report`, { reason: 'inappropriate' });
            Alert.alert('Reported', 'Thanks — we\'ll review this post.');
          },
        },
      ],
    );
  };

  // A daily recap is drawn as the receipt itself: its numbers ARE the post, so
  // it gets no type tag and no pill block above them. Every other type keeps its
  // own body and simply sits inside the same frame.
  const isDailyRecap = post.type === 'session_recap' && post.auto === true;
  const stats = recapStatsFor(post);

  return (
    <RecapCardShell>
      <Pressable onPress={() => onAuthorPress?.(post.authorId)}>
        <RecapCardHeader
          emoji={post.authorEmoji || getAvatarEmoji(post.authorId)}
          name={post.authorName}
          meta={`${timeAgo(post.createdAt)}${post.groupName ? ` · ${post.groupName}` : ' · Public'}`}
          trailing={
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{
                backgroundColor: rankColor + '22', borderRadius: 7,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ color: rankColor, fontSize: 10, fontWeight: '600' }}>{post.authorRank}</Text>
              </View>
              {!isOwnPost && (
                <Pressable
                  onPress={handleReport}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ padding: 4, marginLeft: 6 }}
                  accessibilityLabel="Report post"
                >
                  <Ionicons name="flag-outline" size={16} color={Colors.subtext} />
                </Pressable>
              )}
            </View>
          }
        />
      </Pressable>

      {!isDailyRecap && <PostTypeTag type={post.type} contentTag={post.contentTag} />}

      {post.caption ? (
        <Text style={{ color: Colors.text, fontSize: 13, marginBottom: 10, lineHeight: 19 }}>
          {post.caption}
        </Text>
      ) : null}

      {post.type === 'achievement_unlock' && <AchievementUnlockBlock post={post} />}
      {post.type === 'accountability'     && <AccountabilityBlock post={post} />}
      {post.type === 'free_post'          && <FreePostBlock post={post} />}

      {stats.length > 0 && (
        <>
          <RecapStats stats={stats} />
          <View style={{ marginTop: 11 }}><RecapLine /></View>
        </>
      )}

      <View style={{ height: 1, backgroundColor: BORDER_SOFT, marginVertical: 11 }} />

      <ReactionRow
        post={post}
        currentUserId={currentUserId}
        onToggle={(emoji) => onToggleReaction(post.id, emoji)}
      />
    </RecapCardShell>
  );
}

// ─── Leaderboard podium ──────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];
const PODIUM_HEIGHTS = [48, 36, 28];
const PODIUM_ORDER = [1, 0, 2];

function PodiumEntry({ entry, pos }: { entry: FocusLeaderboardEntry; pos: number }) {
  const Colors = useTheme();
  const RAISED = Colors.raised;
  const { BORDER_SOFT, GOLD } = Colors;
  const isFirst = pos === 0;
  const borderColor = pos === 0 ? GOLD : pos === 1 ? '#C0C0C080' : '#CD7F3280';
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 12, marginBottom: 4 }}>{MEDALS[pos]}</Text>
      <View style={{
        width: 44, height: 44, borderRadius: 13, backgroundColor: RAISED,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: isFirst ? 2 : 1, borderColor,
        ...(isFirst ? { shadowColor: GOLD, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 } : {}),
      }}>
        <Text style={{ fontSize: 22 }}>{entry.avatarEmoji}</Text>
      </View>
      <Text numberOfLines={1} style={{
        color: Colors.textBright, fontSize: 11, fontWeight: '600',
        marginTop: 4, width: 64, textAlign: 'center',
      }}>
        {entry.displayName}
      </Text>
      <Text style={{ color: isFirst ? GOLD : Colors.text, fontSize: 12, fontWeight: '700' }}>
        {formatFocusMinutes(entry.focusMinutes)}
      </Text>
      <View style={{
        width: '75%', height: PODIUM_HEIGHTS[pos], borderRadius: 6, marginTop: 4,
        backgroundColor: isFirst ? GOLD + '28' : RAISED,
        borderWidth: 1, borderColor: isFirst ? GOLD + '50' : BORDER_SOFT,
      }} />
    </View>
  );
}

function PodiumBlock({ entries }: { entries: FocusLeaderboardEntry[] }) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const { BORDER_SOFT } = Colors;
  const top3 = entries.slice(0, 3);
  const ordered = PODIUM_ORDER.map((i) => top3[i]).filter(Boolean) as FocusLeaderboardEntry[];
  return (
    <View style={{
      backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1, borderColor: BORDER_SOFT,
      marginHorizontal: 16, marginBottom: 12, padding: 16, paddingTop: 20,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
        {ordered.map((e, i) => (
          <PodiumEntry key={e.userId} entry={e} pos={PODIUM_ORDER[i]} />
        ))}
      </View>
    </View>
  );
}

// ─── Leaderboard list row ────────────────────────────────────────────────────

function LeaderboardListRow({ entry }: { entry: FocusLeaderboardEntry }) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const RAISED = Colors.raised;
  const { GOLD, ROSE } = Colors;
  const posColor = entry.position <= 5 ? Colors.primarySoft : Colors.subtext;
  const rankColor = isGoldRank(entry.rank) ? GOLD : Colors.primarySoft;
  const delta = entry.positionDelta;
  const deltaColor = delta == null ? Colors.subtext : delta > 0 ? Colors.accent : delta < 0 ? ROSE : Colors.subtext;
  const deltaText = delta == null ? null : delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '–';

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 11, paddingHorizontal: 16,
      backgroundColor: entry.isMe ? RAISED : 'transparent',
      borderWidth: entry.isMe ? 1 : 0, borderColor: Colors.primary,
      borderRadius: entry.isMe ? 12 : 0,
      marginHorizontal: entry.isMe ? 12 : 0,
      marginVertical: entry.isMe ? 4 : 0,
    }}>
      <Text style={{ color: posColor, fontSize: 13, fontWeight: '700', width: 26 }}>
        #{entry.position}
      </Text>
      <View style={{
        width: 32, height: 32, borderRadius: 9, backgroundColor: SURFACE,
        alignItems: 'center', justifyContent: 'center', marginRight: 10,
      }}>
        <Text style={{ fontSize: 18 }}>{entry.avatarEmoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 13 }}>{entry.displayName}</Text>
          {entry.isMe && (
            <View style={{ marginLeft: 5, backgroundColor: Colors.primaryDim, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: Colors.primary, fontSize: 9, fontWeight: '700' }}>YOU</Text>
            </View>
          )}
          <View style={{ marginLeft: 5, backgroundColor: rankColor + '22', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: rankColor, fontSize: 9, fontWeight: '600' }}>{entry.rank}</Text>
          </View>
        </View>
        <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 1 }}>{entry.currentStreak}d streak</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '700' }}>
          {formatFocusMinutes(entry.focusMinutes)}
        </Text>
        {deltaText && (
          <Text style={{ color: deltaColor, fontSize: 11 }}>{deltaText}</Text>
        )}
      </View>
    </View>
  );
}

// ─── Next target card ────────────────────────────────────────────────────────

function NextTargetCard({ me, above }: {
  me: FocusLeaderboardEntry | null; above: FocusLeaderboardEntry | null;
}) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const { BORDER_SOFT, GOLD, GOLD_DIM } = Colors;
  if (!me) return null;

  if (me.position === 1) {
    return (
      <View style={{
        marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14,
        borderWidth: 1, borderColor: GOLD + '60', backgroundColor: GOLD_DIM,
      }}>
        <Text style={{ color: GOLD, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>
          👑 You're at the top. Keep going.
        </Text>
      </View>
    );
  }

  if (me.focusMinutes === 0) {
    return (
      <View style={{
        marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14,
        backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SOFT,
      }}>
        <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center' }}>
          Start studying to appear on the leaderboard
        </Text>
      </View>
    );
  }

  if (!above || above.focusMinutes === 0) return null;
  const gap = Math.max(0, above.focusMinutes - me.focusMinutes);
  const pct = Math.min(99, Math.round((me.focusMinutes / above.focusMinutes) * 100));

  return (
    <View style={{
      marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14,
      backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SOFT,
    }}>
      <Text style={{ color: Colors.subtext, fontSize: 11, marginBottom: 4 }}>🎯 Next target</Text>
      <Text style={{ color: Colors.textBright, fontSize: 13, marginBottom: 10 }}>
        {'You need '}
        <Text style={{ color: Colors.primarySoft, fontWeight: '700' }}>{formatFocusMinutes(gap)}</Text>
        {' more to pass '}
        <Text style={{ fontWeight: '700' }}>{above.displayName}</Text>
        {` (#${above.position})`}
      </Text>
      <View style={{ backgroundColor: Colors.bg, borderRadius: 6, height: 6, marginBottom: 8 }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 6, backgroundColor: Colors.primary }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: Colors.subtext, fontSize: 11 }}>You · {formatFocusMinutes(me.focusMinutes)}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 11 }}>{above.displayName} · {formatFocusMinutes(above.focusMinutes)}</Text>
      </View>
    </View>
  );
}

// ─── Create post sheet ───────────────────────────────────────────────────────

const POST_TYPE_CARDS: { type: PostType; icon: string; label: string; desc: string; comingSoon?: boolean }[] = [
  { type: 'free_post',          icon: '✏️', label: 'Share something',                 desc: 'Write a free post with optional stats' },
  { type: 'session_recap',      icon: '⚡', label: 'Share a session recap',           desc: 'Show off your recent focus block' },
  { type: 'achievement_unlock', icon: '🏅', label: 'Share an achievement',            desc: 'Celebrate a milestone you unlocked' },
  { type: 'streak_milestone',   icon: '🔥', label: 'Share a streak milestone',        desc: 'Brag about your consistency' },
];

const FREE_TAGS = Object.entries(FREE_TAG_META) as [FreePostTag, { emoji: string; label: string }][];

function ShareToRow({ visibility, setVisibility, targetGroupId, setTargetGroupId, studyGroups }: {
  visibility: 'public' | 'group';
  setVisibility: (v: 'public' | 'group') => void;
  targetGroupId: string | null;
  setTargetGroupId: (id: string | null) => void;
  studyGroups: StudyGroup[];
}) {
  const Colors = useTheme();
  const RAISED = Colors.raised;
  const { BORDER_SOFT } = Colors;
  return (
    <>
      <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Share to</Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        {(['public', 'group'] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setVisibility(v)}
            style={{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginRight: 8,
              backgroundColor: visibility === v ? Colors.primary : RAISED,
              borderWidth: 1, borderColor: visibility === v ? Colors.primary : BORDER_SOFT,
            }}
          >
            <Text style={{ color: visibility === v ? '#fff' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>
              {v === 'public' ? 'Public' : 'Focus Group'}
            </Text>
          </Pressable>
        ))}
      </View>
      {visibility === 'group' && studyGroups.length === 0 && (
        <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 12 }}>
          You are not in any focus groups yet. Join one to post there.
        </Text>
      )}
      {visibility === 'group' && studyGroups.length > 0 && !targetGroupId && (
        <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 8 }}>
          Pick a group to post in.
        </Text>
      )}
      {visibility === 'group' && studyGroups.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {studyGroups.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => setTargetGroupId(g.id)}
              style={{
                flexDirection: 'row', alignItems: 'center', marginRight: 8,
                backgroundColor: targetGroupId === g.id ? Colors.primaryDim : RAISED,
                borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
                borderWidth: 1, borderColor: targetGroupId === g.id ? Colors.primary : BORDER_SOFT,
              }}
            >
              <Text style={{ fontSize: 16, marginRight: 6 }}>{g.emoji}</Text>
              <Text style={{ color: Colors.text, fontSize: 12 }}>{g.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </>
  );
}

function CreatePostSheet({ visible, onClose, onPost, studyGroups, defaultGroupId }: {
  visible: boolean;
  onClose: () => void;
  onPost: (draft: Partial<SocialPost>) => void;
  studyGroups: StudyGroup[];
  /** The group being read right now, if any. Becomes the default destination. */
  defaultGroupId: string | null;
}) {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const RAISED = Colors.raised;
  const { BORDER_SOFT, ROSE, ROSE_DIM, GOLD, GOLD_DIM } = Colors;
  const gamification = useGamification();
  const lastCompletedSessionId = useTimerStore((s) => s.lastCompletedSessionId);

  const [step,          setStep]          = useState<1 | 2>(1);
  const [selectedType,  setSelectedType]  = useState<PostType | null>(null);
  const [caption,       setCaption]       = useState('');
  const [visibility,    setVisibility]    = useState<'public' | 'group'>('public');
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);

  // Opening the composer while reading a group means you almost certainly want
  // to post there. Preselect it, but leave both destinations switchable.
  useEffect(() => {
    if (!visible) return;
    setVisibility(defaultGroupId ? 'group' : 'public');
    setTargetGroupId(defaultGroupId);
  }, [visible, defaultGroupId]);

  // Free post state
  const [freeText,             setFreeText]             = useState('');
  const [selectedTag,          setSelectedTag]          = useState<FreePostTag | null>(null);
  const [photoUri,             setPhotoUri]             = useState<string | null>(null);
  const [showStats,            setShowStats]            = useState(false);
  const [checkedStats,         setCheckedStats]         = useState<string[]>([]);
  const [textError,            setTextError]            = useState(false);
  const [statsError,           setStatsError]           = useState(false);
  const [todayCount,           setTodayCount]           = useState(0);
  const [todayMinutes,         setTodayMinutes]         = useState(0);
  const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null);
  const freeTextRef = useRef<TextInput>(null);

  const unlockedAchievements = gamification.achievements.filter((a) => a.isUnlocked);
  const hasUnlockedAchievements = unlockedAchievements.length > 0;

  const availableStats = [
    { key: 'sessions_today', label: 'Sessions today',    value: String(todayCount) },
    { key: 'focus_today',    label: 'Focus time today',  value: formatFocusMinutes(todayMinutes) },
    { key: 'streak',         label: 'Current streak',    value: `${gamification.currentStreak} days` },
    { key: 'total_sessions', label: 'Total sessions',    value: String(gamification.totalSessions) },
    { key: 'total_focus',    label: 'Total focus',       value: `${Math.floor((gamification.totalFocusMinutes ?? 0) / 60)}h` },
  ];

  useEffect(() => {
    if (visible && selectedType === 'free_post') {
      getSessionHistory().then((sessions) => {
        const today = new Date().toDateString();
        const ts = sessions.filter((s) => new Date(s.completedAt).toDateString() === today && s.type === 'focus');
        setTodayCount(ts.length);
        setTodayMinutes(Math.round(ts.reduce((sum, s) => sum + s.durationSeconds / 60, 0)));
      }).catch(() => {});
    }
  }, [visible, selectedType]);

  // Choosing "Focus Group" without picking one sent groupId:null and the server
  // answered 400. Block it in the composer instead of surfacing a raw failure.
  const destinationMissing = visibility === 'group' && !targetGroupId;

  const reset = () => {
    setStep(1); setSelectedType(null); setCaption('');
    setVisibility(defaultGroupId ? 'group' : 'public'); setTargetGroupId(defaultGroupId);
    setFreeText(''); setSelectedTag(null); setPhotoUri(null);
    setShowStats(false); setCheckedStats([]);
    setTextError(false); setStatsError(false);
    setSelectedAchievementId(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSelectType = (type: PostType) => {
    setSelectedType(type);
    setStep(2);
    if (type === 'free_post') setTimeout(() => freeTextRef.current?.focus(), 300);
  };

  const toggleStat = (key: string) => {
    setCheckedStats((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    setStatsError(false);
  };

  const handlePost = () => {
    if (destinationMissing) return;
    if (selectedType === 'free_post') {
      if (!freeText.trim()) { setTextError(true); return; }
      if (showStats && checkedStats.length === 0) { setStatsError(true); return; }
      const attachedStats: AttachedStat[] | null = showStats && checkedStats.length > 0
        ? availableStats.filter((s) => checkedStats.includes(s.key)).map((s) => ({ label: s.label, value: s.value }))
        : null;
      onPost({ type: 'free_post', caption: freeText.trim(), contentTag: selectedTag, photoUrl: photoUri, attachedStats, visibility, groupId: visibility === 'group' ? targetGroupId : null, reactions: {} });
      handleClose();
    } else {
      if (!selectedType) return;
      if (selectedType === 'achievement_unlock' && !selectedAchievementId) return;
      const draft: Record<string, unknown> = {
        type: selectedType,
        caption: caption.trim() || null,
        visibility,
        groupId: visibility === 'group' ? targetGroupId : null,
        reactions: {},
      };
      if (selectedType === 'session_recap') draft.sessionId = lastCompletedSessionId;
      if (selectedType === 'achievement_unlock') draft.achievementId = selectedAchievementId;
      if (selectedType === 'streak_milestone') draft.streakAtPost = gamification.currentStreak;
      onPost(draft as Partial<SocialPost>);
      handleClose();
    }
  };

  const canPost = !destinationMissing && (selectedType === 'free_post'
    ? freeText.trim().length > 0 && (!showStats || checkedStats.length > 0)
    : selectedType === 'achievement_unlock'
    ? !!selectedAchievementId
    : true);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={handleClose} />
        <View style={{ backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '78%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
            {step === 2 && (
              <Pressable onPress={() => setStep(1)} style={{ marginRight: 10 }}>
                <Ionicons name="chevron-back" size={22} color={Colors.text} />
              </Pressable>
            )}
            <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', flex: 1 }}>
              {step === 1 ? 'What do you want to share?' : 'Compose post'}
            </Text>
            <Pressable onPress={handleClose}>
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
            {/* ── Step 1: type selection ── */}
            {step === 1 && POST_TYPE_CARDS.map(({ type, icon, label, desc, comingSoon }) => {
              const isAchievementDisabled = type === 'achievement_unlock' && !hasUnlockedAchievements;
              const isDisabled = isAchievementDisabled || !!comingSoon;
              return (
                <Pressable
                  key={type}
                  onPress={() => !isDisabled && handleSelectType(type)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', backgroundColor: RAISED,
                    borderRadius: 14, borderWidth: 1, borderColor: BORDER_SOFT,
                    padding: 14, marginBottom: 10,
                    opacity: isDisabled ? 0.45 : 1,
                  }}
                >
                  <Text style={{ fontSize: 28, marginRight: 14 }}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 14 }}>{label}</Text>
                    <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>
                      {isAchievementDisabled ? 'Complete an achievement to share it' : comingSoon ? 'Coming soon' : desc}
                    </Text>
                  </View>
                  {!isDisabled && <Ionicons name="chevron-forward" size={18} color={Colors.subtext} />}
                </Pressable>
              );
            })}

            {/* ── Step 2: Free Post compose ── */}
            {step === 2 && selectedType === 'free_post' && (
              <>
                <TextInput
                  ref={freeTextRef}
                  multiline maxLength={280}
                  placeholder="What's on your mind?"
                  placeholderTextColor={Colors.subtext}
                  value={freeText}
                  onChangeText={(t) => { setFreeText(t); setTextError(false); }}
                  style={{
                    backgroundColor: RAISED, borderRadius: 12,
                    borderWidth: 1, borderColor: textError ? ROSE : BORDER_SOFT,
                    padding: 12, color: Colors.textBright, fontSize: 14, minHeight: 100,
                    textAlignVertical: 'top', marginBottom: 4,
                  }}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
                  {textError
                    ? <Text style={{ color: ROSE, fontSize: 11 }}>Write something to post</Text>
                    : <View />}
                  <Text style={{ color: Colors.subtext, fontSize: 11 }}>{freeText.length}/280</Text>
                </View>

                {/* Content tag selector */}
                <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Add a tag (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                  {FREE_TAGS.map(([key, meta]) => {
                    const active = selectedTag === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setSelectedTag(active ? null : key)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', marginRight: 8,
                          backgroundColor: active ? ROSE_DIM : RAISED,
                          borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
                          borderWidth: 1, borderColor: active ? ROSE : BORDER_SOFT,
                        }}
                      >
                        <Text style={{ fontSize: 14, marginRight: 5 }}>{meta.emoji}</Text>
                        <Text style={{ color: active ? ROSE : Colors.subtext, fontSize: 12, fontWeight: active ? '600' : '400' }}>
                          {meta.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Attach stats */}
                <Pressable
                  onPress={() => { setShowStats((v) => !v); setCheckedStats([]); setStatsError(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: RAISED, borderRadius: 12, borderWidth: 1, borderColor: BORDER_SOFT,
                    padding: 12, marginBottom: showStats ? 0 : 14,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="stats-chart-outline" size={18} color={Colors.text} />
                    <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '600', marginLeft: 10 }}>Attach my stats</Text>
                  </View>
                  <View style={{
                    width: 40, height: 22, borderRadius: 11,
                    backgroundColor: showStats ? Colors.primary : Colors.inactive,
                    justifyContent: 'center', paddingHorizontal: 2,
                  }}>
                    <View style={{
                      width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff',
                      alignSelf: showStats ? 'flex-end' : 'flex-start',
                    }} />
                  </View>
                </Pressable>

                {showStats && (
                  <View style={{
                    backgroundColor: RAISED, borderRadius: 12, borderWidth: 1,
                    borderColor: BORDER_SOFT, borderTopWidth: 0,
                    borderTopLeftRadius: 0, borderTopRightRadius: 0,
                    padding: 12, marginBottom: 14,
                  }}>
                    {availableStats.map((s) => (
                      <Pressable
                        key={s.key}
                        onPress={() => toggleStat(s.key)}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}
                      >
                        <View style={{
                          width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                          borderColor: checkedStats.includes(s.key) ? Colors.primary : Colors.border,
                          backgroundColor: checkedStats.includes(s.key) ? Colors.primary : 'transparent',
                          alignItems: 'center', justifyContent: 'center', marginRight: 12,
                        }}>
                          {checkedStats.includes(s.key) && <Ionicons name="checkmark" size={12} color="#fff" />}
                        </View>
                        <Text style={{ color: Colors.text, fontSize: 13, flex: 1 }}>{s.label}</Text>
                        <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '600' }}>{s.value}</Text>
                      </Pressable>
                    ))}
                    {statsError && (
                      <Text style={{ color: ROSE, fontSize: 11, marginTop: 4 }}>Select at least one stat to attach</Text>
                    )}
                  </View>
                )}

                <ShareToRow
                  visibility={visibility} setVisibility={setVisibility}
                  targetGroupId={targetGroupId} setTargetGroupId={setTargetGroupId}
                  studyGroups={studyGroups}
                />

                <Pressable
                  onPress={handlePost}
                  disabled={!canPost}
                  style={{
                    backgroundColor: canPost ? Colors.primary : Colors.inactive,
                    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                  }}
                >
                  <Text style={{ color: canPost ? '#fff' : Colors.subtext, fontWeight: '700', fontSize: 15 }}>Post</Text>
                </Pressable>
              </>
            )}

            {/* ── Step 2: Other post types ── */}
            {step === 2 && selectedType && selectedType !== 'free_post' && (
              <>
                <View style={{
                  backgroundColor: RAISED, borderRadius: 12, borderWidth: 1,
                  borderColor: BORDER_SOFT, padding: 12, marginBottom: 12,
                }}>
                  <PostTypeTag type={selectedType} />
                  <Text style={{ color: Colors.subtext, fontSize: 12 }}>
                    {selectedType === 'session_recap'
                      ? 'Your most recent session stats will be shared automatically.'
                      : selectedType === 'achievement_unlock'
                      ? 'Select an achievement to feature below.'
                      : selectedType === 'streak_milestone'
                      ? 'Your current streak stats will be shared.'
                      : 'Invite your group to a shared challenge.'}
                  </Text>
                </View>

                {selectedType === 'achievement_unlock' && (
                  <View style={{ marginBottom: 12 }}>
                    {unlockedAchievements.map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => setSelectedAchievementId(a.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: selectedAchievementId === a.id ? GOLD_DIM : RAISED,
                          borderRadius: 12, borderWidth: 1,
                          borderColor: selectedAchievementId === a.id ? GOLD : BORDER_SOFT,
                          padding: 12, marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontSize: 26, marginRight: 12 }}>{a.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: Colors.textBright, fontWeight: '600', fontSize: 13 }}>{a.title}</Text>
                          <Text style={{ color: Colors.subtext, fontSize: 11 }} numberOfLines={1}>{a.description}</Text>
                        </View>
                        {selectedAchievementId === a.id && (
                          <Ionicons name="checkmark-circle" size={20} color={GOLD} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}

                <TextInput
                  multiline maxLength={280}
                  placeholder="Add a caption... (optional)"
                  placeholderTextColor={Colors.subtext}
                  value={caption}
                  onChangeText={setCaption}
                  style={{
                    backgroundColor: RAISED, borderRadius: 12, borderWidth: 1, borderColor: BORDER_SOFT,
                    padding: 12, color: Colors.textBright, fontSize: 14, minHeight: 80,
                    textAlignVertical: 'top', marginBottom: 4,
                  }}
                />
                <Text style={{ color: Colors.subtext, fontSize: 11, textAlign: 'right', marginBottom: 14 }}>
                  {caption.length}/280
                </Text>

                <ShareToRow
                  visibility={visibility} setVisibility={setVisibility}
                  targetGroupId={targetGroupId} setTargetGroupId={setTargetGroupId}
                  studyGroups={studyGroups}
                />

                <Pressable
                  onPress={handlePost}
                  disabled={destinationMissing}
                  style={{
                    backgroundColor: destinationMissing ? Colors.inactive : Colors.primary,
                    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                  }}
                >
                  <Text style={{
                    color: destinationMissing ? Colors.subtext : '#fff', fontWeight: '700', fontSize: 15,
                  }}>Post</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

const SCOPES = [
  { key: 'friends', label: 'Friends' },
  { key: 'global',  label: 'Global' },
] as const;

type Scope = typeof SCOPES[number]['key'];

// The board is all-time only. The month/all-time toggle was removed, so this is
// the single value sent to the server; the endpoint still takes the parameter.
const LEADERBOARD_PERIOD = 'all_time';

export default function AscendScreen() {
  const Colors = useTheme();
  const SURFACE = Colors.surface;
  const { BORDER_SOFT, ROSE } = Colors;
  /**
   * Selected fields, not the whole store.
   *
   * This screen is 1600+ lines and it subscribed to ALL of socialStore — posts,
   * groups, notifications, followers, following, leaderboards and five loading
   * flags in one flat object. Any change to any of them re-rendered the entire
   * tab, including the composer modal and the own-recap card, whether or not the
   * thing that changed was on screen.
   *
   * useShallow compares the picked fields one level deep, so a re-render happens
   * when one of THESE changes and not otherwise. The shape is kept identical so
   * the body below reads exactly as it did.
   */
  const social = useSocialStore(
    useShallow((s) => ({
      posts: s.posts,
      postsCursor: s.postsCursor,
      studyGroups: s.studyGroups,
      selectedGroupId: s.selectedGroupId,
      // Added after this selector was introduced. A field the screen reads but
      // the selector omits is invisible to tsc only until it is dereferenced —
      // it typechecks as a missing property, which is how this was caught.
      feedScope: s.feedScope,
      setFeedScope: s.setFeedScope,
      notifications: s.notifications,
      unreadCount: s.unreadCount,
      isLoading: s.isLoading,
      focusLeaderboard: s.focusLeaderboard,
      myFocusEntry: s.myFocusEntry,
      fetchPosts: s.fetchPosts,
      fetchMorePosts: s.fetchMorePosts,
      fetchStudyGroups: s.fetchStudyGroups,
      fetchFocusLeaderboard: s.fetchFocusLeaderboard,
      fetchNotifications: s.fetchNotifications,
      markNotificationsRead: s.markNotificationsRead,
      setSelectedGroup: s.setSelectedGroup,
      toggleReaction: s.toggleReaction,
      createPost: s.createPost,
    })),
  );
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const router      = useRouter();

  const [activeTab,          setActiveTab]          = useState<'feed' | 'leaderboard'>('feed');
  const [showCreatePost,     setShowCreatePost]     = useState(false);
  const [showNotifications,  setShowNotifications]  = useState(false);
  const [refreshing,         setRefreshing]         = useState(false);
  const [scope,              setScope]              = useState<Scope>('global');

  useEffect(() => {
    social.fetchPosts(social.selectedGroupId ?? undefined);
    social.fetchStudyGroups();
    social.fetchFocusLeaderboard(scope, LEADERBOARD_PERIOD);
    social.fetchNotifications();
  }, []);

  // ── Your own day, read locally ────────────────────────────────────────────
  // See OwnRecapCard for why this is computed on the device rather than fetched.
  const gamification = useGamification();
  const tasks = useTaskStore((s) => s.tasks);
  const profileAvatar = useUserProfileStore((s) => s.avatarEmoji);
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);

  // Re-read whenever the screen regains focus: a session finished on the Focus
  // tab writes to this cache, and coming back here must show it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getSessionHistory().then((s) => { if (!cancelled) setSessionHistory(s); });
      return () => { cancelled = true; };
    }, []),
  );

  const todayRecap = useMemo(
    () => computeTodayRecap({ sessionHistory, tasks, currentStreak: gamification.currentStreak }),
    [sessionHistory, tasks, gamification.currentStreak],
  );

  /**
   * The feed minus the server's copy of the card already drawn at the top.
   *
   * Without this the user sees their own day twice — once locally and once as
   * it came back from /social/posts — which looks like a duplicate-post bug
   * rather than a design. Only today's AUTO recap is dropped; a recap they wrote
   * by hand is a real post and stays in the list.
   */
  const feedPosts = useMemo(() => {
    const today = getLocalDateString();
    return social.posts.filter((p) => !(
      p.authorId === currentUserId
      && p.type === 'session_recap'
      && p.auto === true
      && p.localDate === today
    ));
  }, [social.posts, currentUserId]);

  useEffect(() => {
    social.fetchFocusLeaderboard(scope, LEADERBOARD_PERIOD);
  }, [scope]);

  const handleRefreshFeed = useCallback(async () => {
    setRefreshing(true);
    await social.fetchPosts(social.selectedGroupId ?? undefined);
    setRefreshing(false);
  }, [social.selectedGroupId]);

  /**
   * The destination strip has THREE states, not two.
   *
   *   Public chip on   -> every public post, from anyone      (the default)
   *   nothing on       -> only people you follow, plus you
   *   a group chip on  -> that group
   *
   * Every chip toggles. Tapping the one that is already lit turns it off, which
   * is how you reach the follow-only feed: it is the state where nothing is
   * selected, so it needs no chip of its own.
   *
   * Public is the default because a follow-scoped feed shows a new account
   * nothing at all — the tab used to open empty and stay empty until you went
   * looking for people to follow.
   */
  const showPublicFeed = () => {
    social.setSelectedGroup(null);
    social.setFeedScope('public');
    social.fetchPosts();
  };

  const showFollowingFeed = () => {
    social.setSelectedGroup(null);
    social.setFeedScope('following');
    social.fetchPosts();
  };

  const handleGroupSelect = (groupId: string | null) => {
    if (groupId === null) {
      // The Public chip: on if off, and off to Following if already on.
      if (isPublicFeed) showFollowingFeed(); else showPublicFeed();
      return;
    }
    if (social.selectedGroupId === groupId) {
      showFollowingFeed();
      return;
    }
    social.setSelectedGroup(groupId);
    social.fetchPosts(groupId);
  };

  const isPublicFeed = social.selectedGroupId === null && social.feedScope === 'public';
  const isFollowingFeed = social.selectedGroupId === null && social.feedScope === 'following';

  // Drives the context bar under the destination strip.
  const selectedGroup = social.selectedGroupId
    ? social.studyGroups.find((g) => g.id === social.selectedGroupId) ?? null
    : null;

  const handleToggleReaction = useCallback((postId: string, emoji: string) => {
    social.toggleReaction(postId, emoji, currentUserId);
  }, [currentUserId]);

  const handleAuthorPress = useCallback((authorId: string) => {
    router.push(`/user/${authorId}` as never);
  }, []);

  const handleCreatePost = useCallback(async (draft: Partial<SocialPost>) => {
    const ok = await social.createPost(draft);
    if (!ok) {
      Alert.alert('Post failed', 'Something went wrong. Please try again.');
    }
  }, []);

  const { focusLeaderboard, myFocusEntry } = social;
  const aboveMe = myFocusEntry && myFocusEntry.position > 1
    ? focusLeaderboard.find((e) => e.position === myFocusEntry.position - 1) ?? null
    : null;
  // The friends list always includes you, so "no friends to compare" means
  // there's nobody besides yourself — not length === 0.
  const friendsEmpty = focusLeaderboard.filter((e) => !e.isMe).length === 0;
  // The podium only renders with ≥3 entries and covers ranks 1–3. When there's
  // no podium (1–2 entries), the list must show every rank, otherwise ranks 1–3
  // would never be drawn and the board looks empty. In the friends scope, the
  // lone "you" row is suppressed in favour of the empty-state below.
  const hasPodium = focusLeaderboard.length >= 3;
  const listEntries = (scope === 'friends' && friendsEmpty)
    ? []
    : focusLeaderboard.filter((e) => (hasPodium ? e.position > 3 : true));

  // ── Feed tab ──────────────────────────────────────────────────────────────

  const renderFeed = () => (
    <View style={{ flex: 1 }}>
      {/* Destination strip: where you read is the same set of places you post to.
          The heading is gone because the row is no longer only groups. */}
      <View style={{ paddingTop: 12, paddingBottom: 4 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          <PublicFeedChip
            selected={isPublicFeed}
            onPress={() => handleGroupSelect(null)}
          />
          {social.studyGroups.map((g) => (
            <GroupChip
              key={g.id} group={g}
              selected={social.selectedGroupId === g.id}
              onPress={() => handleGroupSelect(g.id)}
            />
          ))}
          <JoinChip onPress={() => router.push('/groups' as never)} />
        </ScrollView>
      </View>

      {/* With a group selected, name it and offer the way into its details.
          Tapping the chip filters; this is how you reach members and settings. */}
      {selectedGroup && (
        <Pressable
          onPress={() => router.push(`/group/${selectedGroup.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Open details for ${selectedGroup.name}`}
          style={{
            flexDirection: 'row', alignItems: 'center',
            marginHorizontal: 16, marginTop: 10, marginBottom: 2,
            backgroundColor: SURFACE, borderRadius: 12,
            borderWidth: 1, borderColor: BORDER_SOFT,
            paddingHorizontal: 12, paddingVertical: 9,
          }}
        >
          <Text style={{ fontSize: 15, marginRight: 8 }}>{selectedGroup.emoji}</Text>
          <Text numberOfLines={1} style={{ flex: 1, color: Colors.textBright, fontSize: 13, fontWeight: '600' }}>
            {selectedGroup.name}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 11, marginRight: 6 }}>
            {selectedGroup.memberCount ?? selectedGroup.memberIds.length} members
          </Text>
          <Ionicons name="chevron-forward" size={15} color={Colors.subtext} />
        </Pressable>
      )}

      <FlatList
        data={feedPosts}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefreshFeed} tintColor={Colors.primary} />}
        onEndReached={() => { if (social.postsCursor) social.fetchMorePosts(); }}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={{ paddingTop: 8 }}>
            {/* Only on your own feed. Inside a group, the card would be claiming
                you posted today's recap there, which you may not have. */}
            {!social.selectedGroupId && (
              <OwnRecapCard
                emoji={profileAvatar || getAvatarEmoji(currentUserId)}
                sessionCount={todayRecap.sessionCount}
                focusSeconds={todayRecap.focusSeconds}
                tasksCompleted={todayRecap.tasksCompleted}
                streakDays={todayRecap.streakDays}
                onStartSession={() => router.push('/(tabs)/focus' as never)}
              />
            )}
          </View>
        }
        ListFooterComponent={
          social.postsCursor
            ? <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 16 }} />
            : <View style={{ height: 80 }} />
        }
        ListEmptyComponent={
          social.isLoading ? (
            <View style={{ paddingTop: 8 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ backgroundColor: SURFACE, borderRadius: 16, marginHorizontal: 16, marginBottom: 12, height: 130 }} />
              ))}
            </View>
          ) : (
            // Sits UNDER your own recap card, which is always drawn above. So
            // this is never the whole screen — it explains what is missing
            // (other people) rather than implying you have done nothing.
            <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 32 }}>
              <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
                {social.selectedGroupId ? 'No recaps in this group yet'
                  : isFollowingFeed ? 'Nobody you follow has posted'
                  : 'Nobody else here yet'}
              </Text>
              {/* Three empty states because they mean three different things.
                  An empty PUBLIC feed means the app is quiet. An empty
                  FOLLOWING feed means you follow nobody, or they are quiet —
                  and telling that user to go find people is the useful thing,
                  where telling it to someone on the open feed is not. */}
              <Text style={{ color: Colors.subtext, fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>
                {social.selectedGroupId ? 'Be the first to leave one.'
                  : isFollowingFeed ? 'Follow a few people, or tap the globe to see everyone.'
                  : 'Be the first to check in today.'}
              </Text>
              {isFollowingFeed && (
                <Pressable
                  onPress={() => router.push('/search' as never)}
                  accessibilityRole="button"
                  style={{
                    marginTop: 16, paddingHorizontal: 24, paddingVertical: 10,
                    backgroundColor: Colors.primary, borderRadius: 20,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Find people</Text>
                </Pressable>
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <PostCard post={item} currentUserId={currentUserId} onToggleReaction={handleToggleReaction} onAuthorPress={handleAuthorPress} />
        )}
      />
    </View>
  );

  // ── Leaderboard tab ───────────────────────────────────────────────────────

  const renderLeaderboard = () => (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={social.isLoading}
          onRefresh={() => social.fetchFocusLeaderboard(scope, LEADERBOARD_PERIOD)}
          tintColor={Colors.primary}
        />
      }
    >
      {/* Scope selector */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, marginBottom: 14 }}>
        {SCOPES.map(({ key, label }, i) => (
          <Pressable
            key={key}
            onPress={() => setScope(key)}
            style={{
              flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 20,
              backgroundColor: scope === key ? Colors.primary : SURFACE,
              borderWidth: 1, borderColor: scope === key ? Colors.primary : BORDER_SOFT,
              marginRight: i < SCOPES.length - 1 ? 8 : 0,
              ...(scope === key ? { shadowColor: Colors.primary, shadowOpacity: 0.4, shadowRadius: 6, elevation: 3 } : {}),
            }}
          >
            <Text style={{ color: scope === key ? '#fff' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Empty states */}
      {scope === 'friends' && friendsEmpty && !social.isLoading && (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 }}>
          <Ionicons name="people-outline" size={48} color={Colors.subtext} />
          <Text style={{ color: Colors.text, fontSize: 14, textAlign: 'center', marginTop: 16 }}>
            Follow people to see how you compare
          </Text>
        </View>
      )}

      {scope === 'global' && focusLeaderboard.length === 0 && !social.isLoading && (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 }}>
          <Ionicons name="trophy-outline" size={48} color={Colors.subtext} />
          <Text style={{ color: Colors.text, fontSize: 14, textAlign: 'center', marginTop: 16 }}>
            No one's on the leaderboard yet — finish a focus session to claim a spot
          </Text>
        </View>
      )}

      {social.isLoading && <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 32 }} />}

      {/* Podium */}
      {focusLeaderboard.length >= 3 && !social.isLoading && (
        <PodiumBlock entries={focusLeaderboard} />
      )}

      {/* Ranked list */}
      {listEntries.length > 0 && !social.isLoading && (
        <View style={{
          backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1,
          borderColor: BORDER_SOFT, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden',
        }}>
          {listEntries.map((entry, idx) => (
            <View key={entry.userId}>
              {idx > 0 && <View style={{ height: 1, backgroundColor: BORDER_SOFT, marginHorizontal: 16 }} />}
              <LeaderboardListRow entry={entry} />
            </View>
          ))}
          {myFocusEntry && myFocusEntry.position > 10 && (
            <>
              <View style={{ alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: Colors.subtext, letterSpacing: 4 }}>· · ·</Text>
              </View>
              <LeaderboardListRow entry={{ ...myFocusEntry, isMe: true }} />
            </>
          )}
        </View>
      )}

      <NextTargetCard me={myFocusEntry} above={aboveMe} />
      <View style={{ height: 80 }} />
    </ScrollView>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <AscendWordmark size={26} />
        </View>
        {/* Streak first, then the two actions. The number is the only thing in
            this cluster that is about you rather than about navigating. */}
        {gamification.currentStreak > 0 && <StreakPill days={gamification.currentStreak} />}
        <Pressable
          style={{ marginRight: 14 }}
          accessibilityRole="button"
          accessibilityLabel="Search people and groups"
          onPress={() => router.push('/search' as never)}
        >
          <Ionicons name="search" size={22} color={Colors.text} />
        </Pressable>
        <Pressable style={{ marginRight: 14 }} onPress={() => {
          social.markNotificationsRead();
          setShowNotifications(true);
        }}>
          <Ionicons name="notifications-outline" size={24} color={Colors.text} />
          {social.unreadCount > 0 && (
            <View style={{
              position: 'absolute', top: -2, right: -2,
              width: 8, height: 8, borderRadius: 4, backgroundColor: ROSE,
            }} />
          )}
        </Pressable>
      </View>

      {/* Tab switcher */}
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 4, backgroundColor: SURFACE, borderRadius: 24, padding: 4 }}>
        {([
          ['feed', 'Feed', 'newspaper-outline'],
          ['leaderboard', 'Leaderboard', 'podium-outline'],
        ] as const).map(([tab, label, icon]) => {
          const isActive = activeTab === tab;
          const tint = isActive ? '#fff' : Colors.subtext;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 8, borderRadius: 20,
                backgroundColor: isActive ? Colors.primary : 'transparent',
              }}
            >
              <Ionicons name={icon} size={14} color={tint} />
              <Text style={{ color: tint, fontSize: 13, fontWeight: '600' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, display: activeTab === 'feed' ? 'flex' : 'none' }}>
          {renderFeed()}
        </View>
        <View style={{ flex: 1, display: activeTab === 'leaderboard' ? 'flex' : 'none' }}>
          {renderLeaderboard()}
        </View>
      </View>

      {/* FAB — Feed tab only */}
      {activeTab === 'feed' && (
        <Pressable
          onPress={() => setShowCreatePost(true)}
          style={{
            position: 'absolute', bottom: 24, right: 20,
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
            shadowColor: Colors.primary, shadowOpacity: 0.6, shadowRadius: 14, elevation: 8,
          }}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </Pressable>
      )}

      {/* Notifications modal */}
      <Modal visible={showNotifications} transparent animationType="slide" onRequestClose={() => setShowNotifications(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '70%' }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
              <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>Notifications</Text>
              <Pressable onPress={() => setShowNotifications(false)}>
                <Ionicons name="close" size={22} color={Colors.subtext} />
              </Pressable>
            </View>
            {social.notifications.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ color: Colors.subtext, fontSize: 13 }}>No notifications yet</Text>
              </View>
            ) : (
              <FlatList
                data={social.notifications}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingBottom: 32 }}
                renderItem={({ item }) => (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: BORDER_SOFT }}>
                    <Text style={{ color: item.isRead ? Colors.subtext : Colors.textBright, fontSize: 14 }}>
                      {item.text}
                    </Text>
                    <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 4 }}>{timeAgo(item.createdAt)}</Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <CreatePostSheet
        visible={showCreatePost}
        onClose={() => setShowCreatePost(false)}
        onPost={handleCreatePost}
        studyGroups={social.studyGroups}
        defaultGroupId={social.selectedGroupId}
      />
    </SafeAreaView>
  );
}
