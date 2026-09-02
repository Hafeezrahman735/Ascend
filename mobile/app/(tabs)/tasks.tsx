import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, TextInput,
  Alert, Platform, Animated,
  StyleSheet, KeyboardAvoidingView, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Swipeable, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Task, TaskGoal, TaskAnalytics, DayOfWeek, DAY_LABELS as DOW_LABELS, DAY_FULL_LABELS } from '../../types';
import { useTheme, useIsDark, type ThemeColors } from '../../hooks/useTheme';
import { getSessionPlan } from '../../lib/sessionPlan';
import { useAppForeground } from '../../hooks/useAppState';
import { useTasksList, useSelectedTaskId, useTaskActions, useSettings } from '../../store/hooks';
import { useFocusEffect, useRouter } from 'expo-router';
import { useHeroCard, CARD_ORDER, type HeroCardType } from '../../hooks/useHeroCard';
import {
  composeTaskList, nextOccurrenceLabel, type RecurringTemplate,
} from '../../lib/recurringDisplay';
import { useTaskStore } from '../../stores/taskStore';
import { useGoalStore } from '../../stores/goalStore';
import RecentActivity from '../../components/RecentActivity';
import FormSheet from '../../components/FormSheet';
import { BottomSheet, BentoCell, BentoRingCell, SCREEN_H, MONO } from '../../components/SheetPrimitives';
import AppPressable from '../../components/AppPressable';
import GoalStatsModal from '../../components/GoalStatsModal';
import TimeReportView from '../../components/timeReport/TimeReportView';
import TimeReportSummary from '../../components/timeReport/TimeReportSummary';
import type { ReportPeriod } from '../../hooks/useTimeReport';
import { lastSessionOnGoal, type GoalStatusAction } from '../../lib/goalStats';
import { useAuthStore } from '../../stores/authStore';
import { useTimerStore } from '../../stores/timerStore';
import { useGamificationStore } from '../../stores/gamificationStore';
import { getSessionHistory, mergeWithServerSessions, type SessionRecord } from '../../store/sync';
import { api } from '../../services/api';
import { priorityColor, priorityLabel } from '../../utils/priority';
import {
  daysUntilLocalDate, formatDeadlineLabel, getLocalDateString,
  parseLocalDate, pickerAcceptsValue, pickerMinimumDate,
} from '../../utils/date';
import {
  useTagStyle, useTagOverrideStore, TAG_COLOR_TOKENS, TAG_ICONS,
  getTagColor, getTagIcon, type TagColorKey,
} from '../../utils/tagStyle';
import { Space, Radius } from '../../constants/spacing';
import {
  getMonday, isToday, formatSeconds,
  formatDuration, getDueChip, isYesterdayLocal,
  startOfThisWeekMs, startOfWeekNMs, getLastWeekCompletionRate,
  diffCalendarDaysTasks, getPeakHour, formatPeakWindow, getCompletionRate,
  compactDuration,
  formatEstimateDelta, formatLastWorked, formatConsistency,
} from '../../lib/taskMetrics';

// ─── Design tokens ────────────────────────────────────────────────────────────
// ROSE / ROSE_DIM / AMBER now come from the theme — each component destructures
// them from `Colors` (AMBER maps to Colors.warning to preserve the exact dark hue).
const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;
const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DORMANT_VISIBLE = 3;
const ZONE_TASK_SLOTS = 3;
const ZONE_DORMANT_SLOTS = 1;


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


