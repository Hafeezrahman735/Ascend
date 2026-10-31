import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Task, TaskAnalytics } from '../types';
import { useTheme } from '../hooks/useTheme';
import { useTagStyle } from '../utils/tagStyle';
import { BottomSheet, BentoCell, BentoRingCell, SCREEN_H } from './SheetPrimitives';
import AppPressable from './AppPressable';
import { api } from '../services/api';
import { priorityColor, priorityLabel } from '../utils/priority';
import { parseLocalDate } from '../utils/date';
import { Space, Radius } from '../constants/spacing';
import {
  formatSeconds, formatDuration, getDueChip, formatEstimateDelta, formatLastWorked, formatConsistency,
} from '../lib/taskMetrics';

/** One day's focus on the task, for the sheet's first row. */
export interface FocusedOnDay {
  /** "today", or a short day such as "Thu 31 Oct". */
  dayLabel: string;
  seconds: number;
  sessions: number;
  /** The task's scheduled block that day, if it has one. */
  plannedMinutes: number | null;
}

/**
 * A task's details: the focus it has had, its stats and its next action.
 * Opened from Today and from a planned block on the calendar's Day view.
 *
 * sessionLengthMinutes stays in the prop type (callers still pass it) but is not
 * read here — the modal shows actual logged time, not the configured length.
 */
