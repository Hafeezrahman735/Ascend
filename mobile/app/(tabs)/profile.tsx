import {
  useEffect, useRef, useState, useMemo,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
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
import { useGamification } from '../../store/hooks';
import { useTaskStore } from '../../stores/taskStore';
import { getSessionHistory } from '../../store/sync';
import { Colors } from '../../constants/Colors';
import {
  getRank, getXpToNextRank, getXpProgressInRank,
  RANK_ORDER, RANK_META, RANK_THRESHOLDS,
} from '../../lib/rank';
import type { RankTier } from '../../lib/rank';
import {
  ACHIEVEMENT_CATALOGUE,
  computeAchievementProgress,
} from '../../lib/achievements';
import type { CatalogEntry } from '../../lib/achievements';
import { computeSubjectBadges } from '../../lib/badges';
import type { StreakState, SubjectBadge } from '../../types/profile';

// ─── Local types ─────────────────────────────────────────────────────────────

type MergedAchievement = CatalogEntry & {
  isUnlocked: boolean;
  unlockedAt: string | null;
  progress: number;
};

// ─── Design tokens ───────────────────────────────────────────────────────────

const GOLD   = '#FFD700';
const GOLD_DIM = '#3A3000';
const AMBER  = '#FFB347';
const AMBER_DIM = '#3A2800';
const TEAL   = '#00E5C3';
const TEAL_DIM = '#003D35';
const ROSE_DIM = '#3A0F20';
const BORDER_SOFT = '#1C1C48';

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
  try {
    const sessions = await getSessionHistory();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekStart = getMonday(now);

    const studiedToday = sessions.some(s => {
      if (s.type !== 'focus') return false;
      return new Date(s.completedAt).toISOString().split('T')[0] === todayStr;
    });

    const thisWeekDays = Array<boolean>(7).fill(false);
    for (const s of sessions) {
      if (s.type !== 'focus') continue;
      const diff = Math.floor(
        (new Date(s.completedAt).getTime() - weekStart.getTime()) / 86_400_000,
      );
      if (diff >= 0 && diff < 7) thisWeekDays[diff] = true;
    }

    const streakAtRisk = !studiedToday && now.getHours() >= 18 && currentStreak > 0;
    return { currentStreak, longestStreak, studiedToday, thisWeekDays, streakAtRisk };
  } catch {
    return {
      currentStreak,
      longestStreak,
      studiedToday: false,
      thisWeekDays: Array(7).fill(false),
      streakAtRisk: false,
    };
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(iso);
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function fmtXP(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Animated components ─────────────────────────────────────────────────────

const AnimatedView = Animated.createAnimatedComponent(View);

// ─── XP bar fill ─────────────────────────────────────────────────────────────

function XPBarFill({ progress, reduceMotion }: { progress: number; reduceMotion: boolean }) {
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
        <Text style={{ fontSize: 80 }}>{RANK_META[tier].icon}</Text>
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

// ─── Achievement toast ────────────────────────────────────────────────────────

function AchievementToast({ icon, name, xpReward }: { icon: string; name: string; xpReward: number }) {
  const translateY = useSharedValue(-80);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
    const t = setTimeout(() => {
      translateY.value = withTiming(-80, { duration: 300 });
    }, 2700);
    return () => clearTimeout(t);
  }, []);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View style={[style, {
      position: 'absolute', top: 60, left: 16, right: 16, zIndex: 200,
      backgroundColor: Colors.surface,
      borderWidth: 1, borderColor: TEAL,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    }]}>
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '700' }}>
          Achievement unlocked — {name}
        </Text>
        <Text style={{ color: TEAL, fontSize: 12, marginTop: 2 }}>+{xpReward} XP</Text>
      </View>
    </Animated.View>
  );
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

interface HeroCardProps {
  username: string;
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
}

