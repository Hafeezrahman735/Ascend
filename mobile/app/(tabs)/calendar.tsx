import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useCalendarStore } from '../../stores/calendarStore';
import { useUserSettingsStore } from '../../stores/userSettingsStore';
import { useTheme } from '../../hooks/useTheme';
import { useTaskStore } from '../../stores/taskStore';
import { useDaySessions } from '../../hooks/useTimeReport';
import type { CalendarEvent, CalendarItem, Note, Task, TimelineSession } from '../../types';
import TaskStatsModal, { type FocusedOnDay } from '../../components/TaskStatsModal';
import TaskFormModal from '../../components/TaskFormModal';
import RoundedTabs from '../../components/RoundedTabs';
import { useTaskForm, type TaskFormChange } from '../../hooks/useTaskForm';
import type { Slot } from '../../lib/planScreen';
import SessionsSheet, { type SessionsTarget } from '../../components/timeReport/SessionsSheet';
import { planVsActual, plannedBlocksFromCalendar } from '../../lib/planVsActual';
import { taskFocusOnDay } from '../../lib/calendarViews';
import { taskForCalendarItem, completionToggleFor } from '../../lib/calendarTask';
import {
  getLocalDateString, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addDays, addMonths, parseLocalDate,
} from '../../utils/date';
import {
  getCalendarStyles, groupItemsByDate, VIEW_MODES, type CalendarViewMode,
} from '../../components/calendar/shared';
import MonthView from '../../components/calendar/MonthView';
import WeekView from '../../components/calendar/WeekView';
import DayView from '../../components/calendar/DayView';
import PlanningView, { type PlanHighlight } from '../../components/calendar/PlanningView';
import type { AddKind } from '../../components/calendar/AddRow';
import EventFormSheet, { type EventDraft } from '../../components/calendar/EventFormSheet';
import NoteFormSheet, { type NoteDraft } from '../../components/calendar/NoteFormSheet';

/**
 * Calendar tab — owns the view mode, the anchored date, and the fetch for the
 * visible range. Rendering lives in components/calendar/.
 */