export default function TaskStatsModal({
  task, focused, onShowSessions, onClose, onLoadTimer, onToggleComplete, onEdit,
}: {
  task: Task | null; sessionLengthMinutes: number;
  /** Shown as the first row when given; tapping it calls onShowSessions. */
  focused?: FocusedOnDay;
  onShowSessions?: () => void;
  onClose: () => void; onLoadTimer: (taskId: string) => void; onToggleComplete: (taskId: string) => void;
  /** Hidden when not given: the task form lives on Today (calendar opens without it). */
  onEdit?: (taskId: string) => void;
}) {
  const Colors = useTheme();
  const [analytics, setAnalytics] = useState<TaskAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState(false);

  useEffect(() => {
    if (!task) return;
    setAnalytics(null); setAnalyticsError(false);
    // The server buckets every day and hour in the zone we send. Without it it
    // falls back to UTC, which is what made "peak hour" wrong by a full offset
    // for every user outside it.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api.get<{ analytics: TaskAnalytics } & Task>(`/tasks/${task.id}?tz=${encodeURIComponent(tz)}`)
      .then((res) => { if (res.success && res.data) setAnalytics((res.data as any).analytics); else setAnalyticsError(true); })
      .catch(() => setAnalyticsError(true));
  }, [task?.id]);

  const categoryTag = task?.tags[0] ?? null;
  const tagStyle = useTagStyle(categoryTag ?? '');

  if (!task) return null;
  const isPending = !task.isCompleted;
  const prioColor = priorityColor(task.priority);
  // Deliberately NOT clamped to 1. BentoRingCell clamps the arc it draws, so
  // the ring still reads correctly, while the centre label is free to say 240%
  // — which is the number an over-running task most needs to show.
  const progressFrac = task.estimatedMinutes ? task.totalTimeOnTask / (task.estimatedMinutes * 60) : null;
  // Until analytics land, the server-derived cells show an em-dash; sessions come from the task itself.
  const ready = !!analytics;
  const val = (v: string) => (ready ? v : '—');
  // Read from `task`, not from `analytics`. Every other cell in the grid is
  // derived and arrives with GET /tasks/:id, so it shows an em-dash behind a
  // spinner first. A deadline is known locally and instantly, and it is the
  // INPUT to the decision this sheet exists to support rather than a
  // measurement of it — so it must not arrive late with the averages.
  const dueChip = getDueChip(task, Colors);
  const dueDateLabel = task.dueDate
    ? parseLocalDate(task.dueDate.substring(0, 10))
        .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : null;
  const isOverdue = !task.isCompleted && !!dueChip?.a11yLabel.includes('overdue');

  return (
    <BottomSheet visible onClose={onClose} sheetHeight={SCREEN_H * 0.66}>
      {/* header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 11 }}>
          <Text numberOfLines={2} style={{ flex: 1, marginRight: 12, color: Colors.textBright, fontSize: 19, fontWeight: '700', lineHeight: 24, letterSpacing: -0.3 }}>{task.title}</Text>
          <AppPressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            style={{ width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: Colors.raised, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color={Colors.text} />
          </AppPressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {categoryTag && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: tagStyle.bg }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: tagStyle.text }}>{tagStyle.icon} {categoryTag}</Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: prioColor + '22' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: prioColor }}>{priorityLabel(task.priority)}</Text>
          </View>
        </View>
        {focused && (
          <FocusedRow focused={focused} onPress={onShowSessions} />
        )}
      </View>
      <View style={{ height: 1, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 16 }} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {/* Stat bento. Cell SIZE carries rank here, which the previous six
            equal cells at flexBasis:'47%' could not: the ring is the number
            people open this sheet for, so it is the only large thing.

            The ring shows estimate consumed, NOT the misnamed old
            `estimationAccuracy` — see formatEstimateDelta for why a percentage
            was actively misleading above 100%. Tasks with no estimate have no
            ring to draw, so they get total focus as the hero instead. */}
        <View style={{ gap: Space.sm, marginBottom: Space.lg }}>
          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            {progressFrac !== null ? (
              <BentoRingCell
                style={{ flex: 1.3 }}
                fraction={progressFrac}
                centerLabel={`${Math.round(progressFrac * 100)}%`}
                caption={formatSeconds(task.totalTimeOnTask)}
                sub={`of ${formatSeconds((task.estimatedMinutes ?? 0) * 60)} estimated`}
                tint={task.isCompleted ? Colors.accent : Colors.primary}
                Colors={Colors}
              />
            ) : (
              <BentoRingCell
                style={{ flex: 1.3 }}
                fraction={1}
                centerLabel={val(formatSeconds(analytics?.totalTimeAllTime ?? 0))}
                caption="Total focus"
                sub="no estimate set"
                tint={Colors.primary}
                Colors={Colors}
              />
            )}
            <View style={{ flex: 1, gap: Space.sm }}>
              <BentoCell
                style={{ flex: 1 }} Colors={Colors}
                icon="timer-outline" label="Sessions"
                value={String(task.sessionsOnTask)}
              />
              <BentoCell
                style={{ flex: 1 }} Colors={Colors}
                icon="pulse-outline" label="Avg length"
                value={val(formatSeconds(analytics?.avgSessionLength ?? 0))}
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="sunny-outline" label="Peak hour"
              value={val(analytics?.mostProductiveHour?.label ?? '—')}
            />
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="calendar-outline" label="Consistency"
              value={ready ? formatConsistency(analytics?.consistency ?? null) : '—'}
              sub={ready ? `${analytics?.daysWorked ?? 0} days worked` : undefined}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="locate-outline" label="Vs estimate"
              value={ready ? formatEstimateDelta(analytics?.estimateDeltaSeconds ?? null) : '—'}
            />
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="time-outline" label="Last worked"
              value={ready ? formatLastWorked(analytics?.lastSessionAt ?? null) : '—'}
            />
          </View>

          {/* Due date. Rendered only when there is one — the grid already shows
              six em-dashes while analytics load, and a seventh absence is noise.
              `feature` when overdue: at most one feature cell per grid, and an
              overdue deadline is the one thing here that outranks the ring. */}
          {dueDateLabel && (
            <BentoCell
              Colors={Colors}
              icon="calendar-outline"
              label="Due"
              value={dueDateLabel}
              sub={dueChip?.a11yLabel}
              feature={isOverdue}
            />
          )}
        </View>
        {!ready && !analyticsError && <ActivityIndicator color={Colors.primary} style={{ marginBottom: Space.md }} />}
        {analyticsError && <Text style={{ color: Colors.text, fontSize: 12, marginBottom: Space.md }}>Analytics unavailable — try again later.</Text>}

        {/* description — captured when the task was created */}
        {task.description?.trim() ? (
          <View style={{ backgroundColor: Colors.raised, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Ionicons name="document-text-outline" size={14} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Description</Text>
            </View>
            <Text style={{ color: Colors.textBright, fontSize: 14, lineHeight: 20 }}>{task.description.trim()}</Text>
          </View>
        ) : null}

        {/* Recurring history — on a recurring task's day row. The server
            calculates these from the completion log and sends them on the row,
            so there is no extra fetch. The 🔥 and ⏱️ emoji are gone — every
            other glyph in this sheet is an Ionicon, and a screen reader
            announced the old ones by name. */}
        {task.isOccurrence && (
          <View style={{ flexDirection: 'row', gap: Space.sm, marginBottom: Space.lg }}>
            <BentoCell
              style={{ flex: 1 }} Colors={Colors} feature
              icon="flame-outline" label="Current streak"
              value={`${task.currentStreak}d`}
              sub={`best ${task.longestStreak}d`}
            />
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="infinite-outline" label="Lifetime focus"
              value={formatSeconds(task.totalFocusSeconds)}
              sub={`${task.totalCompletions} completions`}
            />
          </View>
        )}

        {/* The standalone "Time progress" bar that used to sit here is gone: it
            showed the same quantity as the ring above, in the same sheet. */}
      </ScrollView>

      {/* footer */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }}>
        {isPending ? (
          <AppPressable
            onPress={() => { onLoadTimer(task.id); onClose(); }}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 15 }}
          >
            <Ionicons name="play" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Load into Timer</Text>
          </AppPressable>
        ) : (
          <AppPressable
            onPress={() => { onToggleComplete(task.id); onClose(); }}
            accessibilityRole="button"
            style={{ borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border }}
          >
            <Text style={{ color: Colors.text, fontSize: 14, fontWeight: '600' }}>Mark Incomplete</Text>
          </AppPressable>
        )}
        {onEdit && (
          <AppPressable
            onPress={() => onEdit(task.id)}
            accessibilityRole="button"
            scaleOnPress={false}
            style={{ alignItems: 'center', justifyContent: 'center', marginTop: Space.sm, minHeight: 44 }}
          >
            <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '600' }}>Edit task details</Text>
          </AppPressable>
        )}
      </View>
    </BottomSheet>
  );
}