function HeroCard({
  username, xp, level, rank,
  totalSessions, totalFocusMinutes, longestStreak,
  xpProgress, xpToNextRank, nextRank,
  reduceMotion, onSettings,
}: HeroCardProps) {
  const avatarEmoji = getAvatarEmoji(username);
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
        backgroundColor: '#7B6EF620',
      }} />

      {/* Top row: avatar + name + rank badge */}
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

        {/* Rank badge */}
        <View style={{
          backgroundColor: GOLD_DIM,
          borderWidth: 1, borderColor: 'rgba(255,215,0,0.3)',
          borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
          flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          <Text style={{ fontSize: 14 }}>{RANK_META[rank].icon}</Text>
          <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
            {rank.toUpperCase()}
          </Text>
        </View>

        {/* Settings */}
        <TouchableOpacity
          onPress={onSettings}
          style={{ position: 'absolute', top: -8, right: -8, padding: 8 }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name="settings-outline" size={18} color={Colors.subtext} />
        </TouchableOpacity>
      </View>

      {/* XP section */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' }}>
            XP
          </Text>
          {!isNewUser && (
            <Text style={{ color: Colors.text, fontSize: 12, fontFamily: 'monospace' }}>
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
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 6, fontFamily: 'monospace' }}>
            {fmtXP(xpToNextRank)} XP until {nextRank}
          </Text>
        ) : (
          <Text style={{ color: GOLD, fontSize: 12, marginTop: 6, fontWeight: '600' }}>
            Maximum rank achieved
          </Text>
        )}
      </View>

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
            <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700', fontFamily: 'monospace' }}>
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
  const { currentStreak, longestStreak, studiedToday, thisWeekDays, streakAtRisk } = streakState;
  const isMilestone = STREAK_MILESTONES.has(currentStreak);
  const isPersonalBest = currentStreak > 0 && currentStreak >= longestStreak;
  const weeklyTotal = thisWeekDays.filter(Boolean).length;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel}>Streak</Text>

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
            fontSize: 40, fontWeight: '800', fontFamily: 'monospace',
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
            <Text style={{ color: Colors.primary, fontSize: 22, fontWeight: '700', fontFamily: 'monospace' }}>
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
            <Text style={{ color: TEAL, fontSize: 22, fontWeight: '700', fontFamily: 'monospace' }}>
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

// ─── Rank Section ─────────────────────────────────────────────────────────────

function RankSection({
  xp,
  level,
  currentRank,
}: {
  xp: number;
  level: number;
  currentRank: RankTier;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const currentIdx = RANK_ORDER.indexOf(currentRank);
  const xpToNext = getXpToNextRank(xp);
  const nextRankIdx = currentIdx + 1;
  const nextRankTier: RankTier | null = nextRankIdx < RANK_ORDER.length ? RANK_ORDER[nextRankIdx] : null;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel}>Current Rank</Text>

      <View style={{
        backgroundColor: Colors.surface,
        borderRadius: 16, padding: 20,
        borderWidth: 1, borderColor: Colors.border,
        overflow: 'hidden',
      }}>
        {/* Gold glow */}
        <View style={{
          position: 'absolute', bottom: -40, right: -40,
          width: 140, height: 140, borderRadius: 70,
          backgroundColor: '#FFD70010',
        }} />

        {/* Rank name + icon */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{
              color: GOLD, fontSize: 28, fontWeight: '800', letterSpacing: 0.5,
            }}>
              {currentRank}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 4, fontFamily: 'monospace' }}>
              Level {level} · {fmtXP(xp)} XP
            </Text>
          </View>
          <Text style={{ fontSize: 44 }}>{RANK_META[currentRank].icon}</Text>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: BORDER_SOFT, marginVertical: 16 }} />

        {/* Tier chips */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {RANK_ORDER.map((tier, idx) => {
            const isPast    = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            const isFuture  = idx > currentIdx;
            return (
              <Pressable
                key={tier}
                onPress={() => setTooltip(tooltip === tier ? null : tier)}
                style={{ flex: 1, alignItems: 'center' }}
              >
                {isCurrent && (
                  <View style={{
                    backgroundColor: Colors.primary,
                    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
                    marginBottom: 4,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>
                      YOU
                    </Text>
                  </View>
                )}
                <View style={{
                  paddingVertical: 7, borderRadius: 10,
                  width: '100%', alignItems: 'center',
                  backgroundColor: isCurrent ? GOLD_DIM : Colors.raised,
                  borderWidth: 1,
                  borderColor: isCurrent ? `${GOLD}55` : Colors.border,
                  opacity: isPast ? 0.45 : 1,
                }}>
                  <Text style={{ fontSize: 14 }}>{RANK_META[tier].icon}</Text>
                  <Text style={{
                    fontSize: 9, marginTop: 3, fontWeight: '600',
                    color: isCurrent ? GOLD : Colors.subtext,
                    letterSpacing: 0.3,
                  }}>
                    {tier.slice(0, 3).toUpperCase()}
                  </Text>
                </View>

                {tooltip === tier && (
                  <View style={{
                    position: 'absolute', bottom: -36,
                    backgroundColor: Colors.raised,
                    borderWidth: 1, borderColor: Colors.border,
                    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
                    zIndex: 10, minWidth: 70, alignItems: 'center',
                  }}>
                    <Text style={{ color: Colors.text, fontSize: 10, fontFamily: 'monospace' }}>
                      {fmtXP(RANK_THRESHOLDS[tier])} XP
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Next rank info */}
        {nextRankTier && (
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'center', marginTop: 26,
          }}>
            <Text style={{ color: Colors.subtext, fontSize: 12 }}>
              Next: {nextRankTier}
            </Text>
            <Text style={{ color: Colors.text, fontSize: 12, fontFamily: 'monospace' }}>
              {fmtXP(xpToNext)} XP needed
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Achievement Card ─────────────────────────────────────────────────────────

function AchievementItem({ achievement }: { achievement: MergedAchievement }) {
  const { isUnlocked, unlockedAt, progress, icon, name, description, isGoldTier, threshold } = achievement;
  const hasProgress = !isUnlocked && progress > 0;
  const isLocked = !isUnlocked && progress === 0;

  const topBarColor = isGoldTier
    ? GOLD
    : `${Colors.primary}`;

  const progressLabel = () => {
    if (typeof threshold === 'number') {
      const current = Math.round(progress * threshold);
      return `${current} / ${threshold}`;
    }
    return '';
  };

  return (
    <View style={{
      backgroundColor: Colors.surface,
      borderRadius: 14, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border,
      opacity: isLocked ? 0.45 : 1,
      flex: 1,
    }}>
      {/* Top accent bar */}
      {isUnlocked && (
        <View style={{
          height: 2,
          backgroundColor: isGoldTier ? GOLD : Colors.primary,
        }} />
      )}

      <View style={{ padding: 14 }}>
        <Text style={{ fontSize: 28, marginBottom: 8 }}>{icon}</Text>

        <Text style={{
          color: Colors.textBright, fontSize: 13, fontWeight: '700',
          marginBottom: 3,
        }} numberOfLines={1}>
          {name}
        </Text>

        <Text style={{
          color: Colors.subtext, fontSize: 11, lineHeight: 15,
        }} numberOfLines={2}>
          {description}
        </Text>

        {isUnlocked && (
          <Text style={{
            color: isGoldTier ? GOLD : TEAL,
            fontSize: 11, fontWeight: '600', marginTop: 10,
          }}>
            ✓ Earned · {fmtDate(unlockedAt)}
          </Text>
        )}

        {hasProgress && (
          <View style={{ marginTop: 10 }}>
            <View style={{
              height: 4, backgroundColor: Colors.inactive,
              borderRadius: 2, overflow: 'hidden',
            }}>
              <View style={{
                height: 4, width: `${Math.min(1, progress) * 100}%`,
                backgroundColor: Colors.primary, borderRadius: 2,
              }} />
            </View>
            {typeof threshold === 'number' && (
              <Text style={{
                color: Colors.subtext, fontSize: 10,
                marginTop: 4, fontFamily: 'monospace',
              }}>
                {progressLabel()}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Achievements Section ─────────────────────────────────────────────────────

function AchievementsSection({
  achievements,
  allUnlocked,
}: {
  achievements: MergedAchievement[];
  allUnlocked: boolean;
}) {
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel}>Achievements</Text>

      {allUnlocked && (
        <View style={{
          backgroundColor: GOLD_DIM,
          borderRadius: 12, padding: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginBottom: 14, borderWidth: 1, borderColor: `${GOLD}33`,
        }}>
          <Text style={{ fontSize: 20 }}>🏅</Text>
          <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700' }}>
            All achievements unlocked
          </Text>
        </View>
      )}

      {/* 2-column grid */}
      <View style={{ gap: 10 }}>
        {Array.from({ length: Math.ceil(achievements.length / 2) }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row', gap: 10 }}>
            {achievements.slice(row * 2, row * 2 + 2).map(a => (
              <AchievementItem key={a.key} achievement={a} />
            ))}
            {/* Fill empty cell if odd */}
            {row * 2 + 1 >= achievements.length && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Badge Card ───────────────────────────────────────────────────────────────

function BadgeCard({ badge }: { badge: SubjectBadge }) {
  const [showTooltip, setShowTooltip] = useState(false);

  const borderColor =
    badge.level === 'gold'   ? GOLD :
    badge.level !== 'locked' ? Colors.primary :
    Colors.border;

  const chipBg =
    badge.level === 'gold'   ? GOLD_DIM :
    badge.level === 'silver' ? Colors.surface :
    badge.level === 'bronze' ? AMBER_DIM :
    Colors.inactive;

  const chipText =
    badge.level === 'gold'   ? GOLD :
    badge.level === 'silver' ? '#C0C0C0' :
    badge.level === 'bronze' ? AMBER :
    Colors.subtext;

  const chipLabel =
    badge.level === 'locked' ? '—' : badge.level.toUpperCase();

  return (
    <Pressable
      onLongPress={() => setShowTooltip(true)}
      onPressOut={() => setShowTooltip(false)}
      style={{
        width: 96,
        backgroundColor: Colors.surface,
        borderRadius: 14, padding: 14,
        borderWidth: 1,
        borderColor,
        opacity: badge.level === 'locked' ? 0.5 : 1,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 26, marginBottom: 6 }}>{badge.icon}</Text>
      <Text
        style={{ color: Colors.text, fontSize: 12, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}
        numberOfLines={1}
      >
        {badge.tag}
      </Text>
      <View style={{
        backgroundColor: chipBg,
        borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
      }}>
        <Text style={{ color: chipText, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
          {chipLabel}
        </Text>
      </View>

      {showTooltip && (
        <View style={{
          position: 'absolute', bottom: -34,
          backgroundColor: Colors.raised,
          borderWidth: 1, borderColor: Colors.border,
          borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
          zIndex: 20,
        }}>
          <Text style={{ color: Colors.text, fontSize: 11, fontFamily: 'monospace' }} numberOfLines={1}>
            {badge.sessionCount} sessions · {badge.level}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ─── Subject Badges Section ───────────────────────────────────────────────────

function SubjectBadgesSection({ badges }: { badges: SubjectBadge[] }) {
  return (
    <View style={{ marginTop: 24 }}>
      <Text style={[sectionLabel, { paddingHorizontal: 16 }]}>Subject Badges</Text>

      {badges.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{
            backgroundColor: Colors.surface,
            borderRadius: 14, padding: 20,
            borderWidth: 1, borderColor: Colors.border,
            alignItems: 'center',
          }}>
            <Text style={{ color: Colors.subtext, fontSize: 13 }}>
              No subjects yet — add tags to your tasks to earn badges
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, flexDirection: 'row' }}
        >
          {badges.map(badge => (
            <BadgeCard key={badge.tag} badge={badge} />
          ))}
        </ScrollView>
      )}

      <View style={{ height: 40 }} />
    </View>
  );
}

// ─── Section label style ──────────────────────────────────────────────────────

const sectionLabel = {
  color: Colors.subtext,
  fontSize: 11,
  fontWeight: '600' as const,
  letterSpacing: 1.5,
  textTransform: 'uppercase' as const,
  marginBottom: 12,
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const auth = useAuthStore();
  const gamification = useGamification();
  const tasks = useTaskStore(s => s.tasks);

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
  const [toast, setToast] = useState<{ icon: string; name: string; xpReward: number } | null>(null);

  const prevRankRef = useRef<RankTier>(currentRank);
  const prevRewardLenRef = useRef(gamification.pendingRewards.length);

  const subjectBadges = useMemo(() => computeSubjectBadges(tasks), [tasks]);

  const progressStats = useMemo(() => ({
    currentStreak: gamification.currentStreak,
    longestStreak: gamification.longestStreak,
    totalSessions: gamification.totalSessions,
    totalFocusMinutes: gamification.totalFocusMinutes,
    rank: currentRank,
  }), [gamification.currentStreak, gamification.longestStreak, gamification.totalSessions, gamification.totalFocusMinutes, currentRank]);

  const mergedAchievements = useMemo<MergedAchievement[]>(() => {
    const list = ACHIEVEMENT_CATALOGUE.map(entry => {
      const backend = gamification.achievements.find(a => a.key === entry.key);
      const isUnlocked = backend?.isUnlocked ?? false;
      const unlockedAt = backend?.unlockedAt ?? null;
      const progress = isUnlocked ? 1 : Math.min(1, computeAchievementProgress(entry, progressStats));
      return { ...entry, isUnlocked, unlockedAt, progress };
    });

    return list.sort((a, b) => {
      if (a.isUnlocked && a.isGoldTier && !(b.isUnlocked && b.isGoldTier)) return -1;
      if (b.isUnlocked && b.isGoldTier && !(a.isUnlocked && a.isGoldTier)) return 1;
      if (a.isUnlocked && !b.isUnlocked) return -1;
      if (b.isUnlocked && !a.isUnlocked) return 1;
      if (a.progress > 0 && b.progress === 0) return -1;
      if (b.progress > 0 && a.progress === 0) return 1;
      return 0;
    });
  }, [gamification.achievements, progressStats]);

  const allUnlocked = mergedAchievements.length > 0 && mergedAchievements.every(a => a.isUnlocked);

  // Load data on mount
  useEffect(() => {
    gamification.fetchProfile();
    gamification.fetchAchievements();
  }, []);

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

  // Achievement toast from pending rewards
  useEffect(() => {
    const rewards = gamification.pendingRewards;
    if (rewards.length > prevRewardLenRef.current) {
      const latest = rewards[rewards.length - 1];
      if (latest?.newlyUnlocked?.length > 0) {
        const first = latest.newlyUnlocked[0];
        setToast({ icon: first.icon, name: first.title, xpReward: first.xpReward });
        setTimeout(() => setToast(null), 3000);
      }
    }
    prevRewardLenRef.current = rewards.length;
  }, [gamification.pendingRewards]);

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: Colors.bg }}
    >
      {/* Hero Card — fixed, does not scroll */}
      <HeroCard
        username={auth.user?.username ?? 'User'}
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
      />

      {/* Scrollable sections */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <StreakSection streakState={streakState} reduceMotion={reduceMotion} />
        <RankSection xp={xp} level={gamification.level} currentRank={currentRank} />
        <AchievementsSection achievements={mergedAchievements} allUnlocked={allUnlocked} />
        <SubjectBadgesSection badges={subjectBadges} />
      </ScrollView>

      {/* Rank-up overlay */}
      {rankUpTier && (
        <RankUpOverlay tier={rankUpTier} reduceMotion={reduceMotion} />
      )}

      {/* Achievement toast */}
      {toast && (
        <AchievementToast icon={toast.icon} name={toast.name} xpReward={toast.xpReward} />
      )}
    </SafeAreaView>
  );
}