export default function CalendarScreen() {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);

  // Week ranges follow the user's 'week starts on' setting.
  const weekStartsOn = useUserSettingsStore((s) => s.weekStartDay);

  // Plan opens first: what needs doing comes before which day it lands on.
  const [viewMode, setViewMode] = useState<CalendarViewMode>('planning');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // One piece of state per sheet, holding both "is it open" and "what is it
  // editing". Two separate flags could disagree — open with nothing to edit, or
  // hold a stale row while closed — and this cannot.
  // `date` is the day a NEW item opens on when the caller knows it (Month's
  // selected day); otherwise the sheet uses sheetDefaultDate.
  const [eventSheet, setEventSheet] = useState<{ event: CalendarEvent | null; date?: string } | null>(null);
  const [noteSheet, setNoteSheet] = useState<{ note: Note | null; date?: string } | null>(null);
  // A planned block's task sheet, and the session list it (or a dashed block) opens.
  const [taskSheet, setTaskSheet] = useState<{ task: Task; date: string } | null>(null);
  const [sessionsTarget, setSessionsTarget] = useState<SessionsTarget | null>(null);
  const router = useRouter();

  // Picked inside the selector. Destructuring the result of a bare hook call
  // reads the same fields but subscribes to the whole store, so it re-renders on
  // anything — including the Google-sync status this screen never shows.
  const {
    items, isLoading, error, syncWarning,
    fetchRange, createNote, updateNote, deleteNote,
    createEvent, updateEvent, deleteEvent,
  } = useCalendarStore(
    useShallow((s) => ({
      items: s.items,
      isLoading: s.isLoading,
      error: s.error,
      syncWarning: s.syncWarning,
      fetchRange: s.fetchRange,
      createNote: s.createNote,
      updateNote: s.updateNote,
      deleteNote: s.deleteNote,
      createEvent: s.createEvent,
      updateEvent: s.updateEvent,
      deleteEvent: s.deleteEvent,
    })),
  );

  // The visible range is derived from the mode, so every view fetches exactly
  // what it renders and nothing more.
  const { start, end } = useMemo(() => {
    if (viewMode === 'day') {
      const day = getLocalDateString(anchorDate);
      return { start: day, end: day };
    }
    if (viewMode === 'month') {
      return {
        start: getLocalDateString(startOfMonth(anchorDate)),
        end: getLocalDateString(endOfMonth(anchorDate)),
      };
    }
    // Week view and Plan both operate on the anchored week.
    return {
      start: getLocalDateString(startOfWeek(anchorDate, weekStartsOn)),
      end: getLocalDateString(endOfWeek(anchorDate, weekStartsOn)),
    };
  }, [viewMode, anchorDate, weekStartsOn]);

  // Every view renders the scheduled items that fetchRange returns.
  const loadVisibleRange = useCallback(() => fetchRange(start, end), [start, end, fetchRange]);

  useEffect(() => {
    loadVisibleRange();
  }, [loadVisibleRange]);

  // Focus sessions: the plan-vs-actual overlay on Day and Week, and the task
  // sheet's Focused row everywhere it opens (Plan included).
  const timeline = useDaySessions(start, end, viewMode !== 'month');

  // Tasks are created and edited on another tab, so by the time the calendar is
  // shown again its range can be out of date. taskStore flags the change and
  // this pays for it — one refetch, only when something actually moved.
  useFocusEffect(
    useCallback(() => {
      if (useCalendarStore.getState().isStale) loadVisibleRange();
    }, [loadVisibleRange]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadVisibleRange();
    setRefreshing(false);
  }, [loadVisibleRange]);

  const itemsByDate = useMemo(() => groupItemsByDate(items), [items]);

  const step = useCallback((direction: 1 | -1) => {
    setAnchorDate((prev) => {
      if (viewMode === 'day') return addDays(prev, direction);
      if (viewMode === 'month') return addMonths(prev, direction);
      return addDays(prev, direction * 7);
    });
  }, [viewMode]);

  const headerLabel = useMemo(() => {
    if (viewMode === 'day') {
      return anchorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
    if (viewMode === 'month') {
      return anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const from = startOfWeek(anchorDate, weekStartsOn);
    const to = endOfWeek(anchorDate, weekStartsOn);
    return `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    // weekStartsOn belongs here: without it, changing the setting left the range
    // in the header describing the old week boundaries.
  }, [viewMode, anchorDate, weekStartsOn]);

  const openDay = useCallback((date: string) => {
    setAnchorDate(parseLocalDate(date));
    setViewMode('day');
  }, []);

  const toggleNote = useCallback(
    (note: Note) => updateNote(note.id, { isCompleted: !note.isCompleted }),
    [updateNote],
  );

  const weekStart = useMemo(
    () => startOfWeek(anchorDate, weekStartsOn),
    [anchorDate, weekStartsOn],
  );

  // The day a new event or note opens on when no caller chose one: the anchored
  // day when it is inside the anchored week, and the start of that week
  // otherwise. Any other day can be picked in the sheet.
  const sheetDefaultDate = useMemo(() => {
    const anchored = getLocalDateString(anchorDate);
    const weekEnd = getLocalDateString(endOfWeek(anchorDate, weekStartsOn));
    const from = getLocalDateString(weekStart);
    return anchored >= from && anchored <= weekEnd ? anchored : from;
  }, [anchorDate, weekStart, weekStartsOn]);

  /**
   * Follow a saved item to wherever it landed.
   *
   * The sheets accept any date, and the calendar only loads the visible range,
   * so an item saved outside it would be written correctly and then be nowhere
   * on screen. Re-anchoring refetches the range that now contains it from the
   * server, so it stays after the next reload too.
   */
  const followDate = useCallback((date: string) => {
    if (date < start || date > end) setAnchorDate(parseLocalDate(date));
  }, [start, end]);

  const handleSaveEvent = useCallback(async (draft: EventDraft) => {
    const editing = eventSheet?.event ?? null;
    const ok = editing
      ? await updateEvent(editing.id, draft)
      : !!(await createEvent(draft));
    if (!ok) return;
    setEventSheet(null);
    followDate(draft.date);
  }, [eventSheet, updateEvent, createEvent, followDate]);

  const handleDeleteEvent = useCallback(async () => {
    const editing = eventSheet?.event;
    if (!editing) return;
    setEventSheet(null);
    await deleteEvent(editing.id);
  }, [eventSheet, deleteEvent]);

  const handleSaveNote = useCallback(async (draft: NoteDraft) => {
    const editing = noteSheet?.note ?? null;
    if (editing) await updateNote(editing.id, draft);
    else await createNote(draft);
    setNoteSheet(null);
    followDate(draft.date);
  }, [noteSheet, updateNote, createNote, followDate]);

  const handleDeleteNoteFromSheet = useCallback(async () => {
    const editing = noteSheet?.note;
    if (!editing) return;
    setNoteSheet(null);
    await deleteNote(editing.id);
  }, [noteSheet, deleteNote]);

  // Day view routes a tapped block or row back to the sheet that owns it.
  const handleItemPress = useCallback((item: CalendarItem) => {
    if (item.type === 'event') setEventSheet({ event: item.data as CalendarEvent });
    else if (item.type === 'note') setNoteSheet({ note: item.data as Note });
    else if (item.type === 'work_block' || item.type === 'task_due' || item.type === 'habit_instance') {
      // The item's data is narrow; the sheet needs the full task from the store.
      const { tasks, recurringTemplates } = useTaskStore.getState();
      const task = taskForCalendarItem(item, tasks, recurringTemplates);
      if (task) setTaskSheet({ task, date: item.date });
      else console.warn('[calendar] task not in the store:', (item.data as { id?: string }).id);
    }
  }, []);

  const dayLabelFor = useCallback((date: string) => (
    date === getLocalDateString()
      ? 'today'
      : parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  ), []);

  // The "Focused <day>" row: this task's fill on the sheet's day.
  const sheetFocused = useMemo((): FocusedOnDay | undefined => {
    if (!taskSheet) return undefined;
    const { task, date } = taskSheet;
    const plan = planVsActual(date, plannedBlocksFromCalendar(itemsByDate.get(date) ?? []), timeline.sessions);
    // The same helper as the Week lane's "52m/1h30", so the two always agree.
    const focus = taskFocusOnDay(plan, task.id);
    return {
      dayLabel: dayLabelFor(date),
      seconds: focus?.seconds ?? 0,
      sessions: focus?.sessions ?? 0,
      plannedMinutes: focus?.plannedMinutes ?? null,
    };
  }, [taskSheet, itemsByDate, timeline.sessions, dayLabelFor]);

  // One sheet at a time: the task sheet closes before the session list opens.
  const showTaskSessions = useCallback(() => {
    if (!taskSheet) return;
    const { task, date } = taskSheet;
    setTaskSheet(null);
    setSessionsTarget({ by: 'task', key: task.id, from: date, to: date, title: task.title, subtitle: dayLabelFor(date) });
  }, [taskSheet, dayLabelFor]);

  const handleSessionPress = useCallback((session: TimelineSession) => {
    setSessionsTarget({
      by: 'task',
      key: session.taskId,
      from: session.localDate,
      to: session.localDate,
      title: session.taskTitle ?? 'Timer, no task',
      subtitle: `${dayLabelFor(session.localDate)} · unplanned`,
    });
  }, [dayLabelFor]);

  // Same lock as Today: a running focus session cannot be moved to another task.
  const loadTaskIntoTimer = useCallback((id: string) => {
    setTaskSheet(null);
    const store = useTaskStore.getState();
    if (store.selectTask(id)) {
      router.navigate('/(tabs)/focus');
      return;
    }
    const running = store.tasks.find((t) => t.id === store.selectedTaskId);
    const message = `A session is running on ${running?.title ?? 'another task'}. Finish it to switch tasks.`;
    AccessibilityInfo.announceForAccessibility(message);
    Alert.alert('Session in progress', message);
  }, [router]);

  const toggleTaskComplete = useCallback(async () => {
    if (!taskSheet) return;
    const toggle = completionToggleFor(taskSheet.task);
    setTaskSheet(null);
    if (toggle.kind === 'occurrence') {
      const ok = await useTaskStore.getState().setOccurrenceCompletion(toggle.id, toggle.date, toggle.done);
      if (!ok) Alert.alert('Not saved', 'That change could not be saved. Try again.');
    } else {
      await useTaskStore.getState().toggleComplete(toggle.id);
    }
    loadVisibleRange();
  }, [taskSheet, loadVisibleRange]);

  // ── The task form, hosted here for + Task and Find a slot ──
  // A just-saved task, to open its day row on Plan and tint it (design DR3).
  const [highlight, setHighlight] = useState<PlanHighlight | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  /**
   * After a task save from this screen, show it. The task store only marks the
   * calendar stale, and the calendar reloads on focus, which never comes while
   * the calendar is already the focused tab. So: follow the task to its range
   * if it left this one (the anchor change refetches), otherwise reload now.
   * Without this, Find a slot would offer the same gap twice.
   */
  const handleTaskChanged = useCallback(async (change: TaskFormChange) => {
    // `date` is the work block a save added or the task's next one (else its
    // due date), so Find a slot lands on the slot's day, not the deadline.
    const { date, taskId, kind } = change;
    if (date && (date < start || date > end)) setAnchorDate(parseLocalDate(date));
    else await loadVisibleRange();
    if (kind === 'deleted' || !date || !taskId) return;
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlight({ date, taskId });
    highlightTimer.current = setTimeout(() => setHighlight(null), 1600);
  }, [start, end, loadVisibleRange]);

  const taskForm = useTaskForm({ onChanged: handleTaskChanged });
  const { openCreate: openTaskCreate, openEdit: openTaskEdit } = taskForm;

  /**
   * + Task / + Event / + Note. Events and notes open on `date` when given. A
   * task starts with nothing planned (D8, as on Today and Plan) unless the
   * caller asks: only Day view does, and there the new task gets an any-time
   * work block on that day, never a due date (task-due-and-work-blocks D10).
   * An explicit flag, not "a date was passed": Month passes its selected day
   * for events and notes and must keep tasks unplanned.
   */
  const handleAdd = useCallback((kind: AddKind, date?: string, opts?: { taskOnDate?: boolean }) => {
    if (kind === 'task') {
      openTaskCreate(opts?.taskOnDate && date
        ? { block: { date, startMinutes: null, endMinutes: null } }
        : undefined);
    }
    else if (kind === 'event') setEventSheet({ event: null, date });
    else setNoteSheet({ note: null, date });
  }, [openTaskCreate]);

  // Find a slot opens the task's own form with the gap added as a work block;
  // its due date is untouched, and nothing is written until Save (design D5).
  const handleFindSlot = useCallback((task: Task, slot: Slot) => {
    openTaskEdit(task, { block: { date: slot.date, startMinutes: slot.startMinutes, endMinutes: slot.endMinutes } });
  }, [openTaskEdit]);

  const openUnscheduledTask = useCallback((task: Task) => {
    setTaskSheet({ task, date: getLocalDateString() });
  }, []);

  const showSpinner = isLoading && items.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <RoundedTabs tabs={VIEW_MODES} value={viewMode} onChange={setViewMode} />

      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => step(-1)} style={styles.navBtn} hitSlop={8} accessibilityLabel="Previous">
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAnchorDate(new Date())} style={{ flex: 1 }} accessibilityLabel="Jump to today">
          <Text style={styles.navLabel} numberOfLines={1}>{headerLabel}</Text>
          <Text style={styles.navToday}>Tap for today</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => step(1)} style={styles.navBtn} hitSlop={8} accessibilityLabel="Next">
          <Ionicons name="chevron-forward" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {syncWarning && (
        <View style={styles.warnBanner}>
          <Ionicons name="warning-outline" size={14} color={Colors.ROSE} />
          <Text style={styles.warnText}>{syncWarning}</Text>
        </View>
      )}
      {error && (
        <View style={styles.warnBanner}>
          <Ionicons name="alert-circle-outline" size={14} color={Colors.ROSE} />
          <Text style={styles.warnText}>{error}</Text>
        </View>
      )}

      {showSpinner ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {viewMode === 'week' && (
            <WeekView
              start={weekStart}
              itemsByDate={itemsByDate}
              sessions={timeline.sessions}
              focusError={timeline.error}
              onRetryFocus={timeline.reload}
              highlight={highlight}
              onDayPress={openDay}
              onItemPress={handleItemPress}
              onToggleNote={toggleNote}
            />
          )}
          {viewMode === 'month' && (
            <MonthView
              anchorDate={anchorDate}
              itemsByDate={itemsByDate}
              onDayPress={openDay}
              onToggleNote={toggleNote}
              onAdd={handleAdd}
            />
          )}
          {viewMode === 'day' && (
            <DayView
              dateKey={getLocalDateString(anchorDate)}
              itemsByDate={itemsByDate}
              onAdd={(kind) => handleAdd(kind, getLocalDateString(anchorDate), { taskOnDate: true })}
              onToggleNote={toggleNote}
              onItemPress={handleItemPress}
              sessions={timeline.sessions}
              focusError={timeline.error}
              onRetryFocus={timeline.reload}
              onSessionPress={handleSessionPress}
            />
          )}
          {viewMode === 'planning' && (
            <PlanningView
              weekStart={weekStart}
              itemsByDate={itemsByDate}
              highlight={highlight}
              onAdd={handleAdd}
              onOpenDay={openDay}
              onItemPress={handleItemPress}
              onToggleNote={toggleNote}
              onOpenTask={openUnscheduledTask}
              onStartFocus={loadTaskIntoTimer}
              onFindSlot={handleFindSlot}
            />
          )}
        </ScrollView>
      )}

      <EventFormSheet
        visible={!!eventSheet}
        event={eventSheet?.event ?? null}
        defaultDate={eventSheet?.date ?? sheetDefaultDate}
        onSave={handleSaveEvent}
        onDelete={eventSheet?.event ? handleDeleteEvent : undefined}
        onClose={() => setEventSheet(null)}
      />

      <NoteFormSheet
        visible={!!noteSheet}
        note={noteSheet?.note ?? null}
        defaultDate={noteSheet?.date ?? sheetDefaultDate}
        onSave={handleSaveNote}
        onDelete={noteSheet?.note ? handleDeleteNoteFromSheet : undefined}
        onClose={() => setNoteSheet(null)}
      />

      <TaskFormModal {...taskForm.props} />

      {/* Edit is not offered from this sheet: the founder chose to keep it on
          Today (design review D13), even though the form is shared now. */}
      {taskSheet && (
        <TaskStatsModal
          task={taskSheet.task}
          sessionLengthMinutes={0}
          focused={sheetFocused}
          onShowSessions={showTaskSessions}
          onClose={() => setTaskSheet(null)}
          onLoadTimer={loadTaskIntoTimer}
          onToggleComplete={toggleTaskComplete}
        />
      )}
      <SessionsSheet target={sessionsTarget} onClose={() => setSessionsTarget(null)} />
    </SafeAreaView>
  );
}