/**
 * "FOCUSED TODAY 52m of 2h planned · 2 sessions ›" with a thin bar against the
 * plan. A button only when there is a list to open.
 */
function FocusedRow({ focused, onPress }: { focused: FocusedOnDay; onPress?: () => void }) {
  const Colors = useTheme();
  const { dayLabel, seconds, sessions, plannedMinutes } = focused;
  const share = plannedMinutes ? Math.min(1, seconds / (plannedMinutes * 60)) : null;
  const detail = [
    plannedMinutes ? `of ${formatDuration(plannedMinutes * 60)} planned` : null,
    `${sessions} session${sessions === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
  const tappable = !!onPress && sessions > 0;

  return (
    <AppPressable
      onPress={tappable ? onPress : undefined}
      disabled={!tappable}
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`Focused ${dayLabel}, ${formatDuration(seconds)}, ${detail}${tappable ? '. Show sessions' : ''}`}
      style={{
        marginTop: Space.md, minHeight: 56, borderRadius: Radius.md, borderWidth: 1.5,
        borderColor: Colors.primary, backgroundColor: Colors.raised,
        paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: Space.md,
      }}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>
            FOCUSED {dayLabel.toUpperCase()}
          </Text>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {formatDuration(seconds)}
          </Text>
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>{detail}</Text>
        </View>
        {share !== null && (
          <View style={{ height: 5, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' }}>
            <View style={{ width: `${share * 100}%`, height: 5, backgroundColor: Colors.primary }} />
          </View>
        )}
      </View>
      {tappable && <Ionicons name="chevron-forward" size={18} color={Colors.subtext} />}
    </AppPressable>
  );
}
