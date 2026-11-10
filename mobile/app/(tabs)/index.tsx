import React, { memo, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, SectionList, Modal, Animated,
  StyleSheet, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Swipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Task, TaskGoal } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import { useAppForeground } from '../../hooks/useAppState';
import { useTasksList, useSelectedTaskId, useTaskActions, useSettings } from '../../store/hooks';
import { useFocusEffect, useRouter } from 'expo-router';
import { useHeroCard, CARD_ORDER, type HeroCardType } from '../../hooks/useHeroCard';
import { urgentTasks } from '../../lib/heroCard';
import { nextOccurrenceLabel, type RecurringTemplate } from '../../lib/recurringDisplay';
import { buildTaskBoard, topTasks, type BoardItem, type BoardTab, type TaskStatus } from '../../lib/taskBoard';
import RoundedTabs, { type RoundedTab } from '../../components/RoundedTabs';
import { useTaskStore } from '../../stores/taskStore';
import { useGoalStore } from '../../stores/goalStore';
import { useSocialStore } from '../../stores/socialStore';
import { NotificationsSheet } from '../../components/social/NotificationsSheet';
import { FocusButton } from '../../components/today/FocusButton';
import { focusButtonState } from '../../lib/startFocusTarget';
import RecentActivity from '../../components/RecentActivity';
import GoalStatsModal from '../../components/GoalStatsModal';
import TaskStatsModal, { type FocusedOnDay } from '../../components/TaskStatsModal';
import TaskFormModal from '../../components/TaskFormModal';
import { useTaskForm } from '../../hooks/useTaskForm';
import PlanSummary from '../../components/PlanSummary';
import SessionsSheet, { type SessionsTarget } from '../../components/timeReport/SessionsSheet';
import { planVsActual, plannedBlocksFromTasks, timelineFromHistory } from '../../lib/planVsActual';
import type { Lens } from '../../components/timeReport/TimeAnalyticsView';
import TimeCard from '../../components/timeReport/TimeCard';
import { lastSessionOnGoal, sortGoalsByUrgency, type GoalStatusAction } from '../../lib/goalStats';
import { useAuthStore } from '../../stores/authStore';
import { useTimerStore, syncQueuedSessions } from '../../stores/timerStore';
import { useGamificationStore } from '../../stores/gamificationStore';
import { getSessionHistory, mergeWithServerSessions, type SessionRecord } from '../../store/sync';
import { api } from '../../services/api';
import { getQueuedSessionIds } from '../../services/sessionOutbox';
import { priorityColor, priorityLabel } from '../../utils/priority';
import {
  daysUntilLocalDate, formatDeadlineLabel, getLocalDateString,
} from '../../utils/date';
import { useTagStyle, useTagOverrideStore } from '../../utils/tagStyle';
import {
  getMonday, isToday, formatSeconds,
  formatDuration, getDueChip, isYesterdayLocal, calcDaysUntilDue,
  startOfThisWeekMs, startOfWeekNMs, getLastWeekCompletionRate,
  getPeakHour, formatPeakWindow, getCompletionRate, formatOverdue,
  compactDuration,
} from '../../lib/taskMetrics';
import { stepGoalMinutes, GOAL_MIN_MINUTES, GOAL_MAX_MINUTES } from '../../lib/dailyTarget';
import { workBlockToday } from '../../lib/taskBoard';
import { formatMinutes } from '../../lib/calendarItems';
import { taskFocusOnDay } from '../../lib/calendarViews';
import { getStyles } from '../../components/formStyles';
import GoalEditor from '../../components/goals/GoalEditor';
import TagOverrideSheet from '../../components/timeReport/TagOverrideSheet';

// ─── Design tokens ────────────────────────────────────────────────────────────
// ROSE / ROSE_DIM / AMBER now come from the theme — each component destructures
// them from `Colors` (AMBER maps to Colors.warning to preserve the exact dark hue).
const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
// How many open tasks the main tab leads with before "See more".
const TOP_TASK_COUNT = 3;


