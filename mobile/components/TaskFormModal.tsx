import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Platform, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Task, TaskGoal, DayOfWeek, DAY_LABELS as DOW_LABELS, DAY_FULL_LABELS } from '../types';
import { useTheme, useIsDark } from '../hooks/useTheme';
import { getSessionPlan } from '../lib/sessionPlan';
import {
  buildSaveData, initialFields, type FormSaveData, type Priority, type TaskFormPrefill,
} from '../lib/taskForm';
import FormSheet from './FormSheet';
import { MONO } from './SheetPrimitives';
import { priorityColor } from '../utils/priority';
import { parseLocalDate, pickerAcceptsValue, pickerMinimumDate } from '../utils/date';

/**
 * The task create/edit sheet, shared by Today and the calendar.
 *
 * Open it through `useTaskForm` (hooks/useTaskForm.ts), which owns which task
 * is being edited, the save path with its retry, and delete. What a save sends
 * is decided by lib/taskForm.ts and tested there.
 */

export type { FormSaveData, TaskFormPrefill };

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;
const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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

export default function TaskFormModal({
  visible, task, prefill, note, existingTags, sessionLengthMinutes, goals, onSave, onClose, onDelete,
}: {
  visible: boolean; task: Task | null;
  /** Starting values for empty fields (Find a slot). */
  prefill?: TaskFormPrefill;
  /** One quiet line under the title, e.g. why a day was suggested. */
  note?: string;
  existingTags: string[]; sessionLengthMinutes: number;
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
  const [priority, setPriority] = useState<Priority>('medium');
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

  useEffect(() => {
    if (visible) {
      // initialFields trims the ISO due date to 'YYYY-MM-DD' (everything here,
      // parseLocalDate and the picker included, expects that) and applies the
      // prefill only to empty fields. The prefill must be read here, in the
      // same reset, or this effect would wipe it.
      const f = initialFields(task, prefill);
      setTitle(f.title); setDescription(f.description);
      setDueDate(f.dueDate); setTags(f.tags);
      setEstimatedMinutes(f.estimatedMinutes); setPriority(f.priority);
      setTaskGoalId(f.taskGoalId); setTagInput(''); setTagEditorOpen(false); setTitleError(false);
      setIsRecurring(f.isRecurring);
      setRecurringDays(f.recurringDays);
      setStartMinutes(f.startMinutes);
      setEndMinutes(f.endMinutes);
      setShowTimePicker(null);
      // Closed alongside the time picker, and for a stronger reason than tidiness:
      // re-seeding moves dueDate underneath a picker that may still be mounted,
      // which is the exact prop transition the native component mishandles.
      setDatePickerFloor(null);
    }
  }, [visible, task, prefill]);

  const allTagChips = useMemo(() => Array.from(new Set([...existingTags, ...tags])), [existingTags, tags]);
  const toggleTag = (tag: string) => setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const addCustomTag = () => { const t = tagInput.trim(); if (t && !tags.includes(t)) setTags((prev) => [...prev, t]); setTagInput(''); };

  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    // The backend rejects these too; catching it here keeps the sheet open
    // with the offending field in view instead of failing after it closes.
    if (timeError) return;
    onSave(buildSaveData(task, {
      title, description, dueDate, tags, estimatedMinutes, startMinutes, endMinutes,
      priority, taskGoalId, isRecurring, recurringDays,
    }));
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
  // Closes on selection, on EVERY platform. Android already dismissed itself;
  // iOS's inline calendar stayed mounted, leaving a 350px picker wedged in the
  // sheet with no way to put it away. Unmounting is also the safe move: the
  // picker crashes when a new value is written against a stale minimumDate, and
  // the recorded fix is to unmount rather than hand it a value beneath its
  // floor. `dismissed` is Android's cancel, where no date comes back.
  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    setDatePickerFloor(null);
    if (event.type === 'dismissed' || !date) return;
    setDueDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
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
      {note && <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: -8, marginBottom: 18 }}>{note}</Text>}

      {/* priority */}
      <Text style={monoLabel}>PRIORITY</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
        {PRIORITIES.map(({ value, label }) => { const sel = priority === value; const color = priorityColor(value); return (
          <TouchableOpacity key={value} onPress={() => setPriority(value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: sel ? color + '22' : Colors.raised, borderWidth: 1, borderColor: sel ? color : 'transparent' }}>
            <Text style={{ color, fontSize: 12, fontWeight: sel ? '700' : '600' }}>{label}</Text>
          </TouchableOpacity>
        ); })}
      </View>

      {/* due date + category */}
      <View style={{ flexDirection: 'row', gap: 20, marginBottom: 18 }}>
        <View style={{ flex: 1 }}>
          {/* The same field means two things, so it says which. On a one-off task
              it is the day the task is due. On a repeating one it is the last
              day the habit fires — which the app now actually honours. It was
              always collectable here and read by nothing at all. */}
          <Text style={monoLabel}>{isRecurring ? 'REPEAT UNTIL' : 'DUE DATE'}</Text>
          {dueDate ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity onPress={openDatePicker} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primaryDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
                <Ionicons name="calendar-outline" size={14} color={Colors.primarySoft} />
                <Text style={{ color: Colors.primarySoft, fontSize: 12.5, fontWeight: '600' }}>{parseLocalDate(dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
              </TouchableOpacity>
              {/* A time cannot outlive its day — the server rejects that pair. */}
              <TouchableOpacity onPress={() => { setDueDate(''); clearSchedule(); setDatePickerFloor(null); }}><Ionicons name="close-circle" size={16} color={Colors.subtext} /></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={openDatePicker} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: Colors.raised, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
              <Ionicons name="calendar-outline" size={14} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 12.5, fontWeight: '600' }}>
                {isRecurring ? 'No end date' : 'Set date'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={monoLabel}>CATEGORY</Text>
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

      {/* The calendar and the category editor belong DIRECTLY under the
          row that opens them. Both used to render after the TIME block,
          so tapping "Set date" or "+ Add" pushed a panel out below the
          hour selector — nowhere near the control that summoned it, and
          often off the bottom of the sheet entirely. Due date is the left
          column and subject the right, so the two reveals stack here in
          reading order. */}
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

      {/* Recurring sits last, above the description. It is the one field that
          changes what the task IS rather than describing it, and every
          answer above stays true either way — so it reads as the closing
          question, not a fork you hit three fields in. Turning it on also
          reveals a seven-day selector, which used to shove everything
          below it down the sheet mid-form. */}
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

      {/* description */}
      <Text style={monoLabel}>DESCRIPTION</Text>
      <TextInput style={{ backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 13, minHeight: 56, color: Colors.textBright, fontSize: 13, textAlignVertical: 'top', marginBottom: 20 }} placeholder="What is this task about?" placeholderTextColor={Colors.subtext} value={description} onChangeText={setDescription} multiline />

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