// ─── TaskStatsModal ───────────────────────────────────────────────────────────
// sessionLengthMinutes stays in the prop type (callers still pass it) but is not
// read here — the modal shows actual logged time, not the configured length.
function TaskStatsModal({ task, onClose, onLoadTimer, onToggleComplete, onEdit }: {
  task: Task | null; sessionLengthMinutes: number;
  onClose: () => void; onLoadTimer: (taskId: string) => void; onToggleComplete: (taskId: string) => void;
  onEdit: (taskId: string) => void;
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
        </View>
        {!ready && !analyticsError && <ActivityIndicator color={Colors.primary} style={{ marginBottom: Space.md }} />}
        {analyticsError && <Text style={{ color: Colors.text, fontSize: 12, marginBottom: Space.md }}>Analytics unavailable — try again later.</Text>}

        {/* notes — the description captured when the task was created */}
        {task.description?.trim() ? (
          <View style={{ backgroundColor: Colors.raised, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: Colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Ionicons name="document-text-outline" size={14} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Notes</Text>
            </View>
            <Text style={{ color: Colors.textBright, fontSize: 14, lineHeight: 20 }}>{task.description.trim()}</Text>
          </View>
        ) : null}

        {/* Habit history — recurring instances only. Both numbers are read
            straight off the instance (denormalized at spawn), no extra fetch.
            Two full-width cards became one row of cells: they are the same
            kind of fact as everything above, so they now look like it. The 🔥
            and ⏱️ emoji are gone — every other glyph in this sheet is an
            Ionicon, and a screen reader announced the old ones by name. */}
        {task.parentTaskId && (
          <View style={{ flexDirection: 'row', gap: Space.sm, marginBottom: Space.lg }}>
            <BentoCell
              style={{ flex: 1 }} Colors={Colors} feature
              icon="flame-outline" label="Current streak"
              value={`${task.lifetimeStreak}d`}
              sub="consecutive days"
            />
            <BentoCell
              style={{ flex: 1 }} Colors={Colors}
              icon="infinite-outline" label="Lifetime focus"
              value={formatSeconds(task.lifetimeTotalFocusTime)}
              sub={`${task.lifetimeTotalCompletions} completions`}
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
        <AppPressable
          onPress={() => onEdit(task.id)}
          accessibilityRole="button"
          scaleOnPress={false}
          style={{ alignItems: 'center', justifyContent: 'center', marginTop: Space.sm, minHeight: 44 }}
        >
          <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '600' }}>Edit task details</Text>
        </AppPressable>
      </View>
    </BottomSheet>
  );
}

// ─── GoalPicker ───────────────────────────────────────────────────────────────
function GoalPickerModal({ visible, goals, selectedGoalId, onSelect, onClose }: {
  visible: boolean; goals: TaskGoal[]; selectedGoalId: string | null;
  onSelect: (id: string | null) => void; onClose: () => void;
}) {
  const Colors = useTheme();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
        </View>
        <View style={{ paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: Colors.textBright, fontSize: 17, fontWeight: '700' }}>Link to Goal</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.subtext} /></TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => { onSelect(null); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.border }}>
          <Ionicons name={!selectedGoalId ? 'radio-button-on' : 'radio-button-off'} size={20} color={Colors.primary} style={{ marginRight: 12 }} />
          <Text style={{ color: Colors.textBright, fontSize: 14 }}>None</Text>
        </TouchableOpacity>
        <ScrollView style={{ maxHeight: 260 }}>
          {goals.map((g) => (
            <TouchableOpacity key={g.id} onPress={() => { onSelect(g.id); onClose(); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.border }}>
              <Ionicons name={selectedGoalId === g.id ? 'radio-button-on' : 'radio-button-off'} size={20} color={Colors.primary} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>{g.title}</Text>
                {g.tag && <Text style={{ color: Colors.subtext, fontSize: 11 }}>{g.tag}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── TaskFormModal ────────────────────────────────────────────────────────────
type FormSaveData = {
  title: string; description?: string | null; dueDate?: string | null;
  tags?: string[]; estimatedMinutes?: number | null;
  // Minutes from local midnight, or null for an untimed task.
  startMinutes?: number | null; endMinutes?: number | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent'; taskGoalId?: string | null;
  isRecurring?: boolean; recurringDays?: DayOfWeek[];
};
function TaskFormModal({ visible, task, existingTags, sessionLengthMinutes, goals, onSave, onClose, onDelete }: {
  visible: boolean; task: Task | null; existingTags: string[]; sessionLengthMinutes: number;
  goals: TaskGoal[]; onSave: (data: FormSaveData) => void; onClose: () => void; onDelete?: () => void;
}) {
  const Colors = useTheme();
  const isDark = useIsDark();
  const { ROSE, ROSE_DIM } = Colors;
  const monoLabel = { fontSize: 10, fontWeight: '700' as const, letterSpacing: 1, color: Colors.subtext, marginBottom: 9, fontFamily: MONO };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [estimatedMinutes, setEstimatedMinutes] = useState(0);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskGoalId, setTaskGoalId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  // The picker's floor, or null when it is closed. One piece of state rather
  // than a boolean beside a derived minimum: the floor must not move while the
  // picker is mounted (see pickerAcceptsValue), and a value that is captured
  // once on open cannot drift the way a recomputed one does.
  const [datePickerFloor, setDatePickerFloor] = useState<Date | null>(null);
  const [showGoalPicker, setShowGoalPicker] = useState(false);
  const [startMinutes, setStartMinutes] = useState<number | null>(null);
  const [endMinutes, setEndMinutes] = useState<number | null>(null);
  const [showTimePicker, setShowTimePicker] = useState<'start' | 'end' | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringDays, setRecurringDays] = useState<DayOfWeek[]>([]); // empty = every day
  const [editingTemplate, setEditingTemplate] = useState<Task | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle(task?.title ?? ''); setDescription(task?.description ?? '');
      // New tasks default to today so they land on the calendar straight away.
      // Editing is left alone — silently dating an existing undated task on open
      // would reschedule it just for being looked at.
      setDueDate(task?.dueDate ?? getLocalDateString()); setTags(task?.tags ?? []);
      setEstimatedMinutes(task?.estimatedMinutes ?? 0); setPriority(task?.priority ?? 'medium');
      setTaskGoalId(task?.taskGoalId ?? null); setTagInput(''); setTagEditorOpen(false); setTitleError(false);
      // Recurring lives on the template; an instance carries it via parentTaskId.
      setIsRecurring(task?.isRecurring ?? false);
      setRecurringDays(task?.recurringDays ?? []);
      setEditingTemplate(null);
      setStartMinutes(task?.startMinutes ?? null);
      setEndMinutes(task?.endMinutes ?? null);
      setShowTimePicker(null);
      // Closed alongside the time picker, and for a stronger reason than tidiness:
      // re-seeding moves dueDate underneath a picker that may still be mounted,
      // which is the exact prop transition the native component mishandles.
      setDatePickerFloor(null);
    }
  }, [visible, task]);

  // Editing a recurring instance — load the parent template's recurring settings.
  useEffect(() => {
    if (visible && task?.parentTaskId) {
      api.get<Task>(`/tasks/${task.parentTaskId}`)
        .then((res) => { if (res.success && res.data) setEditingTemplate(res.data); })
        .catch(() => {});
    }
  }, [visible, task?.parentTaskId]);

  useEffect(() => {
    if (editingTemplate) {
      setIsRecurring(editingTemplate.isRecurring);
      setRecurringDays(editingTemplate.recurringDays ?? []);
    }
  }, [editingTemplate]);

  const allTagChips = useMemo(() => Array.from(new Set([...existingTags, ...tags])), [existingTags, tags]);
  const toggleTag = (tag: string) => setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const addCustomTag = () => { const t = tagInput.trim(); if (t && !tags.includes(t)) setTags((prev) => [...prev, t]); setTagInput(''); };

  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    // The backend rejects these too; catching it here keeps the sheet open
    // with the offending field in view instead of failing after it closes.
    if (timeError) return;
    if (task) {
      const update: FormSaveData = { title: title.trim() };
      const newDesc = description.trim() || null;
      if (newDesc !== (task.description ?? null)) update.description = newDesc;
      const newDue = dueDate || null;
      if (newDue !== (task.dueDate ?? null)) update.dueDate = newDue;
      if (JSON.stringify([...tags].sort()) !== JSON.stringify([...(task.tags ?? [])].sort())) update.tags = tags;
      const newEst = estimatedMinutes > 0 ? estimatedMinutes : null;
      if (newEst !== (task.estimatedMinutes ?? null)) update.estimatedMinutes = newEst;
      if (startMinutes !== (task.startMinutes ?? null)) update.startMinutes = startMinutes;
      if (endMinutes !== (task.endMinutes ?? null)) update.endMinutes = endMinutes;
      if (priority !== task.priority) update.priority = priority;
      if (taskGoalId !== (task.taskGoalId ?? null)) update.taskGoalId = taskGoalId;
      // Always carry recurring settings — the screen routes them to the template.
      update.isRecurring = isRecurring;
      update.recurringDays = recurringDays;
      onSave(update);
    } else {
      onSave({ title: title.trim(), description: description.trim() || undefined, dueDate: dueDate || undefined, tags, estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined, startMinutes, endMinutes, priority, taskGoalId, isRecurring, recurringDays });
    }
  };

  const selectedGoal = goals.find((g) => g.id === taskGoalId);
  // Memoised because both feed a native picker: a fresh Date on every render
  // is a changed prop every render, and updating a UIDatePicker's bounds is
  // exactly where iOS validates them.
  const datePickerValue = useMemo(
    () => (dueDate ? parseLocalDate(dueDate) : new Date()),
    [dueDate],
  );
  const openDatePicker = () => setDatePickerFloor(pickerMinimumDate(datePickerValue));
  // Unmount rather than hand the picker a date its floor forbids. Every date the
  // user can pick is inside the bounds already, so this only fires when
  // something outside the picker moved dueDate — and that is the case that
  // crashes rather than misrenders.
  const datePickerOpen = datePickerFloor !== null
    && pickerAcceptsValue(datePickerFloor, datePickerValue);
  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setDatePickerFloor(null);
    if (date) setDueDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  };

  // Both ends or neither, and the block must move forwards — the same rules the
  // server enforces, mirrored here so the sheet can explain itself.
  const timeError = startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes
    ? 'End time must be after the start time'
    : null;

  /** A fixed calendar date carrying the time, which is all the picker reads. */
  const minutesToDate = (minutes: number | null) => {
    const m = minutes ?? 9 * 60; // an unset picker opens at 9am, not midnight
    return new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
  };

  const formatClock = (minutes: number) =>
    minutesToDate(minutes).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const clearSchedule = () => { setStartMinutes(null); setEndMinutes(null); setShowTimePicker(null); };

  const handleTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    const editing = showTimePicker;
    if (Platform.OS === 'android') setShowTimePicker(null);
    if (!date || !editing) return;
    const picked = date.getHours() * 60 + date.getMinutes();
    if (editing === 'end') { setEndMinutes(picked); return; }
    setStartMinutes(picked);
    // First time only: derive an end so a single tap already yields a valid
    // block. Uses the estimate when there is one, an hour when there is not.
    setEndMinutes((prev) => prev === null
      ? Math.min(1439, picked + (estimatedMinutes > 0 ? estimatedMinutes : 60))
      : prev);
  };

  // Same function the Focus screen loads into the timer, so the split promised
  // here is the split you actually get. It used to be a bare count derived from
  // a rounded division, which could not say how LONG each session would be —
  // and the length is the part that changes.
  const estPlan = useMemo(
    () => getSessionPlan(estimatedMinutes, sessionLengthMinutes),
    [estimatedMinutes, sessionLengthMinutes],
  );

  /**
   * "2 x 20 min", or "25 + 20 + 20" when the split is uneven.
   *
   * Showing the shape rather than a count is what makes the grace-zone edge
   * explain itself: tapping + from 35 to 40 changes this line from "35 min" to
   * "2 x 20 min" right beside the stepper, so the user watches the change happen
   * instead of discovering it later on the timer.
   */
  const estPlanLabel = useMemo(() => {
    if (!estPlan || estPlan.length === 0) return null;
    if (estPlan.length === 1) return `${estPlan[0]} min`;
    const allSame = estPlan.every((b) => b === estPlan[0]);
    return allSame ? `${estPlan.length} × ${estPlan[0]} min` : `${estPlan.join(' + ')} min`;
  }, [estPlan]);

  return (
    <FormSheet
      visible={visible}
      title={task ? 'Edit task' : 'New task'}
      onClose={onClose}
      overlay={
        <GoalPickerModal
          visible={showGoalPicker}
          goals={goals.filter((g) => !g.isCompleted)}
          selectedGoalId={taskGoalId}
          onSelect={setTaskGoalId}
          onClose={() => setShowGoalPicker(false)}
        />
      }
    >
      {/* title */}
      <TextInput
        style={[{ backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 15, paddingVertical: 15, color: Colors.textBright, fontSize: 15, fontWeight: '600', marginBottom: titleError ? 6 : 18 }, titleError && { borderColor: ROSE, borderWidth: 1.5 }]}
        placeholder="What are you working on?" placeholderTextColor={Colors.subtext}
        value={title} onChangeText={(t) => { setTitle(t); if (titleError) setTitleError(false); }} autoFocus maxLength={100} returnKeyType="next"
      />
      {titleError && <Text style={{ color: ROSE, fontSize: 11, marginBottom: 18 }}>Task name can't be empty</Text>}

      {/* priority */}
      <Text style={monoLabel}>PRIORITY</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
        {PRIORITIES.map(({ value, label }) => { const sel = priority === value; const color = priorityColor(value); return (
          <TouchableOpacity key={value} onPress={() => setPriority(value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: sel ? color + '22' : Colors.raised, borderWidth: 1, borderColor: sel ? color : 'transparent' }}>
            <Text style={{ color, fontSize: 12, fontWeight: sel ? '700' : '600' }}>{label}</Text>
          </TouchableOpacity>
        ); })}
      </View>

      {/* recurring toggle */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, marginBottom: isRecurring ? 4 : 18 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>Recurring</Text>
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>Repeats automatically each day</Text>
        </View>
        <Switch
          value={isRecurring}
          onValueChange={(val) => { setIsRecurring(val); setDatePickerFloor(null); if (val) setDueDate(''); else setRecurringDays([]); }}
          trackColor={{ false: Colors.inactive, true: Colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      {/* day selector — only when recurring is on */}
      {isRecurring && (
        <View style={{ marginBottom: 18 }}>
          <Text style={[monoLabel, { marginTop: 8 }]}>REPEAT ON</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {ALL_DAYS.map((day) => {
              const isSelected = recurringDays.length === 0 || recurringDays.includes(day);
              return (
                <TouchableOpacity
                  key={day}
                  onPress={() => {
                    if (recurringDays.length === 0) {
                      // Currently "every day" — deselect this one.
                      setRecurringDays(ALL_DAYS.filter((d) => d !== day));
                    } else if (recurringDays.includes(day)) {
                      const next = recurringDays.filter((d) => d !== day);
                      setRecurringDays(next.length === 0 ? [] : next);
                    } else {
                      const next = [...recurringDays, day];
                      setRecurringDays(next.length === 7 ? [] : next);
                    }
                  }}
                  style={{ flex: 1, aspectRatio: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: isSelected ? Colors.primary : Colors.raised, borderWidth: 1, borderColor: isSelected ? Colors.primary : Colors.border }}
                >
                  <Text style={{ color: isSelected ? '#fff' : Colors.subtext, fontSize: 13, fontWeight: '700' }}>{DOW_LABELS[day]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 8 }}>
            {recurringDays.length === 0 ? 'Every day' : recurringDays.map((d) => DAY_FULL_LABELS[d]).join(', ')}
          </Text>
        </View>
      )}

      {/* estimated focus time */}
      <Text style={monoLabel}>ESTIMATED FOCUS TIME</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <TouchableOpacity disabled={estimatedMinutes <= 0} onPress={() => setEstimatedMinutes(Math.max(0, estimatedMinutes - 5))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', opacity: estimatedMinutes <= 0 ? 0.4 : 1 }}>
          <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>−</Text>
        </TouchableOpacity>
        <Text style={{ color: Colors.textBright, fontSize: 17, fontWeight: '600', minWidth: 84, textAlign: 'center', fontFamily: MONO }}>{estimatedMinutes > 0 ? `${estimatedMinutes} min` : 'not set'}</Text>
        <TouchableOpacity disabled={estimatedMinutes >= 480} onPress={() => setEstimatedMinutes(Math.min(480, estimatedMinutes + 5))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', opacity: estimatedMinutes >= 480 ? 0.4 : 1 }}>
          <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>+</Text>
        </TouchableOpacity>
        {estPlanLabel && (
          <Text
            style={{ color: Colors.subtext, fontSize: 12, marginLeft: 2, fontFamily: MONO }}
            accessibilityLabel={`Splits into ${estPlan && estPlan.length > 1 ? `${estPlan.length} sessions of ${estPlan.join(', ')} minutes` : `one session of ${estPlan?.[0]} minutes`}`}
          >
            ≈ {estPlanLabel}
          </Text>
        )}
      </View>

      {/* due date + category */}
      <View style={{ flexDirection: 'row', gap: 20, marginBottom: 18 }}>
        <View style={{ flex: 1 }}>
          <Text style={monoLabel}>DUE DATE</Text>
          {dueDate ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity onPress={openDatePicker} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primaryDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
                <Ionicons name="calendar-outline" size={14} color={Colors.primarySoft} />
                <Text style={{ color: Colors.primarySoft, fontSize: 12.5, fontWeight: '600' }}>{new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
              </TouchableOpacity>
              {/* A time cannot outlive its day — the server rejects that pair. */}
              <TouchableOpacity onPress={() => { setDueDate(''); clearSchedule(); setDatePickerFloor(null); }}><Ionicons name="close-circle" size={16} color={Colors.subtext} /></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={openDatePicker} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: Colors.raised, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
              <Ionicons name="calendar-outline" size={14} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 12.5, fontWeight: '600' }}>Set date</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={monoLabel}>SUBJECT</Text>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {tags.map((t) => (
              <TouchableOpacity key={t} onPress={() => toggleTag(t)} style={{ backgroundColor: Colors.primaryDim, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.primarySoft }}>{t}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setTagEditorOpen((v) => !v)} style={{ backgroundColor: Colors.raised, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.subtext }}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* scheduled time — drives the Day timeline in the calendar */}
      <View style={{ marginBottom: 18 }}>
        <Text style={monoLabel}>TIME</Text>
        {!dueDate ? (
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>
            Pick a due date first — a time needs a day to sit on.
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={() => setShowTimePicker('start')}
                accessibilityRole="button"
                accessibilityLabel={startMinutes === null ? 'Set start time' : `Start time, ${formatClock(startMinutes)}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 9,
                  backgroundColor: startMinutes === null ? Colors.raised : Colors.primaryDim,
                }}
              >
                <Ionicons name="time-outline" size={14} color={startMinutes === null ? Colors.subtext : Colors.primarySoft} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: startMinutes === null ? Colors.subtext : Colors.primarySoft }}>
                  {startMinutes === null ? 'Start' : formatClock(startMinutes)}
                </Text>
              </TouchableOpacity>

              <Ionicons name="arrow-forward" size={13} color={Colors.subtext} />

              <TouchableOpacity
                disabled={startMinutes === null}
                onPress={() => setShowTimePicker('end')}
                accessibilityRole="button"
                accessibilityLabel={endMinutes === null ? 'Set end time' : `End time, ${formatClock(endMinutes)}`}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 9,
                  backgroundColor: endMinutes === null ? Colors.raised : Colors.primaryDim,
                  opacity: startMinutes === null ? 0.4 : 1,
                }}
              >
                <Ionicons name="time-outline" size={14} color={endMinutes === null ? Colors.subtext : Colors.primarySoft} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: endMinutes === null ? Colors.subtext : Colors.primarySoft }}>
                  {endMinutes === null ? 'End' : formatClock(endMinutes)}
                </Text>
              </TouchableOpacity>

              {(startMinutes !== null || endMinutes !== null) && (
                <TouchableOpacity onPress={clearSchedule} accessibilityRole="button" accessibilityLabel="Clear time">
                  <Ionicons name="close-circle" size={16} color={Colors.subtext} />
                </TouchableOpacity>
              )}
            </View>

            {timeError && (
              <Text style={{ color: ROSE, fontSize: 11.5, marginTop: 7 }}>{timeError}</Text>
            )}

            {showTimePicker && (
              <View style={{ backgroundColor: Colors.raised, borderRadius: 13, marginTop: 10, alignItems: 'center', overflow: 'hidden' }}>
                <DateTimePicker
                  value={minutesToDate(showTimePicker === 'start' ? startMinutes : endMinutes)}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTimeChange}
                  themeVariant={isDark ? 'dark' : 'light'}
                  accentColor={Colors.primary}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    onPress={() => setShowTimePicker(null)}
                    accessibilityRole="button"
                    style={{ paddingVertical: 10, alignSelf: 'stretch', alignItems: 'center' }}
                  >
                    <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '700' }}>Done</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </View>
      {/* category editor (revealed by "+ Add") */}
      {tagEditorOpen && (
        <View style={{ marginBottom: 18 }}>
          {allTagChips.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {allTagChips.map((tag) => { const sel = tags.includes(tag); return (
                <TouchableOpacity key={tag} onPress={() => toggleTag(tag)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: sel ? Colors.primary : Colors.raised, borderWidth: 1, borderColor: sel ? Colors.primary : Colors.border }}>
                  <Text style={{ color: sel ? '#fff' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>{tag}</Text>
                </TouchableOpacity>
              ); })}
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput style={{ flex: 1, backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textBright, fontSize: 14 }} placeholder="New category…" placeholderTextColor={Colors.subtext} value={tagInput} onChangeText={(t) => { if (t.endsWith(',') || t.endsWith('\n')) addCustomTag(); else setTagInput(t); }} onSubmitEditing={addCustomTag} blurOnSubmit={false} returnKeyType="done" />
            <TouchableOpacity onPress={addCustomTag} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={18} color={Colors.primarySoft} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {datePickerOpen && (
        <View style={{ backgroundColor: Colors.raised, borderRadius: 13, marginBottom: 18, alignItems: 'center', overflow: 'hidden' }}>
          <DateTimePicker
            value={datePickerValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleDateChange}
            minimumDate={datePickerFloor!}
            themeVariant={isDark ? 'dark' : 'light'}
            accentColor={Colors.primary}
          />
        </View>
      )}

      {/* link to goal — no slot in the design; kept here when goals exist */}
      {goals.length > 0 && (
        <View style={{ marginBottom: 18 }}>
          <Text style={monoLabel}>GOAL</Text>
          <TouchableOpacity onPress={() => setShowGoalPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 13 }}>
            <Ionicons name="flag-outline" size={15} color={Colors.subtext} style={{ marginRight: 8 }} />
            <Text style={{ flex: 1, color: selectedGoal ? Colors.primarySoft : Colors.subtext, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{selectedGoal ? selectedGoal.title : 'Link to a goal (optional)'}</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.subtext} />
          </TouchableOpacity>
        </View>
      )}

      {/* notes */}
      <Text style={monoLabel}>NOTES</Text>
      <TextInput style={{ backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 13, minHeight: 56, color: Colors.textBright, fontSize: 13, textAlignVertical: 'top', marginBottom: 20 }} placeholder="Any notes for this task…" placeholderTextColor={Colors.subtext} value={description} onChangeText={setDescription} multiline />

      {/* create / save */}
      <TouchableOpacity onPress={handleSave} disabled={!!timeError} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, opacity: timeError ? 0.5 : 1 }}>
        <Ionicons name={task ? 'checkmark' : 'add'} size={16} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{task ? 'Save changes' : 'Create task'}</Text>
      </TouchableOpacity>

      {task && onDelete && (
        <TouchableOpacity onPress={onDelete} style={{ marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: ROSE_DIM, borderWidth: 0.5, borderColor: ROSE + '40' }}>
          <Text style={{ color: ROSE, fontWeight: '700', fontSize: 14 }}>Delete Task</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}

// ─── GoalFormModal ────────────────────────────────────────────────────────────
function GoalFormModal({ visible, goal, existingTags, sessionLengthMinutes, onSave, onClose, onDelete }: {
  visible: boolean; goal: TaskGoal | null; existingTags: string[]; sessionLengthMinutes: number;
  onSave: (data: { title: string; tag?: string | null; targetSessions?: number | null; deadline?: string | null }) => void;
  onClose: () => void;
  /** Only passed when editing — creates have nothing to delete. */
  onDelete?: () => void;
}) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [targetSessions, setTargetSessions] = useState(0);
  const [deadline, setDeadline] = useState('');
  // See the task form above: the floor is captured on open and held, because the
  // native picker writes a new date before it relaxes an old floor.
  const [datePickerFloor, setDatePickerFloor] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(goal?.title ?? ''); setTag(goal?.tag ?? null);
      setTargetSessions(goal?.targetSessions ?? 0); setDeadline(goal?.deadline?.substring(0, 10) ?? '');
      setTitleError(false);
      // This form previously reset nothing about the picker, so a calendar left
      // open on one goal was still mounted when the next goal's deadline was
      // seeded into it — the transition that crashes.
      setDatePickerFloor(null);
    }
  }, [visible, goal]);

  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    // Send the calendar day as-is. This used to convert to an instant via
    // `new Date(deadline + 'T00:00:00').toISOString()`, which baked in the
    // creating device's timezone — the same goal then read as a different day
    // elsewhere. The server column is a plain date now.
    onSave({
      title: title.trim(),
      tag: tag || null,
      targetSessions: targetSessions > 0 ? targetSessions : null,
      deadline: deadline || null,
    });
  };
  const datePickerValue = useMemo(
    () => (deadline ? parseLocalDate(deadline) : new Date()),
    [deadline],
  );
  const openDatePicker = () => setDatePickerFloor(pickerMinimumDate(datePickerValue));
  const datePickerOpen = datePickerFloor !== null
    && pickerAcceptsValue(datePickerFloor, datePickerValue);
  const handleDateChange = (_e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setDatePickerFloor(null);
    if (date) setDeadline(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  };
  const focusHours = targetSessions > 0 ? Math.round(targetSessions * sessionLengthMinutes / 60 * 10) / 10 : null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'center' }} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={1} style={{ marginHorizontal: 20 }}>
          <View style={{ backgroundColor: Colors.surface, borderRadius: 20, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border }}>
              <TouchableOpacity onPress={onClose}><Text style={{ color: Colors.subtext, fontSize: 15, fontWeight: '500' }}>Cancel</Text></TouchableOpacity>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>{goal ? 'Edit Goal' : 'New Goal'}</Text>
              <TouchableOpacity onPress={handleSave}><Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '700' }}>Save</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              <TextInput style={[styles.input, { fontSize: 16, fontWeight: '600', color: Colors.textBright }, titleError && { borderColor: ROSE }]} placeholder="e.g. Complete Calculus unit" placeholderTextColor={Colors.subtext} value={title} onChangeText={(t) => { setTitle(t); if (titleError) setTitleError(false); }} autoFocus maxLength={80} />
              {titleError && <Text style={{ color: ROSE, fontSize: 11, marginTop: -8, marginBottom: 12 }}>Goal title can't be empty</Text>}
              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {['None', ...existingTags].map((t) => { const sel = t === 'None' ? !tag : tag === t; return (
                  <TouchableOpacity key={t} onPress={() => setTag(t === 'None' ? null : t)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8, backgroundColor: sel ? Colors.primary : Colors.raised, borderWidth: 1, borderColor: sel ? Colors.primary : Colors.border }}>
                    <Text style={{ color: sel ? '#fff' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>{t}</Text>
                  </TouchableOpacity>
                ); })}
              </ScrollView>
              <Text style={styles.fieldLabel}>Target sessions</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <TouchableOpacity style={[styles.stepper, { opacity: targetSessions <= 0 ? 0.3 : 1 }]} disabled={targetSessions <= 0} onPress={() => setTargetSessions(Math.max(0, targetSessions - 1))}>
                  <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>−</Text>
                </TouchableOpacity>
                <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', width: 88, textAlign: 'center' }}>{targetSessions > 0 ? `${targetSessions} sessions` : 'not set'}</Text>
                <TouchableOpacity style={[styles.stepper, { opacity: targetSessions >= 200 ? 0.3 : 1 }]} disabled={targetSessions >= 200} onPress={() => setTargetSessions(Math.min(200, targetSessions + 1))}>
                  <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>+</Text>
                </TouchableOpacity>
                {focusHours && <Text style={{ color: Colors.subtext, fontSize: 11, marginLeft: 12 }}>≈ {focusHours}h</Text>}
              </View>
              {/* Sessions are no longer uniformly workDuration — a task with an
                  estimate sizes its own blocks — so this figure is an estimate
                  from the default, not an identity. Saying so keeps it honest. */}
              <Text style={[styles.fieldLabel, { marginBottom: 16 }]}>
                Estimated from your {sessionLengthMinutes}m default; sessions sized to a task estimate differ
              </Text>
              <Text style={styles.fieldLabel}>Deadline</Text>
              {deadline ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.primaryDim, marginRight: 8 }}>
                    <Ionicons name="calendar-outline" size={14} color={Colors.primarySoft} style={{ marginRight: 6 }} />
                    <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600' }}>{new Date(deadline + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setDeadline('')}><Ionicons name="close-circle" size={18} color={Colors.subtext} /></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[styles.input, { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }]} onPress={openDatePicker}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.subtext} style={{ marginRight: 8 }} />
                  <Text style={{ color: Colors.subtext, fontSize: 14 }}>Set deadline</Text>
                </TouchableOpacity>
              )}
              {datePickerOpen && <DateTimePicker value={datePickerValue} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={handleDateChange} minimumDate={datePickerFloor!} />}

              {/* Editing only. Goals previously had no delete affordance anywhere
                  in the app — they could be created but never removed. */}
              {goal && onDelete && (
                <TouchableOpacity
                  onPress={onDelete}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: ROSE }}
                  accessibilityRole="button"
                  accessibilityLabel="Delete goal"
                >
                  <Ionicons name="trash-outline" size={16} color={ROSE} style={{ marginRight: 7 }} />
                  <Text style={{ color: ROSE, fontSize: 14, fontWeight: '600' }}>Delete goal</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────
/**
 * The visual body of a task row, with no gesture wrapper.
 *
 * Split out so a dormant recurring row can reuse the exact chrome while sitting
 * OUTSIDE Swipeable. Hiding the checkbox alone would not have been enough:
 * swipe-left completes a task, so a dormant row rendered through TaskRow could
 * still be completed by a gesture that leaves no visual trace.
 */
function TaskRowBody({ task, isActive, goals, onTap, onLongPressTag, dormant = false, subtitle }: {
  task: Task; isActive: boolean; goals: TaskGoal[];
  onTap: () => void; onLongPressTag?: (t: string) => void;
  dormant?: boolean; subtitle?: string;
}) {
  const Colors = useTheme();
  const isCompleted = task.isCompleted;
  const barColor = dormant ? Colors.border : isActive ? Colors.primary : isCompleted ? Colors.accent : Colors.border;
  // A template has no due date and no sessions, so these stay inert rather than
  // rendering something untrue.
  const chip = dormant ? null : getDueChip(task, Colors);
  const prioColor = priorityColor(task.priority);
  const categoryTag = task.tags.length > 0 ? task.tags[0] : null;
  const tagStyle = useTagStyle(categoryTag ?? '');
  const progressFrac = !dormant && task.estimatedMinutes ? Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60)) : null;
  const linkedGoal = task.taskGoalId ? goals.find((g) => g.id === task.taskGoalId) : null;
  // The recurring badge used to gate on parentTaskId, which templates do not
  // have, so a dormant row lost every recurring signal and read as a broken task.
  const isRecurringRow = !!task.parentTaskId || task.isRecurring;

  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onTap} style={{ flexDirection: 'row', backgroundColor: isActive ? Colors.raised : Colors.surface, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 0.5, borderStyle: dormant ? 'dashed' : 'solid', borderColor: isActive ? Colors.primary + '50' : Colors.border, opacity: isCompleted ? 0.5 : 1 }}>
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
          <Text numberOfLines={1} style={{ flex: 1, color: isCompleted ? Colors.subtext : Colors.textBright, fontSize: 14, fontWeight: '600', textDecorationLine: isCompleted ? 'line-through' : 'none' }}>{task.title}</Text>
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
            <Ionicons name="flag-outline" size={10} color={Colors.primarySoft} style={{ marginRight: 4 }} />
            <Text style={{ color: Colors.primarySoft, fontSize: 11 }} numberOfLines={1}>Goal: {linkedGoal.title}</Text>
          </View>
        )}
        {(task.sessionsOnTask > 0 || chip) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, gap: 8 }}>
            {task.sessionsOnTask > 0 && <Text style={{ color: isActive ? Colors.primarySoft : Colors.subtext, fontSize: 11, fontWeight: '500' }}>{task.sessionsOnTask} session{task.sessionsOnTask !== 1 ? 's' : ''}</Text>}
            {chip && <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: chip.bg }}><Text style={{ fontSize: 10, fontWeight: '700', color: chip.fg }}>{chip.label}</Text></View>}
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
}

function TaskRow({ task, isActive, goals, onTap, onEdit, onComplete, onLongPressTag }: {
  task: Task; isActive: boolean; goals: TaskGoal[];
  onTap: () => void; onEdit: () => void; onComplete: () => void; onLongPressTag?: (t: string) => void;
}) {
  const Colors = useTheme();
  const { ROSE, ROSE_DIM } = Colors;
  const isCompleted = task.isCompleted;
  const swipeRef = useRef<Swipeable>(null);
  const handleSwipeOpen = useCallback((direction: 'left' | 'right') => { swipeRef.current?.close(); if (direction === 'left') onComplete(); else onEdit(); }, [onComplete, onEdit]);

  const renderLeftActions = () => (
    <View style={{ width: 72, marginRight: 6, marginBottom: 8, borderRadius: 14, backgroundColor: isCompleted ? ROSE_DIM : Colors.tealDim, justifyContent: 'center', alignItems: 'center' }}>
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
}

/**
 * A recurring task on a day it is not scheduled.
 *
 * No Swipeable, so it cannot be completed by gesture. Tapping opens the template
 * editor rather than the stats modal, which exposes both completion and
 * selectTask - and a template id in selectedTaskId leaves the Active filter
 * empty and the focus tab holding a dangling id.
 */
function DormantRecurringRow({ template, goals, subtitle, onEdit, onLongPressTag }: {
  template: Task; goals: TaskGoal[]; subtitle: string;
  onEdit: () => void; onLongPressTag?: (t: string) => void;
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
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message }: { message: string | null }) {
  const Colors = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (message) {
      Animated.sequence([Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }), Animated.delay(1500), Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true })]).start();
    }
  }, [message]);
  if (!message) return null;
  return (
    <Animated.View style={{ position: 'absolute', bottom: 96, alignSelf: 'center', backgroundColor: Colors.tealDim, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, borderWidth: 0.5, borderColor: Colors.accent, opacity }}>
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
function BarColumn({ dayLabel, seconds, maxSeconds, isToday, isFuture }: { dayLabel: string; seconds: number; maxSeconds: number; isToday: boolean; isFuture: boolean }) {
  const Colors = useTheme();
  const BAR_MAX_H = 56;
  const barHeight = isFuture ? 3 : Math.max(seconds > 0 ? (seconds / maxSeconds) * BAR_MAX_H : 3, 3);
  const barColor = isToday ? Colors.accent : Colors.primary;
  const countLabel = isFuture ? '—' : compactDuration(seconds);
  const labelColor = isToday ? Colors.accent : Colors.subtext;
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 2 }}>
      <View style={{ height: BAR_MAX_H, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
        <View style={{ width: '70%', height: barHeight, borderRadius: 3, backgroundColor: isFuture ? Colors.inactive : barColor, opacity: isFuture ? 0.15 : seconds === 0 && !isToday ? 0.25 : 1 }} />
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

// ─── Styles ───────────────────────────────────────────────────────────────────
function getStyles(c: ThemeColors) {
  return StyleSheet.create({
    input: { backgroundColor: c.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.textBright, marginBottom: 16, fontSize: 14, borderWidth: 1, borderColor: c.border },
    fieldLabel: { color: c.subtext, fontSize: 11, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
    stepper: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 0.5, borderColor: c.border, padding: 16 },
  });
}


// ─── DailyTargetModal ─────────────────────────────────────────────────────────
// Its own component because two screens open it: the Tasks tab pill strip and
// the Goal Progress drill-down. It used to be written inline in the Tasks tab
// return only, so tapping "Today's target" inside Goal Progress flipped the flag
// with nothing mounted to render it. The sheet then appeared on the way back to
// the Tasks tab, which reads as a dead tap followed by a stray modal.
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
        <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', marginBottom: 4 }}>Daily Session Goal</Text>
        <Text style={{ color: Colors.subtext, fontSize: 13, marginBottom: 24 }}>How many focus sessions do you want to complete each day?</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}>
          <TouchableOpacity
            onPress={() => onDraftChange(Math.max(1, draft - 1))}
            disabled={draft <= 1}
            accessibilityRole="button"
            accessibilityLabel="Decrease daily session goal"
            style={[styles.stepper, { width: 48, height: 48, borderRadius: 14, opacity: draft <= 1 ? 0.3 : 1 }]}
          >
            <Text style={{ color: Colors.primarySoft, fontSize: 24, fontWeight: '600' }}>−</Text>
          </TouchableOpacity>
          <View style={{ width: 100, alignItems: 'center' }}>
            <Text style={{ color: Colors.textBright, fontSize: 48, fontWeight: '800' }}>{draft}</Text>
            <Text style={{ color: Colors.subtext, fontSize: 12 }}>sessions</Text>
          </View>
          <TouchableOpacity
            onPress={() => onDraftChange(Math.min(50, draft + 1))}
            disabled={draft >= 50}
            accessibilityRole="button"
            accessibilityLabel="Increase daily session goal"
            style={[styles.stepper, { width: 48, height: 48, borderRadius: 14, opacity: draft >= 50 ? 0.3 : 1 }]}
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
function PillStrip({ completedToday, yesterdayCompleted, totalActive, weeklyRate, lastWeekRate, focusSecondsToday, dailyFocusTargetSeconds, onSetGoal }: {
  completedToday: number; yesterdayCompleted: number; totalActive: number;
  weeklyRate: number | null; lastWeekRate: number | null;
  focusSecondsToday: number; dailyFocusTargetSeconds: number;
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

  const noTarget = dailyFocusTargetSeconds <= 0;
  const remaining = dailyFocusTargetSeconds - focusSecondsToday;
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
          but noTarget is `dailyFocusTargetSeconds <= 0` and the target defaults to 8
          sessions (clamped to a minimum of 1), so it could never be true — the
          picker was unreachable and the target could not be changed at all. */}
      <TouchableOpacity
        onPress={onSetGoal}
        activeOpacity={0.7}
        style={pillStyle}
        accessibilityRole="button"
        accessibilityLabel="Change daily session goal"
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
  return (
    <View style={[styles.card, { marginBottom: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{goal.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {goal.tag && (
              <TouchableOpacity onLongPress={() => onLongPressTag?.(goal.tag!)} delayLongPress={400}
                style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: ts.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: ts.text }}>{ts.icon} {goal.tag}</Text>
              </TouchableOpacity>
            )}
            {deadlineLabel && <Text style={{ color: (deadlineDays ?? 0) < 0 ? ROSE : Colors.subtext, fontSize: 11 }}>{deadlineLabel}</Text>}
          </View>
        </View>
        <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '800' }}>{pct}%</Text>
      </View>
      <View style={{ height: 6, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 3, backgroundColor: goal.isCompleted ? Colors.accent : Colors.primary }} />
      </View>
      <Text style={{ color: Colors.subtext, fontSize: 12 }}>{goalSubMetrics(goal)}</Text>
    </View>
  );
}

// ─── Hero card shared header ──────────────────────────────────────────────────
function HeroLabel({ text, color }: { text: string; color?: string }) {
  const Colors = useTheme();
  return <Text style={{ color: color ?? Colors.subtext, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>{text}</Text>;
}

// ─── Card 1: Urgency ──────────────────────────────────────────────────────────
function UrgencyCard({ tasks, onSelectAndFocus }: { tasks: Task[]; onSelectAndFocus: (id: string) => void }) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const urgent = tasks
    .filter((t) => !t.isCompleted && !t.isArchived && !!t.dueDate)
    .map((t) => ({ ...t, daysLeft: diffCalendarDaysTasks(new Date(t.dueDate!), new Date()) }))
    .filter((t) => t.daysLeft >= 0 && t.daysLeft <= 6)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 3);

  if (urgent.length === 0) return null;

  const urgencyColor = (d: number) => d <= 2 ? ROSE : d <= 5 ? AMBER : Colors.subtext;

  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: ROSE }]}>
      <HeroLabel text="⚠ Due soon" color={ROSE} />
      {urgent.map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: urgencyColor(t.daysLeft), marginRight: 10 }} />
          <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>{t.title}</Text>
          <Text style={{ color: urgencyColor(t.daysLeft), fontSize: 12, fontWeight: '700', marginLeft: 8 }}>
            {t.daysLeft === 0 ? 'Today' : t.daysLeft === 1 ? 'Tomorrow' : `${t.daysLeft}d`}
          </Text>
        </View>
      ))}
      <TouchableOpacity
        onPress={() => onSelectAndFocus(urgent[0].id)}
        style={{ marginTop: 4, backgroundColor: ROSE + '20', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: ROSE + '40' }}
      >
        <Text style={{ color: ROSE, fontWeight: '700', fontSize: 13 }}>Focus on this now →</Text>
      </TouchableOpacity>
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
function TimeNudgeCard({ peakHour, sessionHistory, onFocus }: { peakHour: number | null; sessionHistory: SessionRecord[]; onFocus: () => void }) {
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
      <TouchableOpacity onPress={onFocus} style={{ backgroundColor: Colors.accent + '20', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.accent + '40' }}>
        <Text style={{ color: Colors.accent, fontWeight: '700', fontSize: 13 }}>Start a session now →</Text>
      </TouchableOpacity>
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
function SelfComparisonCard({ sessionHistory, onFocus }: { sessionHistory: SessionRecord[]; onFocus: () => void }) {
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
        <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', marginBottom: 8 }}>
          Complete your first focus session to start tracking your progress.
        </Text>
        <TouchableOpacity onPress={onFocus} style={{ backgroundColor: Colors.primary + '20', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.primary + '40' }}>
          <Text style={{ color: Colors.primarySoft, fontWeight: '700', fontSize: 13 }}>Start focusing →</Text>
        </TouchableOpacity>
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
function HeroCard({ activeCard, setCard, tasks, goals, sessionHistory, peakHour, currentStreak, longestStreak, hasActivity, onSelectAndFocus, onGoalPress, onFocus }: {
  activeCard: HeroCardType; setCard: (c: HeroCardType) => void;
  tasks: Task[]; goals: TaskGoal[]; sessionHistory: SessionRecord[]; peakHour: number | null;
  currentStreak: number; longestStreak: number; hasActivity: boolean;
  onSelectAndFocus: (id: string) => void; onGoalPress: (goalId: string) => void; onFocus: () => void;
}) {
  const Colors = useTheme();
  // Only include cards that have real content — prevents empty cards (urgency with no
  // due tasks, goal_progress with no goals) from falling back to self_comparison and
  // appearing as duplicate cards in the rotation. self_comparison is always the anchor.
  const availableCards = CARD_ORDER.filter((c) => {
    switch (c) {
      case 'urgency':
        return tasks.some((t) => {
          if (t.isCompleted || t.isArchived || !t.dueDate) return false;
          const d = diffCalendarDaysTasks(new Date(t.dueDate), new Date());
          return d >= 0 && d <= 6;
        });
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
      case 'urgency':         return <UrgencyCard tasks={tasks} onSelectAndFocus={onSelectAndFocus} />;
      case 'goal_progress':   return <GoalProgressCard goals={goals} onGoalPress={onGoalPress} />;
      case 'time_nudge':      return <TimeNudgeCard peakHour={peakHour} sessionHistory={sessionHistory} onFocus={onFocus} />;
      case 'momentum':        return <MomentumCard currentStreak={currentStreak} longestStreak={longestStreak} sessionHistory={sessionHistory} />;
      case 'self_comparison': return <SelfComparisonCard sessionHistory={sessionHistory} onFocus={onFocus} />;
      case 'recent_activity': return <RecentActivityCard />;
      default:                return <SelfComparisonCard sessionHistory={sessionHistory} onFocus={onFocus} />;
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

// ─── TagOverrideSheet ─────────────────────────────────────────────────────────
function TagOverrideSheet({ tag, visible, onClose }: { tag: string; visible: boolean; onClose: () => void }) {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const { overrides, setOverride, clearOverride } = useTagOverrideStore();
  const current = overrides[tag];
  // Initialize to null — the effect sets the correct value the moment visible becomes true,
  // preventing a stale value from showing on any frame before the sheet opens.
  const [selColor, setSelColor] = useState<TagColorKey | null>(null);
  const [selIcon, setSelIcon]   = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const ov = useTagOverrideStore.getState().overrides[tag];
      setSelColor((ov?.colorKey ?? getTagColor(tag).key) as TagColorKey);
      setSelIcon(ov?.icon ?? getTagIcon(tag));
    }
  }, [visible, tag]);

  const preview = (selColor ? TAG_COLOR_TOKENS.find((t) => t.key === selColor) : null) ?? TAG_COLOR_TOKENS[0];

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetHeight={SCREEN_H * 0.65}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: preview.bg }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: preview.text }}>{selIcon} {tag}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.subtext} /></TouchableOpacity>
        </View>
      </View>
      <View style={{ height: 0.5, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 16 }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.fieldLabel}>Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {TAG_COLOR_TOKENS.map((token) => (
            <TouchableOpacity key={token.key} onPress={() => setSelColor(token.key as TagColorKey)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: token.bar, alignItems: 'center', justifyContent: 'center', borderWidth: selColor === token.key ? 3 : 0, borderColor: '#fff' }}>
              {selColor === token.key && <Ionicons name="checkmark" size={18} color="#fff" />}
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Icon</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {TAG_ICONS.map((icon) => (
            <TouchableOpacity key={icon} onPress={() => setSelIcon(icon)} style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selIcon === icon ? Colors.raised : 'transparent', borderWidth: selIcon === icon ? 1.5 : 0.5, borderColor: selIcon === icon ? Colors.primary : Colors.border }}>
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => { if (selColor && selIcon) setOverride(tag, selColor, selIcon); onClose(); }} style={{ backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save</Text>
        </TouchableOpacity>
        {current && (
          <TouchableOpacity onPress={() => { clearOverride(tag); onClose(); }} style={{ borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }}>
            <Text style={{ color: Colors.subtext, fontWeight: '600', fontSize: 14 }}>Reset to default</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
type ActiveView = null | 'goal-detail' | 'time-tracker' | 'task-list' | 'calendar';

export default function TasksScreen() {
  const Colors = useTheme();
  const AMBER = Colors.warning;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const tasks = useTasksList();
  const recurringTemplates = useTaskStore((s) => s.recurringTemplates);

  // Recurring tasks with no live instance today. GET /tasks omits templates and
  // spawn-recurring archives every instance not due today, so on a day the
  // template is not scheduled for, the task had no representation anywhere and
  // silently vanished from the app.
  const selectedTaskId = useSelectedTaskId();
  const taskActions = useTaskActions();
  const settings = useSettings();
  const sessionLengthMinutes = Math.round(settings.workDuration / 60);

  const goals = useGoalStore((s) => s.goals);
  const goalActions = useGoalStore(
    useShallow((s) => ({
      fetchGoals: s.fetchGoals,
      createGoal: s.createGoal,
      updateGoal: s.updateGoal,
      deleteGoal: s.deleteGoal,
      toggleGoalComplete: s.toggleGoalComplete,
    })),
  );

  const router = useRouter();
  const dailySessionTarget = settings.dailySessionTarget;
  const streak = useGamificationStore((s) => s.currentStreak ?? 0);
  const longestStreak = useGamificationStore((s) => s.longestStreak ?? 0);
  // Drives whether the recent-activity card appears in the rotation at all. The
  // screen fetches it (below) rather than leaving it to the card: a card that is
  // filtered out never mounts, so a card-owned fetch could never populate itself.
  const hasActivity = useGamificationStore((s) => s.activity.length > 0);

  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>(null);
  // One period for both the summary card and the full report, so "See more"
  // always opens the period you were already looking at.
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('month');
  const [taskFilter, setTaskFilter] = useState<'all' | 'active' | 'pending' | 'done'>('all');
  const [showAllDormant, setShowAllDormant] = useState(false);
  const [statsTask, setStatsTask] = useState<Task | null>(null);
  // Held as an ID, not the goal object: GoalStatsModal reads the goal live from
  // the store so it cannot show numbers that went stale while it was open, or
  // render a goal that was deleted underneath it.
  const [statsGoalId, setStatsGoalId] = useState<string | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [formTask, setFormTask] = useState<Task | null>(null);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [formGoal, setFormGoal] = useState<TaskGoal | null>(null);
  const [overrideTag, setOverrideTag] = useState<string | null>(null);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [draftTarget, setDraftTarget] = useState(dailySessionTarget);
  const setDailySessionTarget = useTimerStore((s) => s.setDailySessionTarget);
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
    // Safety net — spawn today's recurring instances if boot missed it.
    useTaskStore.getState().spawnRecurringTasks();
    // Sibling: proactively reset the overall day-streak on a missed day.
    useGamificationStore.getState().checkAndResetDayStreak();
  }, []);

  // When the app returns to foreground, spawn for a potentially new day.
  useAppForeground(() => {
    useTaskStore.getState().spawnRecurringTasks();
    useGamificationStore.getState().checkAndResetDayStreak();
  });

  const loadSessionHistory = useCallback(async () => {
    try {
      const hist = await getSessionHistory();
      setSessionHistory(hist);
      const res = await api.get<{ sessions: { id: string; completedAt: string; durationSeconds: number; taskId: string | null; taskLabel: string | null; clientSessionId: string | null }[] }>('/timer/sessions');
      if (res.success && res.data?.sessions) {
        await mergeWithServerSessions(res.data.sessions);
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

  // ── Date anchors — live clock, updates at the start of every minute ──
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const monday = useMemo(() => getMonday(now), [now]);
  const nextMonday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() + 7); return d; }, [monday]);
  const todayColIndex = useMemo(() => { const d = now.getDay(); return d === 0 ? 6 : d - 1; }, [now]);

  // ── Session analytics ──
  const todaySessions = useMemo(() => sessionHistory.filter((s) => s.type === 'focus' && isToday(s.completedAt)), [sessionHistory]);
  const sessionsToday = todaySessions.length;
  const focusSecondsToday = useMemo(() => todaySessions.reduce((sum, s) => sum + s.durationSeconds, 0), [todaySessions]);
  const sessionsLeft = Math.max(0, dailySessionTarget - sessionsToday);

  // Seconds, not session count: a 90-minute session and a 5-minute one are not
  // the same amount of work and must not draw the same bar.
  const thisWeekByDay = useMemo(() => {
    const seconds = [0,0,0,0,0,0,0];
    for (const s of sessionHistory) { if (s.type !== 'focus') continue; const d = new Date(s.completedAt); if (d >= monday && d < nextMonday) { const dow = d.getDay(); seconds[dow === 0 ? 6 : dow-1] += s.durationSeconds; } }
    return seconds;
  }, [sessionHistory, monday, nextMonday]);

  const maxDaySeconds = useMemo(() => Math.max(...thisWeekByDay, 1), [thisWeekByDay]);


  // Category totals used to be derived here, from the local session cache, and
  // that second derivation is what disagreed with the server. The Time Tracker
  // card reads GET /time-report now, so there is nothing left to compute.

  // ── Peak focus ──
  const allFocusSessions = useMemo(() => sessionHistory.filter((s) => s.type === 'focus'), [sessionHistory]);
  const peakHour = useMemo(() => getPeakHour(allFocusSessions), [allFocusSessions]);
  const weeklyCompletionRate = useMemo(() => getCompletionRate(tasks, 'week'), [tasks]);

  // ── Task groups ──
  const nonArchived = useMemo(() => tasks.filter((t) => !t.isArchived), [tasks]);
  const activeTask = useMemo(() => nonArchived.find((t) => t.id === selectedTaskId && !t.isCompleted) ?? null, [nonArchived, selectedTaskId]);
  const pendingTasks = useMemo(() => nonArchived.filter((t) => !t.isCompleted && t.id !== selectedTaskId), [nonArchived, selectedTaskId]);
  const doneTasks = useMemo(() => nonArchived.filter((t) => t.isCompleted), [nonArchived]);
  const existingTags = useMemo(() => { const s = new Set<string>(); for (const t of tasks) t.tags.forEach((tag) => s.add(tag)); return Array.from(s); }, [tasks]);

  // ── Pill strip data ──
  const completedToday = useMemo(() => tasks.filter((t) => t.isCompleted && t.completedAt && isToday(new Date(t.completedAt).getTime())).length, [tasks]);
  const yesterdayCompleted = useMemo(() => tasks.filter((t) => t.isCompleted && t.completedAt && isYesterdayLocal(new Date(t.completedAt).getTime())).length, [tasks]);
  const totalActiveTasks = nonArchived.length;
  const lastWeekCompletionRate = useMemo(() => getLastWeekCompletionRate(tasks), [tasks]);
  const dailyFocusTargetSeconds = dailySessionTarget * sessionLengthMinutes * 60;

  // ── Smart hero card ──
  const goalsForHero = goals; // goalStore exists; pass through
  const hero = useHeroCard({ tasks, goals: goalsForHero, sessionHistory, peakHour });
  const goToFocus = useCallback(() => router.push('/(tabs)'), [router]);
  const selectAndFocus = useCallback((id: string) => { taskActions.selectTask(id); router.push('/(tabs)'); }, [taskActions, router]);

  // ── Filtered tasks for detail view ──
  const filteredTasks = useMemo(() => {
    if (taskFilter === 'active') return activeTask ? [activeTask] : [];
    if (taskFilter === 'pending') return pendingTasks;
    if (taskFilter === 'done') return doneTasks;
    return nonArchived;
  }, [taskFilter, activeTask, pendingTasks, doneTasks, nonArchived]);

  // Composed for rendering only. Deliberately NOT merged into `nonArchived`:
  // that array feeds totalActiveTasks and the PillStrip denominator, and adding
  // habits there would show a completion count the user can never reach.
  const listForFilter = useMemo(
    () => composeTaskList({
      tasks: filteredTasks,
      templates: recurringTemplates as RecurringTemplate[],
      filter: taskFilter,
      limitDormant: showAllDormant ? undefined : DORMANT_VISIBLE,
    }),
    [filteredTasks, recurringTemplates, taskFilter, showAllDormant],
  );

  // The main tab reserves two slots so a recurring task is visible without
  // opening the drill-down; the zone is capped at four rows total.
  const zoneDormant = useMemo(
    () => composeTaskList({
      tasks: [],
      templates: recurringTemplates as RecurringTemplate[],
      filter: 'all',
      limitDormant: ZONE_DORMANT_SLOTS,
    }),
    [recurringTemplates],
  );

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
    if (action === 'start-session') { router.push('/'); return; }
    // Linking and rescheduling both happen in a form. A task is linked from the
    // TASK form (that is where taskGoalId lives), a deadline from the GOAL form.
    if (action === 'link-task') { setFormTask(null); setShowFormModal(true); return; }
    const goal = goals.find((g) => g.id === goalId);
    if (goal) { setFormGoal(goal); setShowGoalForm(true); }
  }, [router, goals]);

  const openCreate = useCallback(() => { setFormTask(null); setShowFormModal(true); }, []);
  const openEdit = useCallback((task: Task) => { setFormTask(task); setShowFormModal(true); }, []);

  const handleFormSave = useCallback(async (data: FormSaveData) => {
    setShowFormModal(false);
    const { isRecurring, recurringDays, ...rest } = data;
    if (formTask) {
      if (formTask.parentTaskId) {
        // Editing a recurring instance: recurring settings live on the template.
        await api.patch(`/tasks/${formTask.parentTaskId}`, {
          isRecurring,
          recurringDays,
          title: rest.title,
          estimatedMinutes: rest.estimatedMinutes,
          priority: rest.priority,
          tags: rest.tags,
          // The time slot belongs to the habit, so future spawns inherit the
          // change rather than only today’s instance moving.
          startMinutes: rest.startMinutes,
          endMinutes: rest.endMinutes,
        });
        await useTaskStore.getState().fetchRecurringTemplates();
        // Still apply edits to the visible instance itself.
        await taskActions.updateTask(formTask.id, rest);
      } else {
        // Regular task — pass recurring through so it can be promoted to recurring.
        await taskActions.updateTask(formTask.id, data);
      }
    } else {
      // No cast: taskGoalId must survive to the server, and the types now say so.
      await taskActions.createTask(data);
    }
    setFormTask(null);
  }, [formTask, taskActions]);

  const handleDeleteById = useCallback((taskId: string) => {
    Alert.alert(
      'Delete task?',
      "This permanently deletes the task and all of its focus sessions. That time is removed from your total focus time and the time tracker. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
            await taskActions.deleteTask(taskId);
            setShowFormModal(false); setFormTask(null);
            // Refresh the local tracker history and server-backed totals.
            loadSessionHistory();
            useGamificationStore.getState().fetchProfile();
          } },
      ],
    );
  }, [taskActions, loadSessionHistory]);

  const handleComplete = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await taskActions.toggleComplete(taskId);
    showToast(task.isCompleted ? 'Marked incomplete' : '✓ Marked complete');
  }, [tasks, taskActions, showToast]);

  const handleGoalDelete = useCallback(() => {
    if (!formGoal) return;
    const goalToDelete = formGoal;
    Alert.alert(
      'Delete goal?',
      `"${goalToDelete.title}" will be removed. Linked tasks are kept — they just won't belong to a goal any more.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setShowGoalForm(false);
            setFormGoal(null);
            await goalActions.deleteGoal(goalToDelete.id);
            // The server clears taskGoalId on every linked task, so refetch to
            // drop the now-stale goal chips.
            await useTaskStore.getState().fetchTasks(true);
          },
        },
      ],
    );
  }, [formGoal, goalActions]);

  const handleGoalSave = useCallback(async (data: any) => {
    setShowGoalForm(false);
    if (formGoal) await goalActions.updateGoal(formGoal.id, data);
    else await goalActions.createGoal(data);
    setFormGoal(null);
  }, [formGoal, goalActions]);

  // ── Back from detail view ──
  const goBack = useCallback(() => setActiveView(null), []);

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
              {/* Tappable: this pill is derived from the daily session target, so
                  it is the natural place to change it. */}
              <TouchableOpacity
                style={{ flex: 1 }}
                activeOpacity={0.7}
                onPress={() => { setDraftTarget(dailySessionTarget); setShowTargetPicker(true); }}
                accessibilityRole="button"
                accessibilityLabel={`${sessionsLeft} sessions to go. Change daily session goal`}
              >
                {/* "Today's target", not "Sessions to go" — the old label read as
                    a Goal, which is a different feature entirely. */}
                <TodayPill value={String(sessionsLeft)} label="Today's target" />
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
            ) : goals.map((g) => (
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
              {DAY_LABELS.map((label, i) => <BarColumn key={i} dayLabel={label} seconds={thisWeekByDay[i]} maxSeconds={maxDaySeconds} isToday={i === todayColIndex} isFuture={i > todayColIndex} />)}
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
        <GoalFormModal visible={showGoalForm} goal={formGoal} existingTags={existingTags} sessionLengthMinutes={sessionLengthMinutes} onSave={handleGoalSave} onClose={() => { setShowGoalForm(false); setFormGoal(null); }} onDelete={formGoal ? handleGoalDelete : undefined} />
        <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
        {/* Mounted here as well as in the Tasks tab: this screen owns a control
            that opens it, so it has to be able to render it. */}
        <DailyTargetModal
          visible={showTargetPicker}
          draft={draftTarget}
          onDraftChange={setDraftTarget}
          onCancel={() => setShowTargetPicker(false)}
          onSave={() => { setDailySessionTarget(draftTarget); setShowTargetPicker(false); }}
        />
      </SafeAreaView>
    );
  }

  if (activeView === 'time-tracker') {
    // Rebuilt as a server-aggregated retrospective. It reads attribution frozen
    // onto each session at write time, so archived tasks and renamed goals no
    // longer change what a past window reports — see components/timeReport.
    //
    // Its period is separate from `trackerPeriod`, which still drives the
    // summary card on the tab behind it. Sharing one would mean a period the
    // summary card cannot display (Quarter) leaving its switcher with nothing
    // selected.
    return (
      <>
        <TimeReportView
          period={reportPeriod}
          onPeriodChange={setReportPeriod}
          onBack={goBack}
          onLongPressTag={setOverrideTag}
        />
        <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
      </>
    );
  }

  if (activeView === 'task-list') {
    const FILTERS: { key: typeof taskFilter; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'pending', label: 'Pending' }, { key: 'done', label: 'Done' }];
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 }}>
          <TouchableOpacity onPress={goBack} style={{ marginRight: 12 }}><Ionicons name="chevron-back" size={24} color={Colors.text} /></TouchableOpacity>
          <Text style={{ flex: 1, color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>All Tasks</Text>
          <TouchableOpacity onPress={openCreate} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, marginBottom: 12 }}>
          {FILTERS.map(({ key, label }) => (
            <TouchableOpacity key={key} onPress={() => setTaskFilter(key)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: taskFilter === key ? Colors.primary : Colors.raised, borderWidth: 1, borderColor: taskFilter === key ? Colors.primary : Colors.border }}>
              <Text style={{ color: taskFilter === key ? '#fff' : Colors.subtext, fontSize: 13, fontWeight: '600' }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
          {/* Empty state stays keyed on REAL tasks: someone whose only items are
              unscheduled habits still needs "Nothing planned yet" and the path
              to create something. */}
          {filteredTasks.length === 0 && (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 36, marginTop: 8 }]}>
              <Text style={{ color: Colors.subtext, fontSize: 13 }}>Nothing planned yet. What has to move today?</Text>
            </View>
          )}
          {filteredTasks.map((task) => (
            <TaskRow key={task.id} task={task} isActive={task.id === selectedTaskId} goals={goals} onTap={() => setStatsTask(task)} onEdit={() => openEdit(task)} onComplete={() => handleComplete(task.id)} onLongPressTag={setOverrideTag} />
          ))}

          {/* Recurring tasks on a day they are not scheduled. Below a labelled
              divider so the All filter visibly holds a second class of thing
              rather than silently miscounting. */}
          {listForFilter.dormantTotal > 0 && (
            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
                <Text style={{ color: Colors.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>
                  Not scheduled today · {listForFilter.dormantTotal}
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
              </View>
              {listForFilter.items.map((item) => (
                item.kind === 'dormant' ? (
                  <DormantRecurringRow
                    key={item.template.id}
                    template={item.template}
                    goals={goals}
                    subtitle={nextOccurrenceLabel(item.template)}
                    onEdit={() => openEdit(item.template)}
                    onLongPressTag={setOverrideTag}
                  />
                ) : null
              ))}
              {listForFilter.dormantHidden > 0 && (
                <TouchableOpacity onPress={() => setShowAllDormant(true)} style={{ paddingVertical: 8, alignItems: 'center' }}>
                  <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600' }}>
                    Show {listForFilter.dormantHidden} more →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

        </ScrollView>
        {statsTask && <TaskStatsModal task={statsTask} sessionLengthMinutes={sessionLengthMinutes} onClose={() => setStatsTask(null)} onLoadTimer={(id) => { taskActions.selectTask(id); setStatsTask(null); }} onToggleComplete={(id) => { handleComplete(id); setStatsTask(null); }} onEdit={(id) => { setStatsTask(null); const t = tasks.find((x) => x.id === id); if (t) openEdit(t); }} />}
        <TaskFormModal visible={showFormModal} task={formTask} existingTags={existingTags} sessionLengthMinutes={sessionLengthMinutes} goals={goals} onSave={handleFormSave} onClose={() => { setShowFormModal(false); setFormTask(null); }} onDelete={formTask ? () => handleDeleteById(formTask.id) : undefined} />
        <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
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
              <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>Tasks</Text>
            </View>
            <TouchableOpacity onPress={openCreate} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pill strip */}
        <PillStrip
          completedToday={completedToday}
          yesterdayCompleted={yesterdayCompleted}
          totalActive={totalActiveTasks}
          weeklyRate={weeklyCompletionRate}
          lastWeekRate={lastWeekCompletionRate}
          focusSecondsToday={focusSecondsToday}
          dailyFocusTargetSeconds={dailyFocusTargetSeconds}
          onSetGoal={() => { setDraftTarget(dailySessionTarget); setShowTargetPicker(true); }}
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
          onSelectAndFocus={selectAndFocus}
          onGoalPress={(goalId) => setStatsGoalId(goalId)}
          onFocus={goToFocus}
        />

        <DailyTargetModal
          visible={showTargetPicker}
          draft={draftTarget}
          onDraftChange={setDraftTarget}
          onCancel={() => setShowTargetPicker(false)}
          onSave={() => { setDailySessionTarget(draftTarget); setShowTargetPicker(false); }}
        />

        {/* Zone 2 — Task List */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <ZoneHeader title="Tasks" onSeeMore={() => setActiveView('task-list')} />
          {nonArchived.length === 0 && zoneDormant.items.length === 0 ? (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 36 }]}>
              <Ionicons name="checkbox-outline" size={32} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 10 }}>Nothing planned yet. What has to move today?</Text>
            </View>
          ) : (<>
            {(() => {
              const combined = activeTask ? [activeTask, ...pendingTasks] : pendingTasks;
              const dormant = zoneDormant.items;
              if (combined.length === 0 && dormant.length === 0) return null;
              // Reserved slots: a recurring task stays visible here even when
              // there are more than enough real tasks to fill the zone. Sorting
              // it to the bottom of a four-row cap would have kept it invisible
              // on the screen the user actually opens, which is the bug.
              const taskSlots = dormant.length > 0 ? ZONE_TASK_SLOTS : ZONE_TASK_SLOTS + ZONE_DORMANT_SLOTS;
              const shownTasks = combined.slice(0, taskSlots);
              const overflow = combined.length - shownTasks.length;
              return (
                <View style={{ marginBottom: 12 }}>
                  {shownTasks.map((task) => (
                    <TaskRow key={task.id} task={task} isActive={task.id === activeTask?.id} goals={goals} onTap={() => setStatsTask(task)} onEdit={() => openEdit(task)} onComplete={() => handleComplete(task.id)} onLongPressTag={setOverrideTag} />
                  ))}
                  {dormant.map((item) => (
                    item.kind === 'dormant' ? (
                      <DormantRecurringRow
                        key={item.template.id}
                        template={item.template}
                        goals={goals}
                        subtitle={nextOccurrenceLabel(item.template)}
                        onEdit={() => openEdit(item.template)}
                        onLongPressTag={setOverrideTag}
                      />
                    ) : null
                  ))}
                  {(overflow > 0 || zoneDormant.dormantHidden > 0) && <TouchableOpacity onPress={() => setActiveView('task-list')} style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600' }}>+{overflow + zoneDormant.dormantHidden} more →</Text></TouchableOpacity>}
                </View>
              );
            })()}
            {doneTasks.slice(0, 2).length > 0 && <View>
              <GroupHeader dotColor={Colors.accent} label="Done" count={doneTasks.length} />
              {doneTasks.slice(0, 2).map((task) => <TaskRow key={task.id} task={task} isActive={false} goals={goals} onTap={() => setStatsTask(task)} onEdit={() => openEdit(task)} onComplete={() => handleComplete(task.id)} onLongPressTag={setOverrideTag} />)}
            </View>}
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

        {/* Zone 4 — Time Tracker.

            Reads GET /time-report, the same source as the full report behind
            "See more", and shares its period state. It used to compute its own
            numbers from the local session cache, which is how it came to say
            27m today / 1h 17m this month while the report said nothing today /
            50m this month — same sessions, one tap apart. Two sources for one
            fact is a bug generator; there is now one. */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <ZoneHeader title="Time Tracker" onSeeMore={() => setActiveView('time-tracker')} />
          <View style={[styles.card]}>
            <TimeReportSummary
              period={reportPeriod}
              onPeriodChange={setReportPeriod}
              onSeeMore={() => setActiveView('time-tracker')}
            />
          </View>
        </View>

      </ScrollView>

      {/* Modals */}
      {statsTask && <TaskStatsModal task={statsTask} sessionLengthMinutes={sessionLengthMinutes} onClose={() => setStatsTask(null)} onLoadTimer={(id) => { taskActions.selectTask(id); setStatsTask(null); }} onToggleComplete={(id) => { handleComplete(id); setStatsTask(null); }} onEdit={(id) => { setStatsTask(null); const t = tasks.find((x) => x.id === id); if (t) openEdit(t); }} />}
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
      <TaskFormModal visible={showFormModal} task={formTask} existingTags={existingTags} sessionLengthMinutes={sessionLengthMinutes} goals={goals} onSave={handleFormSave} onClose={() => { setShowFormModal(false); setFormTask(null); }} onDelete={formTask ? () => handleDeleteById(formTask.id) : undefined} />
      <GoalFormModal visible={showGoalForm} goal={formGoal} existingTags={existingTags} sessionLengthMinutes={sessionLengthMinutes} onSave={handleGoalSave} onClose={() => { setShowGoalForm(false); setFormGoal(null); }} onDelete={formGoal ? handleGoalDelete : undefined} />
      <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
      <Toast message={toast} />
    </SafeAreaView>
  );
}
