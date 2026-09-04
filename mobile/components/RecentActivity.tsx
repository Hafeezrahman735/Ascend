import { useEffect, useMemo } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useGamificationStore } from '../stores/gamificationStore';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import type { ActivityEvent } from '../types';

/**
 * Personal accomplishment log.
 *
 * Reads GET /activity, which is self-only — deliberately not the social feed.
 * Surfaced as a section rather than its own tab: the Calendar tab answers "what
 * is coming up", this answers "what have I already done".
 */

const EVENT_META: Record<
  ActivityEvent['eventType'],
  { icon: keyof typeof Ionicons.glyphMap; tint: (c: ThemeColors) => string }
> = {
  session_completed:    { icon: 'timer',        tint: (c) => c.primary },
  task_completed:       { icon: 'checkmark-circle', tint: (c) => c.trace },
  goal_completed:       { icon: 'flag',         tint: (c) => c.ROSE },
  achievement_unlocked: { icon: 'trophy',       tint: (c) => c.AMBER },
  streak_milestone:     { icon: 'flame',        tint: (c) => c.AMBER },
  level_up:             { icon: 'trending-up',  tint: (c) => c.primary },
  rank_up:              { icon: 'trending-up',  tint: (c) => c.trace },
};

/** Human line for one event, from the payload each emitter writes. */
function describe(event: ActivityEvent): string {
  const p = event.payload ?? {};
  const str = (key: string): string | null =>
    typeof p[key] === 'string' ? (p[key] as string) : null;
  const num = (key: string): number | null =>
    typeof p[key] === 'number' ? (p[key] as number) : null;

  switch (event.eventType) {
    case 'session_completed': {
      const minutes = num('durationMinutes') ?? 0;
      const task = str('taskTitle');
      return task ? `Focused ${minutes}m on ${task}` : `Focused for ${minutes}m`;
    }
    case 'task_completed':
      return `Completed “${str('taskTitle') ?? 'a task'}”`;
    case 'goal_completed':
      return `Finished goal “${str('goalTitle') ?? 'a goal'}”`;
    case 'achievement_unlocked':
      return `Unlocked ${str('achievementTitle') ?? 'an achievement'}`;
    case 'streak_milestone':
      return `${num('streakDays') ?? 0}-day streak`;
    case 'rank_up':
      return `Reached ${str('rank') ?? 'a new'} rank`;
    // Historical only — see the note on ActivityEvent. Kept so a log entry
    // written before Level was retired still reads as something, rather than
    // falling through to the generic "Activity".
    case 'level_up':
      return `Reached level ${num('newLevel') ?? 0}${str('levelTitle') ? ` · ${str('levelTitle')}` : ''}`;
    default:
      return 'Activity';
  }
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export default function RecentActivity({ limit = 8 }: { limit?: number }) {
  const Colors = useTheme();
  // Destructuring after a bare hook call still subscribes to the WHOLE store —
  // the pick has to happen inside the selector to have any effect.
  const { activity, isLoadingActivity, fetchActivity } = useGamificationStore(
    useShallow((s) => ({
      activity: s.activity,
      isLoadingActivity: s.isLoadingActivity,
      fetchActivity: s.fetchActivity,
    })),
  );

  // Refresh is the caller's job — the Tasks screen fetches on focus, because a
  // parent that hides this component until the log is non-empty can never let a
  // self-owned fetch populate it. This fallback only covers a caller that does
  // not fetch at all; with data already loaded it stays quiet rather than firing
  // a second request every time the card is swiped into view.
  useEffect(() => {
    if (activity.length === 0) fetchActivity();
  }, [activity.length, fetchActivity]);

  const visible = useMemo(() => activity.slice(0, limit), [activity, limit]);

  if (isLoadingActivity && activity.length === 0) {
    return (
      <View style={{ paddingVertical: 24, alignItems: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (visible.length === 0) {
    return (
      <View style={{ paddingVertical: 20, alignItems: 'center' }}>
        <Ionicons name="sparkles-outline" size={22} color={Colors.subtext} />
        <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 6 }}>
          Your log fills in as you finish sessions, tasks and goals
        </Text>
      </View>
    );
  }

  return (
    <View>
      {visible.map((event) => {
        const meta = EVENT_META[event.eventType] ?? EVENT_META.session_completed;
        return (
          <View
            key={event.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}
          >
            <View
              style={{
                width: 28, height: 28, borderRadius: 14,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: Colors.surface,
              }}
            >
              <Ionicons name={meta.icon} size={15} color={meta.tint(Colors)} />
            </View>
            <Text style={{ color: Colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {describe(event)}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 11 }}>
              {relativeTime(event.createdAt)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