// ─── ZoneHeader ───────────────────────────────────────────────────────────────
function ZoneHeader({ title, onSeeMore }: { title: string; onSeeMore?: () => void }) {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      {onSeeMore && (
        <TouchableOpacity onPress={onSeeMore}>
          <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600' }}>See more →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}


// ─── TaskRow ──────────────────────────────────────────────────────────────────
/**
 * The visual body of a task row, with no gesture wrapper.
 *
 * Split out so a dormant recurring row can reuse the exact chrome while sitting
 * OUTSIDE Swipeable. Hiding the checkbox alone would not have been enough:
 * swipe-left completes a task, so a dormant row rendered through TaskRow could
 * still be completed by a gesture that leaves no visual sign.
 */
/**
 * Memoised, and the callbacks below are why it can be.
 *
 * The row props used to be inline arrows (`onTap={() => setStatsTask(task)}`),
 * which are a new function on every parent render — memo would have compared
 * them, found them different, and re-rendered anyway. The handlers now take the
 * task as an ARGUMENT so the parent can pass stable references straight through.
 *
 * Worth it because this body recomputes getDueChip and a goals.find per row, and
 * before this every mounted row redid both whenever anything on Today
 * changed.
 */
const TaskRowBody = memo(function TaskRowBody({ task, isActive, goals, onTap, onLongPressTag, dormant = false, subtitle }: {
  task: Task; isActive: boolean; goals: TaskGoal[];
  onTap: (task: Task) => void; onLongPressTag?: (t: string) => void;
  dormant?: boolean; subtitle?: string;
}) {
  const Colors = useTheme();
  const isCompleted = task.isCompleted;
  const barColor = dormant ? Colors.border : isActive ? Colors.primary : isCompleted ? Colors.accent : Colors.border;
  // A template has no due date and no sessions, so these stay inert rather than
  // rendering something untrue.
  // A task planned for today leads Today's list (D6), so its row says when:
  // the block's time, or "Today" for an any-time one (D19). Its due chip then
  // shows only when the deadline is within the week.
  const block = dormant || isCompleted ? null : workBlockToday(task, getLocalDateString());
  const dueChip = dormant ? null : getDueChip(task, Colors);
  const daysLeft = block ? calcDaysUntilDue(task) : null;
  const chip = block && (daysLeft === null || daysLeft > 6) ? null : dueChip;
  const blockLabel = block
    ? block.startMinutes != null && block.endMinutes != null
      ? `${formatMinutes(block.startMinutes)}–${formatMinutes(block.endMinutes)}`
      : 'Today'
    : null;
  const blockA11y = block
    ? block.startMinutes != null && block.endMinutes != null
      ? `work block today, ${formatMinutes(block.startMinutes)} to ${formatMinutes(block.endMinutes)}`
      : 'work block today, any time'
    : null;
  const prioColor = priorityColor(task.priority);
  const categoryTag = task.tags.length > 0 ? task.tags[0] : null;
  const tagStyle = useTagStyle(categoryTag ?? '');
  const progressFrac = !dormant && task.estimatedMinutes ? Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60)) : null;
  const linkedGoal = task.taskGoalId ? goals.find((g) => g.id === task.taskGoalId) : null;
  // A day row and a dormant recurring task both carry isRecurring.
  const isRecurringRow = task.isRecurring;
  // A finished row is solid green, never faded: a faded row let the swipe
  // panels behind it show through (D12). On the green, muted text fails
  // contrast, so every line uses body text (D15, D16: 6.1:1 dark, 12.9:1 light).
  const rowBg = isCompleted ? Colors.accentDim : isActive ? Colors.raised : Colors.surface;
  const rowBorder = isCompleted ? Colors.accent + '40' : isActive ? Colors.primary + '50' : Colors.border;
  const goalColor = isCompleted ? Colors.text : Colors.primarySoft;
  const sessionsColor = isCompleted ? Colors.text : isActive ? Colors.primarySoft : Colors.subtext;
  const completedA11y = isCompleted
    ? `Completed: ${task.title}${linkedGoal ? `, goal ${linkedGoal.title}` : ''}`
    : undefined;

  return (
    <TouchableOpacity activeOpacity={0.75} onPress={() => onTap(task)} accessibilityLabel={completedA11y} style={{ flexDirection: 'row', backgroundColor: rowBg, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 0.5, borderStyle: dormant ? 'dashed' : 'solid', borderColor: rowBorder }}>
      <View style={{ width: 3, backgroundColor: barColor }} />
      <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: progressFrac !== null ? 10 : 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {dormant ? (
            <View style={{ width: 20, height: 20, borderRadius: 10, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryDim }}>
              <Text style={{ color: Colors.primarySoft, fontSize: 11, fontWeight: '700' }}>{'\u21BA'}</Text>
            </View>
          ) : (
            <View style={{ width: 20, height: 20, borderRadius: 10, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isCompleted ? Colors.accent : 'transparent', borderWidth: isCompleted ? 0 : 1.5, borderColor: isCompleted ? Colors.accent : isActive ? Colors.primary : Colors.subtext }}>
              {isCompleted && <Ionicons name="checkmark" size={12} color={Colors.bg} />}
            </View>
          )}
          <Text numberOfLines={1} style={{ flex: 1, color: isCompleted ? Colors.text : Colors.textBright, fontSize: 14, fontWeight: '600', textDecorationLine: isCompleted ? 'line-through' : 'none' }}>{task.title}</Text>
          <View style={{ marginLeft: 6, alignItems: 'flex-end', gap: 4 }}>
            {(isRecurringRow || categoryTag) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {isRecurringRow && (
                  <View style={{ backgroundColor: Colors.primaryDim, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <Text style={{ color: Colors.primarySoft, fontSize: 11, fontWeight: '700' }}>↺</Text>
                  </View>
                )}
                {categoryTag && (
                  <TouchableOpacity
                    onLongPress={() => onLongPressTag?.(categoryTag)} delayLongPress={400}
                    style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: tagStyle.bg }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: tagStyle.text }}>{tagStyle.icon} {categoryTag}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: prioColor + '22' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: prioColor }}>{priorityLabel(task.priority)}</Text>
            </View>
          </View>
        </View>
        {subtitle && (
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 5 }} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {linkedGoal && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
            <Ionicons name="flag-outline" size={10} color={goalColor} style={{ marginRight: 4 }} />
            <Text style={{ color: goalColor, fontSize: 11 }} numberOfLines={1}>Goal: {linkedGoal.title}</Text>
          </View>
        )}
        {(task.sessionsOnTask > 0 || chip || blockLabel) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, gap: 8 }}>
            {blockLabel && <View accessible accessibilityLabel={blockA11y ?? undefined} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: Colors.primaryDim }}><Text style={{ fontSize: 10, fontWeight: '700', color: Colors.primarySoft }}>{blockLabel}</Text></View>}
            {task.sessionsOnTask > 0 && <Text style={{ color: sessionsColor, fontSize: 11, fontWeight: '500' }}>{task.sessionsOnTask} session{task.sessionsOnTask !== 1 ? 's' : ''}</Text>}
            {chip && <View accessible accessibilityLabel={chip.a11yLabel} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: chip.bg }}><Text style={{ fontSize: 10, fontWeight: '700', color: chip.fg }}>{chip.label}</Text></View>}
          </View>
        )}
        {progressFrac !== null && (
          <View style={{ height: 3, backgroundColor: Colors.inactive, borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progressFrac * 100)}%`, height: '100%', borderRadius: 2, backgroundColor: isCompleted ? Colors.accent : Colors.primary }} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const TaskRow = memo(function TaskRow({ task, isActive, goals, onTap, onEdit, onComplete, onLongPressTag }: {
  task: Task; isActive: boolean; goals: TaskGoal[];
  onTap: (task: Task) => void;
  onEdit: (task: Task) => void;
  onComplete: (taskId: string) => void;
  onLongPressTag?: (t: string) => void;
}) {
  const Colors = useTheme();
  const { ROSE, ROSE_DIM } = Colors;
  const isCompleted = task.isCompleted;
  const swipeRef = useRef<SwipeableMethods>(null);
  // ReanimatedSwipeable reports the direction of the SWIPE, not the panel:
  // dragging right reveals the left ("Done") panel and reports RIGHT. The old
  // Animated-based Swipeable (removed in gesture-handler 3) reported 'left' for
  // the same gesture, so the comparison flipped with the upgrade.
  const handleSwipeOpen = useCallback((direction: SwipeDirection) => { swipeRef.current?.close(); if (direction === SwipeDirection.RIGHT) onComplete(task.id); else onEdit(task); }, [onComplete, onEdit, task]);

  const renderLeftActions = () => (
    <View style={{ width: 72, marginRight: 6, marginBottom: 8, borderRadius: 14, backgroundColor: isCompleted ? ROSE_DIM : Colors.accentDim, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name={isCompleted ? 'arrow-undo' : 'checkmark-circle'} size={22} color={isCompleted ? ROSE : Colors.accent} />
      <Text style={{ color: isCompleted ? ROSE : Colors.accent, fontSize: 9, fontWeight: '700', marginTop: 3 }}>{isCompleted ? 'Undo' : 'Done'}</Text>
    </View>
  );
  const renderRightActions = () => (
    <View style={{ width: 72, marginLeft: 6, marginBottom: 8, borderRadius: 14, backgroundColor: Colors.primaryDim, justifyContent: 'center', alignItems: 'center' }}>
      <Ionicons name="pencil" size={20} color={Colors.primarySoft} />
      <Text style={{ color: Colors.primarySoft, fontSize: 9, fontWeight: '700', marginTop: 3 }}>Edit</Text>
    </View>
  );

  return (
    <Swipeable ref={swipeRef} renderLeftActions={renderLeftActions} renderRightActions={renderRightActions} onSwipeableOpen={handleSwipeOpen} overshootLeft={false} overshootRight={false} friction={2}>
      <TaskRowBody task={task} isActive={isActive} goals={goals} onTap={onTap} onLongPressTag={onLongPressTag} />
    </Swipeable>
  );
});

/**
 * A recurring task with no instance today, shown through its template.
 *
 * No Swipeable, so it cannot be completed by gesture: there is no row for today
 * to complete. Tapping opens the template editor rather than the stats modal,
 * which exposes both completion and selectTask, and a template id in
 * selectedTaskId would leave the focus tab holding a dangling id.
 */
const DormantRecurringRow = memo(function DormantRecurringRow({ template, goals, subtitle, onEdit, onLongPressTag }: {
  template: Task; goals: TaskGoal[]; subtitle: string;
  onEdit: (task: Task) => void; onLongPressTag?: (t: string) => void;
}) {
  return (
    <TaskRowBody
      task={template}
      isActive={false}
      goals={goals}
      onTap={onEdit}
      onLongPressTag={onLongPressTag}
      dormant
      subtitle={subtitle}
    />
  );
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message }: { message: string | null }) {
  const Colors = useTheme();
  // useMemo rather than useRef(...).current, which allocates a fresh
  // Animated.Value on every render and discards it. Stable identity also lets it
  // be an honest effect dependency.
  const opacity = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    if (message) {
      Animated.sequence([Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }), Animated.delay(1500), Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true })]).start();
    }
  }, [message, opacity]);
  if (!message) return null;
  return (
    <Animated.View style={{ position: 'absolute', bottom: 96, alignSelf: 'center', backgroundColor: Colors.accentDim, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 0.5, borderColor: Colors.accent, opacity }}>
      <Text style={{ color: Colors.accent, fontSize: 13, fontWeight: '700' }}>{message}</Text>
    </Animated.View>
  );
}

// ─── GroupHeader ──────────────────────────────────────────────────────────────
function GroupHeader({ dotColor, label, count }: { dotColor: string; label: string; count: number }) {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor, marginRight: 8 }} />
      <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700', flex: 1, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
      <View style={{ backgroundColor: dotColor + '25', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ color: dotColor, fontSize: 11, fontWeight: '700' }}>{count}</Text></View>
    </View>
  );
}

// ─── BarColumn ────────────────────────────────────────────────────────────────
/**
 * One day of the week strip, scaled by TIME.
 *
 * This used to plot session COUNT, so a ninety-minute session and a
 * five-minute one drew the same bar — the same defect corrected in
 * getPeakHour, where the client ranked peak focus by count while the server
 * ranked it by seconds.
 */
/**
 * One day's bar in a week strip.
 *
 * `value` and `formatValue` rather than `seconds` and a hardcoded duration
 * format: the same strip now draws focus time on the Goals screen and a count
 * of tasks finished on Today. A prop called `seconds` holding a task
 * count is the kind of small lie that outlives everyone's memory of it.
 */
function BarColumn({ dayLabel, value, max, isToday, isFuture, formatValue = compactDuration }: {
  dayLabel: string; value: number; max: number; isToday: boolean; isFuture: boolean;
  formatValue?: (n: number) => string;
}) {
  const Colors = useTheme();
  const BAR_MAX_H = 56;
  const barHeight = isFuture ? 3 : Math.max(value > 0 ? (value / max) * BAR_MAX_H : 3, 3);
  const barColor = isToday ? Colors.accent : Colors.primary;
  const countLabel = isFuture ? '—' : formatValue(value);
  const labelColor = isToday ? Colors.accent : Colors.subtext;
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 2 }}>
      <View style={{ height: BAR_MAX_H, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
        <View style={{ width: '70%', height: barHeight, borderRadius: 3, backgroundColor: isFuture ? Colors.inactive : barColor, opacity: isFuture ? 0.15 : value === 0 && !isToday ? 0.25 : 1 }} />
      </View>
      <Text style={{ fontSize: 10, fontWeight: '700', marginTop: 5, color: labelColor }}>{countLabel}</Text>
      <Text style={{ fontSize: 10, fontWeight: '500', marginTop: 2, color: labelColor }}>{dayLabel}</Text>
    </View>
  );
}



// ─── TodayPill ────────────────────────────────────────────────────────────────
function TodayPill({ value, label }: { value: string; label: string }) {
  const Colors = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', borderWidth: 0.5, borderColor: Colors.border }}>
      <Text style={{ color: Colors.primarySoft, fontSize: 18, fontWeight: '700', marginBottom: 3 }}>{value}</Text>
      <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, textAlign: 'center' }}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── DailyTargetModal ─────────────────────────────────────────────────────────
// Its own component because two screens open it: Today's pill strip and
// the Goal Progress drill-down. It used to be written inline on Today
// return only, so tapping "Today's target" inside Goal Progress flipped the flag
// with nothing mounted to render it. The sheet then appeared on the way back to
// Today's main view, which reads as a dead tap followed by a stray modal.
function DailyTargetModal({ visible, draft, onDraftChange, onCancel, onSave }: {
  visible: boolean; draft: number; onDraftChange: (next: number) => void;
  onCancel: () => void; onSave: () => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity activeOpacity={1} onPress={onCancel} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
        <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Daily Focus Goal</Text>
        <Text style={{ color: Colors.subtext, fontSize: 13, marginBottom: 24 }}>How much focus time do you want to put in each day?</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}>
          <TouchableOpacity
            onPress={() => onDraftChange(stepGoalMinutes(draft, -1))}
            disabled={draft <= GOAL_MIN_MINUTES}
            accessibilityRole="button"
            accessibilityLabel="Decrease daily focus goal"
            style={[styles.stepper, { width: 48, height: 48, borderRadius: 14, opacity: draft <= GOAL_MIN_MINUTES ? 0.3 : 1 }]}
          >
            <Text style={{ color: Colors.primarySoft, fontSize: 24, fontWeight: '600' }}>−</Text>
          </TouchableOpacity>
          <View style={{ width: 150, alignItems: 'center' }}>
            <Text style={{ color: Colors.textBright, fontSize: 38, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>
              {formatSeconds(draft * 60)}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 12 }}>of focus per day</Text>
          </View>
          <TouchableOpacity
            onPress={() => onDraftChange(stepGoalMinutes(draft, 1))}
            disabled={draft >= GOAL_MAX_MINUTES}
            accessibilityRole="button"
            accessibilityLabel="Increase daily focus goal"
            style={[styles.stepper, { width: 48, height: 48, borderRadius: 14, opacity: draft >= GOAL_MAX_MINUTES ? 0.3 : 1 }]}
          >
            <Text style={{ color: Colors.primarySoft, fontSize: 24, fontWeight: '600' }}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={onCancel} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' }}>
            <Text style={{ color: Colors.subtext, fontWeight: '600' }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSave}
            style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── PillStrip ────────────────────────────────────────────────────────────────
function PillStrip({ completedToday, yesterdayCompleted, totalActive, weeklyRate, lastWeekRate, focusSecondsToday, dailyGoalSeconds, onSetGoal }: {
  completedToday: number; yesterdayCompleted: number; totalActive: number;
  weeklyRate: number | null; lastWeekRate: number | null;
  focusSecondsToday: number; dailyGoalSeconds: number;
  onSetGoal: () => void;
}) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const AMBER = Colors.warning;
  const taskDelta = completedToday - yesterdayCompleted;
  const taskDeltaColor = taskDelta > 0 ? Colors.accent : taskDelta < 0 ? ROSE : Colors.subtext;
  const taskDeltaLabel = taskDelta > 0 ? '↑ vs yesterday' : taskDelta < 0 ? '↓ vs yesterday' : 'Same as yesterday';

  const rateDiff = weeklyRate !== null && lastWeekRate !== null ? weeklyRate - lastWeekRate : null;
  const rateColor = rateDiff !== null && rateDiff > 2 ? Colors.accent : rateDiff !== null && rateDiff < -2 ? ROSE : Colors.subtext;
  const rateLabel = rateDiff !== null && rateDiff > 2 ? `+${rateDiff}% this week` : rateDiff !== null && rateDiff < -2 ? `${rateDiff}% this week` : 'Steady this week';

  const noTarget = dailyGoalSeconds <= 0;
  const remaining = dailyGoalSeconds - focusSecondsToday;
  const focusValue = focusSecondsToday > 0 ? formatDuration(focusSecondsToday) : '—';
  const focusSubLabel = noTarget ? 'Set a goal →' : focusSecondsToday === 0 ? 'Start your first session' : remaining > 0 ? `${formatDuration(remaining)} to goal` : 'Goal reached ✓';
  const focusSubColor = noTarget || focusSecondsToday === 0 ? Colors.subtext : remaining > 0 ? AMBER : Colors.accent;

  const pillStyle = { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 12, borderWidth: 0.5, borderColor: Colors.border };

  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 16 }}>
      <View style={pillStyle}>
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '800', marginBottom: 1 }}>{completedToday}/{totalActive}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 3 }}>TASKS DONE</Text>
        <Text style={{ color: taskDeltaColor, fontSize: 10, fontWeight: '600' }}>{taskDeltaLabel}</Text>
      </View>
      <View style={pillStyle}>
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '800', marginBottom: 1 }}>{weeklyRate !== null ? `${weeklyRate}%` : '—'}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 3 }}>COMPLETION</Text>
        <Text style={{ color: rateColor, fontSize: 10, fontWeight: '600' }}>{rateLabel}</Text>
      </View>
      {/* Always tappable. This used to be `onPress={noTarget ? onSetGoal : undefined}`,
          but the goal clamps to a minimum, so noTarget could never be true — the
          picker was unreachable and the goal could not be changed at all.
          `noTarget` itself is kept as a guard: the goal is read off disk, where
          no clamp applies, and "Goal reached ✓" on a zero goal is the one
          reading that would be actively wrong. */}
      <TouchableOpacity
        onPress={onSetGoal}
        activeOpacity={0.7}
        style={pillStyle}
        accessibilityRole="button"
        accessibilityLabel="Change daily focus goal"
      >
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '800', marginBottom: 1 }}>{focusValue}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 3 }}>FOCUS TODAY</Text>
        <Text style={{ color: focusSubColor, fontSize: 10, fontWeight: '600' }}>{focusSubLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── GoalZoneRow — compact goal row used in Zone 2 of the main screen ─────────
// Spells out the components behind a blended percentage, so a 'both' goal at 58%
// isn't opaque — e.g. "3/5 tasks · 8/12 sessions".
function goalSubMetrics(goal: TaskGoal): string {
  const parts: string[] = [];
  if (goal.progressMode !== 'sessions') {
    parts.push(`${goal.completedTaskCount}/${goal.linkedTaskCount} tasks`);
  }
  if (goal.progressMode !== 'tasks' && goal.targetSessions) {
    parts.push(`${goal.actualSessions}/${goal.targetSessions} sessions`);
  }
  return parts.join(' · ');
}

function GoalZoneRow({ goal }: { goal: TaskGoal }) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  // Server-computed. Recomputing from the local task list gave a different
  // answer (it excludes recurring templates) and couldn't see the sessions
  // component at all.
  const pct = Math.round(goal.overallProgress * 100);
  const ts = useTagStyle(goal.tag ?? '');
  const deadlineDays = daysUntilLocalDate(goal.deadline);
  const deadlineLabel = formatDeadlineLabel(goal.deadline);
  const barColor = pct >= 100 ? Colors.accent : Colors.primary;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
        {goal.tag && (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: ts.bg, marginRight: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: ts.text }}>{ts.icon} {goal.tag}</Text>
          </View>
        )}
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
          {goal.title}
        </Text>
        <Text style={{ color: pct >= 100 ? Colors.accent : Colors.textBright, fontSize: 14, fontWeight: '800', marginLeft: 10 }}>
          {pct}%
        </Text>
      </View>
      <View style={{ height: 5, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 3, backgroundColor: barColor }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: Colors.subtext, fontSize: 10 }}>
          {goalSubMetrics(goal)}
        </Text>
        {deadlineLabel && (
          <Text style={{ color: (deadlineDays ?? 0) < 0 ? ROSE : Colors.subtext, fontSize: 10 }}>
            {deadlineLabel}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── GoalCard ─────────────────────────────────────────────────────────────────
function GoalCard({ goal, onLongPressTag }: { goal: TaskGoal; onLongPressTag?: (t: string) => void }) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const pct = Math.round(goal.overallProgress * 100);
  const ts = useTagStyle(goal.tag ?? '');
  const deadlineDays = daysUntilLocalDate(goal.deadline);
  const deadlineLabel = formatDeadlineLabel(goal.deadline);
  // A finished goal is never late, however long its date has been gone.
  const isOverdue = !goal.isCompleted && deadlineDays !== null && deadlineDays < 0;
  // Nothing linked means 0% forever, and the number alone cannot say why.
  // The most common cause is a goal that predates goals being counted in tasks.
  const isEmpty = !goal.isCompleted && goal.linkedTaskCount === 0;

  return (
    <View style={[
      styles.card,
      { marginBottom: 12 },
      isOverdue && { borderColor: ROSE, borderWidth: 1 },
    ]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{goal.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {isOverdue && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: ROSE }}>
                <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: '#fff' }}>OVERDUE</Text>
              </View>
            )}
            {goal.tag && (
              <TouchableOpacity onLongPress={() => onLongPressTag?.(goal.tag!)} delayLongPress={400}
                style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: ts.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: ts.text }}>{ts.icon} {goal.tag}</Text>
              </TouchableOpacity>
            )}
            {deadlineLabel && <Text style={{ color: isOverdue ? ROSE : Colors.subtext, fontSize: 11 }}>{deadlineLabel}</Text>}
          </View>
        </View>
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '800' }}>{pct}%</Text>
      </View>
      <View style={{ height: 6, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 3, backgroundColor: goal.isCompleted ? Colors.accent : Colors.primary }} />
      </View>
      {isEmpty ? (
        // States the fact and stops there: tapping this card opens the stats
        // modal, whose status line already offers the link-a-task action. Copy
        // that promises something the gesture does not do is worse than none.
        <Text style={{ color: Colors.warning, fontSize: 12 }}>
          No tasks linked yet.
        </Text>
      ) : (
        <Text style={{ color: Colors.subtext, fontSize: 12 }}>{goalSubMetrics(goal)}</Text>
      )}
    </View>
  );
}

// ─── Hero card shared header ──────────────────────────────────────────────────
function HeroLabel({ text, color }: { text: string; color?: string }) {
  const Colors = useTheme();
  return <Text style={{ color: color ?? Colors.subtext, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>{text}</Text>;
}

// ─── Card 1: Urgency ──────────────────────────────────────────────────────────
function UrgencyCard({ tasks, onTaskPress }: { tasks: Task[]; onTaskPress: (task: Task) => void }) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  // One clock for the whole pass. The previous `new Date()` inside .map ran once
  // per task, so a list evaluated across midnight could measure two different
  // "todays" in one render.
  // One clock for the whole pass, and one ordering rule shared with the two
  // gates that decide whether this card renders at all.
  const now = new Date();
  const urgent = urgentTasks(tasks, now).slice(0, 3);

  if (urgent.length === 0) return null;

  const overdue = urgent.filter((u) => u.daysLeft < 0).length;
  // Amber for a fresh slip, rose once it has been sitting. ROSE is this app's
  // destructive colour — the delete button, and `error` itself in the light
  // palette — so it has to be earned rather than applied to anything late.
  const dayColor = (d: number) => (d < -2 ? ROSE : d <= 1 ? AMBER : Colors.subtext);
  const dayLabel = (d: number) =>
    d < 0 ? formatOverdue(d) : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d`;
  // "Due soon" is simply false once overdue rows are in the list, and calling the
  // whole card "Overdue" mislabels the today-items sitting underneath.
  const heading = overdue === 0
    ? '⚠ Due soon'
    : overdue === urgent.length
      ? `⚠ ${overdue} overdue`
      : '⚠ Needs attention';
  const accent = overdue > 0 ? AMBER : ROSE;

  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: accent }]}>
      <HeroLabel text={heading} color={accent} />
      {urgent.map(({ task: t, daysLeft }) => (
        <TouchableOpacity
          key={t.id}
          onPress={() => onTaskPress(t)}
          accessibilityRole="button"
          accessibilityLabel={`${t.title}, ${dayLabel(daysLeft)}`}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, marginBottom: 4 }}
        >
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dayColor(daysLeft), marginRight: 10 }} />
          <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>{t.title}</Text>
          <Text style={{ color: dayColor(daysLeft), fontSize: 12, fontWeight: '700', marginLeft: 8 }}>
            {dayLabel(daysLeft)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Card 2: Goal Progress ────────────────────────────────────────────────────
function GoalProgressCard({ goals, onGoalPress }: { goals: TaskGoal[]; onGoalPress: (goalId: string) => void }) {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const activeGoals = goals.filter((g) => !g.isCompleted && !g.isArchived);
  if (activeGoals.length === 0) return null;

  // Surface the goal most at risk, not the one closest to done. Sorting by
  // completion meant a goal with nothing linked read 0% and could never appear —
  // even with a deadline tomorrow, which is exactly when it needs attention.
  // Soonest deadline wins; no deadline sorts last; ties break toward the goal
  // with further to go.
  const goal = [...activeGoals].sort((a, b) => {
    const da = daysUntilLocalDate(a.deadline);
    const db = daysUntilLocalDate(b.deadline);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return a.overallProgress - b.overallProgress;
  })[0];

  const pct = Math.round(goal.overallProgress * 100);
  const deadlineLabel = formatDeadlineLabel(goal.deadline);
  const milestones = [25, 50, 75, 100];

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => onGoalPress(goal.id)} accessibilityRole="button" accessibilityLabel={`View goal ${goal.title}`} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
      <HeroLabel text="🎯 Goal progress" />
      <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700', marginBottom: 12 }} numberOfLines={2}>{goal.title}</Text>
      <View style={{ height: 7, backgroundColor: Colors.inactive, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 4, backgroundColor: pct >= 100 ? Colors.accent : Colors.primary }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        {milestones.map((m) => (
          <View key={m} style={{ alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pct >= m ? Colors.accent : Colors.inactive }} />
            <Text style={{ color: Colors.subtext, fontSize: 9 }}>{m}%</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 12 }}>
        {pct}% · {goalSubMetrics(goal)}{deadlineLabel ? ` · ${deadlineLabel}` : ''}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Card 3: Time Nudge ───────────────────────────────────────────────────────
function TimeNudgeCard({ peakHour, sessionHistory }: { peakHour: number | null; sessionHistory: SessionRecord[] }) {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const now = new Date();
  const hourLabel = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() < 12 ? 'am' : 'pm'}`;
  const peakLabel = peakHour !== null ? formatPeakWindow(peakHour) : '—';

  const counts: Record<number, number> = {};
  for (const s of sessionHistory) counts[new Date(s.completedAt).getHours()] = (counts[new Date(s.completedAt).getHours()] ?? 0) + 1;
  const maxCount = Math.max(...Object.values(counts), 1);
  const bars = Array.from({ length: 12 }, (_, i) => ({ h: (18 + i) % 24, isPeak: (18 + i) % 24 === peakHour }))
    .map(({ h, isPeak }) => ({ pct: ((counts[h] ?? 0) / maxCount) * 100, isPeak }));

  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.accent }]}>
      <HeroLabel text={`⚡ Peak time — ${hourLabel}`} color={Colors.accent} />
      <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
        You focus best around {peakLabel}
      </Text>
      <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 12 }}>
        Now is your prime focus window
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 36, gap: 2, marginBottom: 12 }}>
        {bars.map(({ pct, isPeak }, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(3, pct / 100 * 36), borderRadius: 2, backgroundColor: isPeak ? Colors.accent : pct >= 60 ? Colors.primarySoft : pct >= 25 ? Colors.primary + '60' : Colors.inactive }} />
        ))}
      </View>
    </View>
  );
}

// ─── Card 4: Momentum ─────────────────────────────────────────────────────────
function MomentumCard({ currentStreak, longestStreak, sessionHistory }: { currentStreak: number; longestStreak: number; sessionHistory: SessionRecord[] }) {
  const Colors = useTheme();
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const isPersonalBest = currentStreak > 0 && currentStreak === longestStreak;
  const thisWeekStart = startOfThisWeekMs();
  const thisWeekHours = sessionHistory
    .filter((s) => s.completedAt >= thisWeekStart).reduce((sum, s) => sum + s.durationSeconds, 0) / 3600;

  let last4Total = 0;
  for (let n = 1; n <= 4; n++) {
    const wStart = startOfWeekNMs(n); const wEnd = startOfWeekNMs(n - 1);
    last4Total += sessionHistory.filter((s) => s.completedAt >= wStart && s.completedAt < wEnd).reduce((sum, s) => sum + s.durationSeconds, 0);
  }
  const last4Avg = last4Total / 4 / 3600;
  const isAhead = thisWeekHours > last4Avg;

  // Week dots Mon(1)–Sun(0)
  const weekDots = [1, 2, 3, 4, 5, 6, 0].map((day) =>
    sessionHistory.some((s) => { const d = new Date(s.completedAt); return s.completedAt >= thisWeekStart && d.getDay() === day; }),
  );
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: AMBER }]}>
      <HeroLabel text="🔥 Momentum" color={AMBER} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: Colors.textBright, fontSize: 36, fontWeight: '800', marginRight: 12 }}>{currentStreak}</Text>
        <View>
          <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '700' }}>day streak</Text>
          <Text style={{ color: isPersonalBest ? AMBER : Colors.subtext, fontSize: 12 }}>{isPersonalBest ? '🔥 Personal best!' : 'Study today to keep it alive'}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        {weekDots.map((active, i) => (
          <View key={i} style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: active ? Colors.accent : Colors.inactive }} />
            <Text style={{ color: Colors.subtext, fontSize: 9 }}>{dayLabels[i]}</Text>
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: isAhead ? Colors.accent + '15' : AMBER + '15', borderRadius: 10, padding: 10 }}>
        <Text style={{ color: isAhead ? Colors.accent : AMBER, fontSize: 12, fontWeight: '600' }}>
          {isAhead
            ? `Best week this month ↑ +${(thisWeekHours - last4Avg).toFixed(1)}h vs avg`
            : `${(last4Avg - thisWeekHours).toFixed(1)}h behind your average — keep going`}
        </Text>
      </View>
    </View>
  );
}

// ─── Card 5: Self-comparison ──────────────────────────────────────────────────
function SelfComparisonCard({ sessionHistory }: { sessionHistory: SessionRecord[] }) {
  const Colors = useTheme();
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const thisWeekStart = startOfThisWeekMs();
  const lastWeekStart = startOfWeekNMs(1);
  const thisHours = sessionHistory.filter((s) => s.completedAt >= thisWeekStart).reduce((sum, s) => sum + s.durationSeconds, 0) / 3600;
  const lastHours = sessionHistory.filter((s) => s.completedAt >= lastWeekStart && s.completedAt < thisWeekStart).reduce((sum, s) => sum + s.durationSeconds, 0) / 3600;
  const delta = thisHours - lastHours;
  const isAhead = delta > 0;
  const isNew = thisHours === 0 && lastHours === 0;

  if (isNew) {
    return (
      <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
        <HeroLabel text="📊 Your progress" />
        <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700' }}>
          Complete your first focus session to start tracking your progress.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
      <HeroLabel text="📊 This week vs last week" />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16, marginBottom: 12 }}>
        <View>
          <Text style={{ color: Colors.textBright, fontSize: 32, fontWeight: '800' }}>{thisHours.toFixed(1)}h</Text>
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>this week</Text>
        </View>
        <View style={{ paddingBottom: 4 }}>
          <Text style={{ color: Colors.subtext, fontSize: 20, fontWeight: '300' }}>vs</Text>
        </View>
        <View>
          <Text style={{ color: Colors.subtext, fontSize: 22, fontWeight: '700' }}>{lastHours.toFixed(1)}h</Text>
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>last week</Text>
        </View>
      </View>
      <View style={{ backgroundColor: isAhead ? Colors.accent + '15' : AMBER + '15', borderRadius: 10, padding: 10 }}>
        <Text style={{ color: isAhead ? Colors.accent : AMBER, fontSize: 12, fontWeight: '600' }}>
          {isAhead ? `↑ ${delta.toFixed(1)}h ahead of last week` : `${Math.abs(delta).toFixed(1)}h behind last week — you can catch up`}
        </Text>
      </View>
    </View>
  );
}

// ─── Card 6: Recent Activity ──────────────────────────────────────────────────
// Was a standalone section above the pill strip. It answers "what have I already
// done", which is the same question SelfComparisonCard asks at a different
// resolution — so it belongs in the rotation rather than competing for the top of
// the screen with the cards that drive action.
function RecentActivityCard() {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  return (
    <View style={styles.card}>
      <HeroLabel text="🕒 Recent activity" />
      <RecentActivity limit={4} />
    </View>
  );
}

// ─── HeroCard (swipe via RNGH Gesture.Pan + tappable dots) ────────────────────
function HeroCard({ activeCard, setCard, tasks, goals, sessionHistory, peakHour, currentStreak, longestStreak, hasActivity, onTaskPress, onGoalPress }: {
  activeCard: HeroCardType; setCard: (c: HeroCardType) => void;
  tasks: Task[]; goals: TaskGoal[]; sessionHistory: SessionRecord[]; peakHour: number | null;
  currentStreak: number; longestStreak: number; hasActivity: boolean;
  onTaskPress: (task: Task) => void; onGoalPress: (goalId: string) => void;
}) {
  const Colors = useTheme();
  // Only include cards that have real content — prevents empty cards (urgency with no
  // due tasks, goal_progress with no goals) from falling back to self_comparison and
  // appearing as duplicate cards in the rotation. self_comparison is always the anchor.
  const availableCards = CARD_ORDER.filter((c) => {
    switch (c) {
      case 'urgency':
        // Whatever the card would actually render. Asking the same function
        // rather than re-deriving the rule is what stops this gate and the card
        // disagreeing — which they did, in two different ways, before.
        return urgentTasks(tasks, new Date()).length > 0;
      case 'goal_progress': return goals.some((g) => !g.isCompleted && !g.isArchived);
      case 'time_nudge':    return peakHour !== null;
      case 'momentum':      return currentStreak > 0;
      case 'recent_activity': return hasActivity;
      case 'self_comparison': return true;
      default: return false;
    }
  });

  const effectiveCard = availableCards.includes(activeCard) ? activeCard : 'self_comparison';
  const idx = Math.max(0, availableCards.indexOf(effectiveCard));

  const go = (dir: 'next' | 'prev') => {
    if (availableCards.length <= 1) return;
    const nextIdx = dir === 'next'
      ? (idx + 1) % availableCards.length
      : (idx - 1 + availableCards.length) % availableCards.length;
    setCard(availableCards[nextIdx]);
  };

  // Horizontal swipe paging via react-native-gesture-handler (cooperates with the
  // vertical ScrollView). tx always returns to 0, so the card can never strand off-screen.
  const tx = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])   // only claim the gesture on horizontal movement
    .failOffsetY([-12, 12])     // let vertical scrolling pass through
    .onUpdate((e) => { tx.value = e.translationX * 0.4; })
    .onEnd((e) => {
      if (e.translationX <= -48) runOnJS(go)('next');
      else if (e.translationX >= 48) runOnJS(go)('prev');
      tx.value = withTiming(0, { duration: 150 });
    });
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const renderCard = () => {
    switch (effectiveCard) {
      case 'urgency':         return <UrgencyCard tasks={tasks} onTaskPress={onTaskPress} />;
      case 'goal_progress':   return <GoalProgressCard goals={goals} onGoalPress={onGoalPress} />;
      case 'time_nudge':      return <TimeNudgeCard peakHour={peakHour} sessionHistory={sessionHistory} />;
      case 'momentum':        return <MomentumCard currentStreak={currentStreak} longestStreak={longestStreak} sessionHistory={sessionHistory} />;
      case 'self_comparison': return <SelfComparisonCard sessionHistory={sessionHistory} />;
      case 'recent_activity': return <RecentActivityCard />;
      default:                return <SelfComparisonCard sessionHistory={sessionHistory} />;
    }
  };

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={animStyle}>
          {renderCard()}
        </Reanimated.View>
      </GestureDetector>
      {/* Page indicator dots — one per available card */}
      {availableCards.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12, gap: 6 }}>
          {availableCards.map((card) => (
            <TouchableOpacity key={card} onPress={() => setCard(card)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <View style={{
                width: card === effectiveCard ? 20 : 6, height: 6, borderRadius: 3,
                backgroundColor: card === effectiveCard ? Colors.primary : Colors.inactive,
              }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
type ActiveView = null | 'goal-detail' | 'task-list';

export default function TasksScreen() {
  const Colors = useTheme();
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const tasks = useTasksList();
  // Every recurring task, so one with no row today still appears. GET /tasks
  // lists a recurring task only on the days it is due.
  const recurringTemplates = useTaskStore((s) => s.recurringTemplates);
  const selectedTaskId = useSelectedTaskId();
  const taskActions = useTaskActions();
  const settings = useSettings();
  const sessionLengthMinutes = Math.round(settings.workDuration / 60);

  const goals = useGoalStore((s) => s.goals);

  const router = useRouter();
  const dailyFocusMinutes = settings.dailyFocusMinutes;
  const streak = useGamificationStore((s) => s.currentStreak ?? 0);
  const longestStreak = useGamificationStore((s) => s.longestStreak ?? 0);
  // Drives whether the recent-activity card appears in the rotation at all. The
  // screen fetches it (below) rather than leaving it to the card: a card that is
  // filtered out never mounts, so a card-owned fetch could never populate itself.
  const hasActivity = useGamificationStore((s) => s.activity.length > 0);

  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>(null);
  // See more always opens on All (D3). This screen stays mounted as a tab, so
  // the reset has to happen on every open rather than on mount.
  const [boardTab, setBoardTab] = useState<BoardTab>('all');
  const openTaskList = useCallback(() => { setBoardTab('all'); setActiveView('task-list'); }, []);
  // One period for both the summary card and the full report, so "See more"
  // always opens the period you were already looking at.
  const [statsTask, setStatsTask] = useState<Task | null>(null);
  // Held as an ID, not the goal object: GoalStatsModal reads the goal live from
  // the store so it cannot show numbers that went stale while it was open, or
  // render a goal that was deleted underneath it.
  const [statsGoalId, setStatsGoalId] = useState<string | null>(null);
  // The task form, shared with the calendar: open/edit state, save with retry,
  // delete and the recurring refresh all live in the hook.
  const taskForm = useTaskForm();
  const { openCreate: openTaskCreate, openEdit: openTaskEdit } = taskForm;
  // Wrapped so an onPress event is never passed through as a prefill.
  const openCreate = useCallback(() => openTaskCreate(), [openTaskCreate]);
  const openEdit = useCallback((task: Task) => openTaskEdit(task), [openTaskEdit]);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [formGoal, setFormGoal] = useState<TaskGoal | null>(null);
  const [overrideTag, setOverrideTag] = useState<string | null>(null);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [draftTarget, setDraftTarget] = useState(dailyFocusMinutes);
  const setDailyFocusMinutes = useTimerStore((s) => s.setDailyFocusMinutes);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load data ──
  useEffect(() => {
    useTagOverrideStore.getState().loadOverrides();
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    if (useTaskStore.getState().tasks.length === 0) {
      useTaskStore.getState().hydrateTasks(userId).then(() => useTaskStore.getState().fetchTasks(true));
    }
    // Today's recurring rows depend on the day, so read them fresh.
    useTaskStore.getState().refreshRecurring();
    // Sibling: proactively reset the overall day-streak on a missed day.
    useGamificationStore.getState().checkAndResetDayStreak();
  }, []);

  // When the app returns to foreground it may be a new day, with new rows.
  useAppForeground(() => {
    useTaskStore.getState().refreshRecurring();
    useGamificationStore.getState().checkAndResetDayStreak();
  });

  const loadSessionHistory = useCallback(async () => {
    try {
      const hist = await getSessionHistory();
      setSessionHistory(hist);
      // Deliver anything queued first, so the server list below already has it.
      await syncQueuedSessions();
      const userId = useAuthStore.getState().user?.id;
      const res = await api.get<{ sessions: { id: string; completedAt: string; durationSeconds: number; taskId: string | null; taskLabel: string | null; clientSessionId: string | null }[] }>('/timer/sessions');
      if (res.success && res.data?.sessions) {
        const queued = userId ? await getQueuedSessionIds(userId) : new Set<string>();
        await mergeWithServerSessions(res.data.sessions, queued);
        setSessionHistory(await getSessionHistory());
      }
    } catch { /* non-critical */ }
  }, []);

  useFocusEffect(useCallback(() => {
    useTaskStore.getState().fetchTasks(true);
    useGoalStore.getState().fetchGoals(true);
    useGamificationStore.getState().fetchActivity();
    // Templates were only ever fetched after editing a recurring task, so the
    // store was empty on a cold start and nothing could render them.
    useTaskStore.getState().fetchRecurringTemplates();
    loadSessionHistory();
  }, [loadSessionHistory]));

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // The task details sheet's "load timer". Refused while a focus session runs
  // (stores/sessionLock): switching then would move the session's time to the
  // other task. The toast says so, and screen readers hear it.
  const loadTaskIntoTimer = useCallback((id: string) => {
    setStatsTask(null);
    if (taskActions.selectTask(id)) return;
    const running = useTaskStore.getState().tasks.find((t) => t.id === useTaskStore.getState().selectedTaskId);
    const message = `A session is running on ${running?.title ?? 'another task'}. Finish it to switch tasks.`;
    showToast(message);
    AccessibilityInfo.announceForAccessibility(message);
  }, [taskActions, showToast]);

  // ── Date anchors — live clock, updates at the start of every minute ──
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const monday = useMemo(() => getMonday(now), [now]);
  const nextMonday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() + 7); return d; }, [monday]);
  const todayColIndex = useMemo(() => { const d = now.getDay(); return d === 0 ? 6 : d - 1; }, [now]);
  // Overdue goals first, worst first; everything else keeps its order. A goal
  // whose date has passed is the one thing on this screen needing a decision
  // rather than a glance, so it should not sit somewhere down the list. Lives
  // here, with the other clock-derived memos, because `now` is a live value —
  // reading it above its own declaration is a temporal dead zone crash.
  const goalsByUrgency = useMemo(() => sortGoalsByUrgency(goals, now), [goals, now]);

  // ── Session analytics ──
  const todaySessions = useMemo(() => sessionHistory.filter((s) => s.type === 'focus' && isToday(s.completedAt)), [sessionHistory]);
  const sessionsToday = todaySessions.length;
  const focusSecondsToday = useMemo(() => todaySessions.reduce((sum, s) => sum + s.durationSeconds, 0), [todaySessions]);

  // Seconds, not session count: a 90-minute session and a 5-minute one are not
  // the same amount of work and must not draw the same bar.
  const thisWeekByDay = useMemo(() => {
    const seconds = [0,0,0,0,0,0,0];
    for (const s of sessionHistory) { if (s.type !== 'focus') continue; const d = new Date(s.completedAt); if (d >= monday && d < nextMonday) { const dow = d.getDay(); seconds[dow === 0 ? 6 : dow-1] += s.durationSeconds; } }
    return seconds;
  }, [sessionHistory, monday, nextMonday]);

  const maxDaySeconds = useMemo(() => Math.max(...thisWeekByDay, 1), [thisWeekByDay]);

  // Tasks finished per weekday. Reads the UNFILTERED task list on purpose:
  // completed recurring instances are archived the next day, and a habit you
  // ticked on Monday is still a task you finished this week. Filtering to
  // nonArchived would quietly erase every habit completion older than today —
  // the same trap loadGoalCounts documents on the server.
  const tasksDoneByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const t of tasks) {
      if (!t.isCompleted || !t.completedAt) continue;
      const d = new Date(t.completedAt);
      if (d >= monday && d < nextMonday) {
        const dow = d.getDay();
        counts[dow === 0 ? 6 : dow - 1] += 1;
      }
    }
    return counts;
  }, [tasks, monday, nextMonday]);
  const maxTasksInDay = useMemo(() => Math.max(...tasksDoneByDay, 1), [tasksDoneByDay]);


  // Category totals used to be derived here, from the local session cache, and
  // that second derivation is what disagreed with the server. The Time Tracker
  // card reads GET /time-report now, so there is nothing left to compute.

  // ── Peak focus ──
  const allFocusSessions = useMemo(() => sessionHistory.filter((s) => s.type === 'focus'), [sessionHistory]);
  const peakHour = useMemo(() => getPeakHour(allFocusSessions), [allFocusSessions]);
  const weeklyCompletionRate = useMemo(() => getCompletionRate(tasks, 'week'), [tasks]);

  // ── Task groups ──
  const nonArchived = useMemo(() => tasks.filter((t) => !t.isArchived), [tasks]);

  // ── Plan vs actual for today ──
  // Focus comes from the same local history as the Focus today pill, so the
  // two never disagree (design D7); the plan is today's work blocks and
  // today's timed recurring rows. lib/planVsActual holds the rules the calendar shares.
  const todayKey = getLocalDateString(now);
  const todayTimeline = useMemo(() => timelineFromHistory(todaySessions, todayKey), [todaySessions, todayKey]);
  const todayBlocks = useMemo(
    () => plannedBlocksFromTasks(
      nonArchived.filter((t) => !t.isRecurring || (t.isOccurrence && t.occurrenceDate === todayKey)),
      todayKey,
    ),
    [nonArchived, todayKey],
  );
  const todayPlan = useMemo(() => planVsActual(todayKey, todayBlocks, todayTimeline), [todayKey, todayBlocks, todayTimeline]);
  const [sessionsTarget, setSessionsTarget] = useState<SessionsTarget | null>(null);
  const statsFocused = useMemo((): FocusedOnDay | undefined => {
    if (!statsTask) return undefined;
    // The same helper as the calendar sheet and the Week lane, so they agree.
    const focus = taskFocusOnDay(todayPlan, statsTask.id);
    if (!focus && !todayBlocks.some((b) => b.taskId === statsTask.id)) return undefined;
    return {
      dayLabel: 'today',
      seconds: focus?.seconds ?? 0,
      sessions: focus?.sessions ?? 0,
      plannedMinutes: focus?.plannedMinutes ?? null,
    };
  }, [statsTask, todayPlan, todayBlocks]);
  // One sheet at a time: the task sheet closes before the session list opens.
  const showTaskSessions = useCallback(() => {
    if (!statsTask) return;
    setSessionsTarget({ by: 'task', key: statsTask.id, from: todayKey, to: todayKey, title: statsTask.title, subtitle: 'Today' });
    setStatsTask(null);
  }, [statsTask, todayKey]);

  // ── Pill strip data ──
  const completedToday = useMemo(() => tasks.filter((t) => t.isCompleted && t.completedAt && isToday(new Date(t.completedAt).getTime())).length, [tasks]);
  const yesterdayCompleted = useMemo(() => tasks.filter((t) => t.isCompleted && t.completedAt && isYesterdayLocal(new Date(t.completedAt).getTime())).length, [tasks]);
  const totalActiveTasks = nonArchived.length;
  const lastWeekCompletionRate = useMemo(() => getLastWeekCompletionRate(tasks), [tasks]);
  // The stored goal, in the unit everything else on this screen counts in.
  // Shared with the Focus tab's "Target left" card — see lib/dailyTarget.ts.
  const dailyGoalSeconds = dailyFocusMinutes * 60;

  // ── Smart hero card ──
  const goalsForHero = goals; // goalStore exists; pass through
  const hero = useHeroCard({ tasks, goals: goalsForHero, sessionHistory, peakHour });
  const goToFocus = useCallback(() => router.push('/(tabs)/focus'), [router]);

  // ── Task board ──
  // The main tab's top tasks and the See-more sections both come from here.
  // Deliberately kept apart from `nonArchived`: that array feeds
  // totalActiveTasks and the PillStrip denominator, and counting recurring
  // templates there would show a completion total the user can never reach.
  const board = useMemo(
    () => buildTaskBoard({ tasks, templates: recurringTemplates as RecurringTemplate[], now }),
    [tasks, recurringTemplates, now],
  );
  const topOpenTasks = useMemo(() => topTasks(nonArchived, now, TOP_TASK_COUNT), [nonArchived, now]);
  const hiddenOpenCount = board.notStarted.length + board.inProgress.length - topOpenTasks.length;

  // ── Focus button ──
  // The only start action at the top of Today. Every state only opens Focus;
  // pressing play there is the next tap (design DD2). See lib/startFocusTarget.
  const tasksLoaded = useTaskStore((s) => s.hasLoaded);
  const tasksError = useTaskStore((s) => s.error);
  const timerStatus = useTimerStore((s) => s.status);
  const timerPhase = useTimerStore((s) => s.currentPhase);
  const focusButton = focusButtonState({
    topOpenTasks,
    hasAnyTasks: tasks.length > 0 || recurringTemplates.length > 0,
    hasLoaded: tasksLoaded,
    loadFailed: tasksError != null,
    status: timerStatus,
    phase: timerPhase,
    sessionTaskTitle: tasks.find((t) => t.id === selectedTaskId)?.title ?? null,
  });
  const onFocusButton = () => {
    switch (focusButton.kind) {
      case 'loading':
        return;
      case 'addFirstTask':
        openCreate();
        return;
      case 'target':
        taskActions.selectTask(focusButton.taskId);
        goToFocus();
        return;
      default:
        goToFocus();
    }
  };
  // On All, all three sections always render so the categories stay put; an
  // empty one says what would put something there. Another tab shows its one
  // section (D4). With nothing at all, no sections, so the list's own empty
  // state shows instead.
  const boardSections = useMemo(() => {
    const sections: { key: TaskStatus; title: string; dotColor: string; data: BoardItem[]; emptyText: string }[] = [
      { key: 'not_started', title: 'Not started', dotColor: Colors.subtext, data: board.notStarted, emptyText: 'Nothing waiting to be started.' },
      { key: 'in_progress', title: 'In progress', dotColor: Colors.primary, data: board.inProgress, emptyText: 'Run a focus session on a task and it moves here.' },
      { key: 'completed', title: 'Completed', dotColor: Colors.accent, data: board.completed, emptyText: 'Nothing finished yet. The first one counts most.' },
    ];
    if (!sections.some((section) => section.data.length > 0)) return [];
    return boardTab === 'all' ? sections : sections.filter((section) => section.key === boardTab);
  }, [board, Colors, boardTab]);
  const boardTabs = useMemo((): RoundedTab<BoardTab>[] => {
    const counts = { not_started: board.notStarted.length, in_progress: board.inProgress.length, completed: board.completed.length };
    return [
      { key: 'all', label: 'All', count: counts.not_started + counts.in_progress + counts.completed, countNoun: 'tasks' },
      { key: 'not_started', label: 'Not started', count: counts.not_started, countNoun: 'tasks' },
      { key: 'in_progress', label: 'In progress', count: counts.in_progress, countNoun: 'tasks' },
      { key: 'completed', label: 'Completed', count: counts.completed, countNoun: 'tasks' },
    ];
  }, [board]);

  // ── Handlers ──
  /**
   * The inline action offered by the goal modal's status line.
   *
   * Every branch closes the sheet first: all three destinations are themselves
   * modal or navigational, and two sheets open at once is the stacking bug
   * FormSheet already documents.
   */
  const handleGoalAction = useCallback((action: GoalStatusAction, goalId: string) => {
    setStatsGoalId(null);
    if (action === 'start-session') { router.push('/(tabs)/focus'); return; }
    // Both linking and rescheduling now happen in the GOAL form: it owns the
    // due date, and since goals became task-counted it owns the task list too.
    // `link-task` used to open a blank NEW task form, because taskGoalId could
    // only be set from the task side — so repairing an empty goal meant
    // creating a task and remembering to pick the right goal on it. Opening the
    // goal itself is the same repair in one step, against the goal you tapped.
    const goal = goals.find((g) => g.id === goalId);
    if (goal) { setFormGoal(goal); setShowGoalForm(true); }
  }, [router, goals]);

  // ── Notifications inbox ──
  // Fetched each time Today gains focus: tabs stay mounted, so a mount-only
  // fetch would leave the badge stale after the first visit.
  const unreadCount = useSocialStore((s) => s.unreadCount);
  const fetchNotifications = useSocialStore((s) => s.fetchNotifications);
  const markNotificationsRead = useSocialStore((s) => s.markNotificationsRead);
  const [showInbox, setShowInbox] = useState(false);
  useFocusEffect(useCallback(() => { fetchNotifications(); }, [fetchNotifications]));
  const openInbox = useCallback(() => {
    markNotificationsRead();
    setShowInbox(true);
  }, [markNotificationsRead]);

  const handleComplete = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await taskActions.toggleComplete(taskId);
    showToast(task.isCompleted ? 'Marked incomplete' : '✓ Marked complete');
  }, [tasks, taskActions, showToast]);


  /**
   * Stable renderItem for the All Tasks list.
   *
   * Defined once rather than inline so SectionList is not handed a new function
   * on every render — which would defeat the memo on TaskRow it exists to serve.
   * Every handler it passes is already a stable reference (useState setters and
   * useCallback'd handlers), so a row only re-renders when its own task,
   * selection or the goals list actually changes.
   */
  const renderBoardItem = useCallback(({ item }: { item: BoardItem }) => (
    item.kind === 'task' ? (
      <TaskRow
        task={item.task}
        isActive={item.task.id === selectedTaskId}
        goals={goals}
        onTap={setStatsTask}
        onEdit={openEdit}
        onComplete={handleComplete}
        onLongPressTag={setOverrideTag}
      />
    ) : (
      <DormantRecurringRow
        template={item.template}
        goals={goals}
        subtitle={nextOccurrenceLabel(item.template)}
        onEdit={openEdit}
        onLongPressTag={setOverrideTag}
      />
    )
  ), [selectedTaskId, goals, openEdit, handleComplete]);

  const closeGoalForm = useCallback(() => { setShowGoalForm(false); setFormGoal(null); }, []);

  // ── Back from detail view ──
  const goBack = useCallback(() => setActiveView(null), []);
  // The report is the Time tab. `at` changes on every tap so asking again for
  // the lens it last opened on still switches back to it.
  const openTime = useCallback((lens: Lens) => {
    router.navigate({ pathname: '/(tabs)/time', params: { lens, at: String(Date.now()) } });
  }, [router]);

  // ─────────────────────────────────────────────────────────────────────────────
  // DETAIL VIEWS
  // ─────────────────────────────────────────────────────────────────────────────

  if (activeView === 'goal-detail') {
    const tasksDoneToday = tasks.filter((t) => t.isCompleted && t.completedAt && isToday(new Date(t.completedAt).getTime())).length;
    const totalActive = nonArchived.length;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
          <TouchableOpacity onPress={goBack} style={{ marginRight: 12 }}><Ionicons name="chevron-back" size={24} color={Colors.text} /></TouchableOpacity>
          <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>Goal Progress</Text>
          <TouchableOpacity onPress={() => { setFormGoal(null); setShowGoalForm(true); }} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TodayPill value={String(sessionsToday)} label="Sessions done" />
              {/* Tappable: this pill IS the daily goal, so it is the natural
                  place to change it. */}
              <TouchableOpacity
                style={{ flex: 1 }}
                activeOpacity={0.7}
                onPress={() => { setDraftTarget(dailyFocusMinutes); setShowTargetPicker(true); }}
                accessibilityRole="button"
                accessibilityLabel={`Daily focus goal ${formatSeconds(dailyGoalSeconds)}. Change it`}
              >
                {/* Shows the goal itself, not what is left of it — "Focus today"
                    sits right beside it and already carries the progress.
                    "Today's target", not "...goal": the old label read as a
                    Goal, which is a different feature entirely, listed below. */}
                <TodayPill value={formatSeconds(dailyGoalSeconds)} label="Today's target" />
              </TouchableOpacity>
              <TodayPill value={formatDuration(focusSecondsToday)} label="Focus today" />
              <TodayPill value={`${tasksDoneToday}/${totalActive}`} label="Tasks done" />
            </View>
          </View>
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>Goals</Text>
              <Text style={{ color: Colors.subtext, fontSize: 12 }}>{goals.filter((g) => !g.isCompleted).length} active</Text>
            </View>
            {goals.length === 0 ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 32 }]}>
                <Text style={{ color: Colors.subtext, fontSize: 13 }}>No goals yet. Group your tasks into something worth finishing.</Text>
              </View>
            ) : goalsByUrgency.map((g) => (
              // Tap opens stats; editing moved to the modal's footer link, the
              // same split TaskRow/TaskStatsModal already uses. Long-press is
              // NOT available as a second hatch here — `onLongPressTag` on the
              // card below already owns that gesture.
              <TouchableOpacity
                key={g.id}
                activeOpacity={0.85}
                onPress={() => setStatsGoalId(g.id)}
                accessibilityRole="button"
                accessibilityLabel={`View goal ${g.title}`}
              >
                <GoalCard goal={g} onLongPressTag={setOverrideTag} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
            <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700', marginBottom: 14 }}>This Week</Text>
            <View style={[styles.card, { flexDirection: 'row', alignItems: 'flex-end' }]}>
              {DAY_LABELS.map((label, i) => <BarColumn key={i} dayLabel={label} value={thisWeekByDay[i]} max={maxDaySeconds} isToday={i === todayColIndex} isFuture={i > todayColIndex} />)}
            </View>
          </View>
          {weeklyCompletionRate !== null && (
            <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
              <View style={[styles.card, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>WEEKLY COMPLETION RATE</Text>
                  <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800', marginTop: 4 }}>{weeklyCompletionRate}%</Text>
                </View>
                <Text style={{ color: weeklyCompletionRate >= 80 ? Colors.accent : weeklyCompletionRate < 50 ? AMBER : Colors.subtext, fontSize: 13, fontWeight: '700' }}>
                  {weeklyCompletionRate >= 80 ? '🎯 Great planning' : weeklyCompletionRate < 50 ? 'Plan fewer tasks' : 'tasks done / planned'}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
        <GoalEditor goal={formGoal} visible={showGoalForm} onClose={closeGoalForm} />
        <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
        {/* Mounted here as well as on Today's main view: this screen owns a control
            that opens it, so it has to be able to render it. */}
        <DailyTargetModal
          visible={showTargetPicker}
          draft={draftTarget}
          onDraftChange={setDraftTarget}
          onCancel={() => setShowTargetPicker(false)}
          onSave={() => { setDailyFocusMinutes(draftTarget); setShowTargetPicker(false); }}
        />
      </SafeAreaView>
    );
  }

  if (activeView === 'task-list') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
          <TouchableOpacity onPress={goBack} style={{ marginRight: 12 }}><Ionicons name="chevron-back" size={24} color={Colors.text} /></TouchableOpacity>
          <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>All Tasks</Text>
          <TouchableOpacity onPress={openCreate} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <RoundedTabs tabs={boardTabs} value={boardTab} onChange={setBoardTab} style={{ marginHorizontal: 20, marginTop: 0 }} />
        {/* Grouped by progress, read from session stats: no sessions is Not
            started, sessions without a tick is In progress. Every recurring
            task appears once — through today's instance when it has one, else
            as its template in Not started, labelled with when it next fires.
            Virtualised, since this is the whole list rather than a capped one. */}
        <SectionList
          sections={boardSections}
          keyExtractor={(item) => (item.kind === 'task' ? item.task.id : `recurring-${item.template.id}`)}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          renderItem={renderBoardItem}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (boardTab === 'all' ? (
            <View style={{ marginTop: section.key === 'not_started' ? 0 : 16 }}>
              <GroupHeader dotColor={section.dotColor} label={section.title} count={section.data.length} />
            </View>
          ) : null)}
          renderSectionFooter={({ section }) => {
            if (section.data.length > 0) return null;
            if (boardTab === 'all') {
              return <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 4 }}>{section.emptyText}</Text>;
            }
            // A tab on its own gets a card and the one action that fills it (D8).
            const action = section.key === 'not_started'
              ? { label: '+ New task', onPress: openCreate }
              : section.key === 'in_progress'
                ? { label: 'Start focus', onPress: goToFocus }
                : null;
            return (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 32, marginTop: 8 }]}>
                <Text style={{ color: Colors.text, fontSize: 13, textAlign: 'center' }}>{section.emptyText}</Text>
                {action && (
                  <TouchableOpacity onPress={action.onPress} accessibilityRole="button" style={{ marginTop: 14, minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{action.label}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 36, marginTop: 8 }]}>
              <Text style={{ color: Colors.subtext, fontSize: 13, textAlign: 'center' }}>
                Nothing planned yet. What has to move today?
              </Text>
            </View>
          }
          ListFooterComponent={boardTab === 'all' || boardTab === 'completed' ? (
            <>
            {/* Under All and Completed only: it counts finished tasks (D6).

                This Week — the same shape the Goals drill-down uses, counting what
                this screen is about. Goals plots focus SECONDS per day; here the
                bars are tasks FINISHED per day, because that is the unit the list
                above is made of.

                Below the list rather than above it, for the same reason it sits
                at the bottom of the Goals screen: the list is why you opened this,
                and a summary that pushes it down is a summary in the way. */}
            <View style={{ marginTop: 28 }}>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700', marginBottom: 14 }}>This Week</Text>
              <View style={[styles.card, { flexDirection: 'row', alignItems: 'flex-end' }]}>
                {DAY_LABELS.map((label, i) => (
                  <BarColumn
                    key={i}
                    dayLabel={label}
                    value={tasksDoneByDay[i]}
                    max={maxTasksInDay}
                    isToday={i === todayColIndex}
                    isFuture={i > todayColIndex}
                    formatValue={(n) => String(n)}
                  />
                ))}
              </View>

              {weeklyCompletionRate !== null && (
                <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', marginTop: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>WEEKLY COMPLETION RATE</Text>
                    <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800', marginTop: 4 }}>{weeklyCompletionRate}%</Text>
                  </View>
                  <Text style={{ color: weeklyCompletionRate >= 80 ? Colors.accent : weeklyCompletionRate < 50 ? AMBER : Colors.subtext, fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>
                    {weeklyCompletionRate >= 80 ? '🎯 Great planning' : weeklyCompletionRate < 50 ? 'Plan fewer tasks' : 'tasks done / planned'}
                  </Text>
                </View>
              )}
            </View>
            </>
          ) : undefined}
        />
        {statsTask && <TaskStatsModal task={statsTask} sessionLengthMinutes={sessionLengthMinutes} focused={statsFocused} onShowSessions={showTaskSessions} onClose={() => setStatsTask(null)} onLoadTimer={loadTaskIntoTimer} onToggleComplete={(id) => { handleComplete(id); setStatsTask(null); }} onEdit={(id) => { setStatsTask(null); const t = tasks.find((x) => x.id === id); if (t) openEdit(t); }} />}
        <TaskFormModal {...taskForm.props} />
        <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
        <SessionsSheet target={sessionsTarget} onClose={() => setSessionsTarget(null)} />
        <Toast message={toast} />
      </SafeAreaView>
    );
  }

  // The calendar view that used to live here has moved to the Calendar tab —
  // there is no reason for two calendars in one app. Days studied / best day /
  // streak now appear in the Calendar tab's Stats panel, and the month heat grid
  // sits under its Month view.

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN SCREEN
  // ─────────────────────────────────────────────────────────────────────────────
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '500', marginBottom: 2 }}>{dateLabel}</Text>
              <Text accessibilityRole="header" style={{ color: Colors.textBright, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>Today</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                onPress={openInbox}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="notifications-outline" size={21} color={Colors.text} />
                {unreadCount > 0 && (
                  <View style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.ROSE }} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openCreate}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="Add task"
                style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
          {/* Today's plan against what actually got focus; hidden on an empty day. */}
          <PlanSummary totals={todayPlan.totals} style={{ marginTop: 14 }} />
        </View>

        {/* Pill strip */}
        <PillStrip
          completedToday={completedToday}
          yesterdayCompleted={yesterdayCompleted}
          totalActive={totalActiveTasks}
          weeklyRate={weeklyCompletionRate}
          lastWeekRate={lastWeekCompletionRate}
          focusSecondsToday={focusSecondsToday}
          dailyGoalSeconds={dailyGoalSeconds}
          onSetGoal={() => { setDraftTarget(dailyFocusMinutes); setShowTargetPicker(true); }}
        />

        {/* Smart hero card */}
        <HeroCard
          activeCard={hero.activeCard}
          setCard={hero.setCard}
          tasks={tasks}
          goals={goals}
          sessionHistory={sessionHistory}
          peakHour={peakHour}
          currentStreak={streak}
          longestStreak={longestStreak}
          hasActivity={hasActivity}
          onTaskPress={setStatsTask}
          onGoalPress={(goalId) => setStatsGoalId(goalId)}
        />

        <DailyTargetModal
          visible={showTargetPicker}
          draft={draftTarget}
          onDraftChange={setDraftTarget}
          onCancel={() => setShowTargetPicker(false)}
          onSave={() => { setDailyFocusMinutes(draftTarget); setShowTargetPicker(false); }}
        />

        {/* Focus — below the summary, so the plan is read before acting (DD1) */}
        <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
          <FocusButton state={focusButton} onPress={onFocusButton} />
        </View>

        {/* Zone 2 — Task List */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <ZoneHeader title="Tasks" onSeeMore={openTaskList} />
          {nonArchived.length === 0 && recurringTemplates.length === 0 ? (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 36 }]}>
              <Ionicons name="checkbox-outline" size={32} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 10 }}>Nothing planned yet. What has to move today?</Text>
            </View>
          ) : (<>
            {/* The most pressing open tasks: priority first, then the closest
                due date. Everything else, recurring tasks not due today
                included, is one tap away in See more. */}
            {(topOpenTasks.length > 0 || hiddenOpenCount > 0) && (
              <View style={{ marginBottom: 12 }}>
                {topOpenTasks.map((task) => (
                  <TaskRow key={task.id} task={task} isActive={task.id === selectedTaskId} goals={goals} onTap={setStatsTask} onEdit={openEdit} onComplete={handleComplete} onLongPressTag={setOverrideTag} />
                ))}
                {hiddenOpenCount > 0 && <TouchableOpacity onPress={openTaskList} style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600' }}>+{hiddenOpenCount} more →</Text></TouchableOpacity>}
              </View>
            )}
            {/* Finished work lives in See more → Completed (D10). When nothing
                open is left, the end of the list says so (D11). */}
            {topOpenTasks.length === 0 && hiddenOpenCount === 0 && (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 32 }]}>
                <Ionicons name="checkmark-circle" size={32} color={Colors.accent} />
                <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600', marginTop: 10 }}>All done for now.</Text>
                <TouchableOpacity onPress={openCreate} accessibilityRole="button" style={{ marginTop: 14, minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>+ Add task</Text>
                </TouchableOpacity>
              </View>
            )}
          </>)}
        </View>

        {/* Zone 3 — Goals */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <ZoneHeader title="Goals" onSeeMore={() => setActiveView('goal-detail')} />
          {goals.filter((g) => !g.isCompleted && !g.isArchived).length === 0 ? (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
              <Text style={{ color: Colors.subtext, fontSize: 13 }}>No active goals — every task is standalone right now</Text>
              <TouchableOpacity onPress={() => { setFormGoal(null); setShowGoalForm(true); }}>
                <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600', marginTop: 10 }}>+ Add a goal</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.card]}>
              {goals.filter((g) => !g.isCompleted && !g.isArchived).slice(0, 3).map((goal, i, arr) => (
                <View key={goal.id}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setStatsGoalId(goal.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`View goal ${goal.title}`}
                  >
                    <GoalZoneRow goal={goal} />
                  </TouchableOpacity>
                  {i < arr.length - 1 && (
                    <View style={{ height: 0.5, backgroundColor: Colors.border, marginVertical: 14 }} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Zone 4 — Time. This week and the all-time climb, from the same
            routes as the full time screen behind it, so the two cannot
            disagree. */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <ZoneHeader title="Time" onSeeMore={() => openTime('overview')} />
          <View style={[styles.card]}>
            <TimeCard onOpen={openTime} />
          </View>
        </View>

      </ScrollView>

      {/* Modals */}
      {statsTask && <TaskStatsModal task={statsTask} sessionLengthMinutes={sessionLengthMinutes} focused={statsFocused} onShowSessions={showTaskSessions} onClose={() => setStatsTask(null)} onLoadTimer={loadTaskIntoTimer} onToggleComplete={(id) => { handleComplete(id); setStatsTask(null); }} onEdit={(id) => { setStatsTask(null); const t = tasks.find((x) => x.id === id); if (t) openEdit(t); }} />}
      <GoalStatsModal
        goalId={statsGoalId}
        lastSessionAt={lastSessionOnGoal(statsGoalId, tasks, sessionHistory)}
        onClose={() => setStatsGoalId(null)}
        onAction={handleGoalAction}
        onEdit={(goalId) => {
          setStatsGoalId(null);
          const g = goals.find((x) => x.id === goalId);
          if (g) { setFormGoal(g); setShowGoalForm(true); }
        }}
      />
      <TaskFormModal {...taskForm.props} />
      <GoalEditor goal={formGoal} visible={showGoalForm} onClose={closeGoalForm} />
      <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
      <NotificationsSheet visible={showInbox} onClose={() => setShowInbox(false)} />
      <SessionsSheet target={sessionsTarget} onClose={() => setSessionsTarget(null)} />
      <Toast message={toast} />
    </SafeAreaView>
  );
}
