import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, TextInput,
  Platform, StyleSheet, KeyboardAvoidingView, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { Task, TaskGoal } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import TaskPicker, { SelectedTaskList } from '../TaskMultiSelect';
import { parseLocalDate, pickerAcceptsValue, pickerMinimumDate } from '../../utils/date';
import { parsePlannedHours, plannedHoursText } from '../../lib/timeAnalytics';
import { getStyles } from '../formStyles';

/**
 * Create or edit a goal: title, tag, deadline, planned time and linked tasks.
 * Moved out of the Today route so the goal editor (components/goals/GoalEditor)
 * can mount it on both Today and the Time tab.
 */
export type GoalSaveData = {
  title: string; tag?: string | null; deadline?: string | null;
  /** Minutes, or null to clear the plan. */
  plannedMinutes: number | null;
  taskIds: string[];
};

export default function GoalFormModal({ visible, goal, existingTags, linkableTasks, goals, onSave, onClose, onDelete }: {
  visible: boolean; goal: TaskGoal | null; existingTags: string[];
  /** Unarchived tasks, completed ones included — see TaskMultiSelect. */
  linkableTasks: Task[];
  /** Every goal, so the picker can name the one a task moves away from. */
  goals: TaskGoal[];
  onSave: (data: GoalSaveData) => void;
  onClose: () => void;
  /** Only passed when editing — creates have nothing to delete. */
  onDelete?: () => void;
}) {
  const Colors = useTheme();
  const { ROSE } = Colors;
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [deadline, setDeadline] = useState('');
  /** Hours as typed; parsed on save so "1." mid-typing is not an error yet. */
  const [plannedText, setPlannedText] = useState('');
  const [plannedError, setPlannedError] = useState(false);
  /**
   * null means "the user has not touched the list yet", so the checkboxes
   * mirror what is actually linked right now. Once they touch it, their draft
   * wins. Seeding this from an effect instead would either need `linkableTasks`
   * as a dependency — wiping the selection under them whenever a background
   * fetch lands — or would have to ignore it. Deriving has neither problem.
   */
  const [draftTaskIds, setDraftTaskIds] = useState<string[] | null>(null);
  // See the task form above: the floor is captured on open and held, because the
  // native picker writes a new date before it relaxes an old floor.
  const [datePickerFloor, setDatePickerFloor] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState(false);
  // useWindowDimensions, not Dimensions.get(): the latter is read once and goes
  // stale on rotation, which is when a too-tall modal hurts most.
  const { height: windowHeight } = useWindowDimensions();
  // A category the user invents here does not exist anywhere yet — categories
  // are derived from the tags already in use, so a brand new one has to live in
  // local state until this goal is saved and starts using it.
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(goal?.title ?? ''); setTag(goal?.tag ?? null);
      setDeadline(goal?.deadline?.substring(0, 10) ?? '');
      setPlannedText(plannedHoursText(goal?.plannedMinutes ?? null));
      setPlannedError(false);
      setDraftTaskIds(null);
      setNewCategory(null);
      setTasksOpen(false);
      setTitleError(false);
      // This form previously reset nothing about the picker, so a calendar left
      // open on one goal was still mounted when the next goal's deadline was
      // seeded into it — the transition that crashes.
      setDatePickerFloor(null);
    }
  }, [visible, goal]);

  // What is linked to this goal right now, straight from the task list.
  const linkedNow = useMemo(
    () => (goal ? linkableTasks.filter((t) => t.taskGoalId === goal.id).map((t) => t.id) : []),
    [goal, linkableTasks],
  );
  const taskIds = draftTaskIds ?? linkedNow;
  const byId = useMemo(() => new Map(linkableTasks.map((t) => [t.id, t])), [linkableTasks]);
  // Ordered by SELECTION, not by the task list, so a task you just picked lands
  // at the bottom of the checklist where you are looking.
  const selectedTasks = useMemo(
    () => taskIds.map((id) => byId.get(id)).filter((t): t is Task => !!t),
    [taskIds, byId],
  );
  const availableTasks = useMemo(
    () => linkableTasks.filter((t) => !taskIds.includes(t.id)),
    [linkableTasks, taskIds],
  );

  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    const plannedMinutes = parsePlannedHours(plannedText);
    if (plannedMinutes === undefined) { setPlannedError(true); return; }
    // Send the calendar day as-is. This used to convert to an instant via
    // `new Date(deadline + 'T00:00:00').toISOString()`, which baked in the
    // creating device's timezone — the same goal then read as a different day
    // elsewhere. The server column is a plain date now.
    onSave({
      title: title.trim(),
      tag: tag || null,
      deadline: deadline || null,
      plannedMinutes,
      taskIds,
    });
  };
  const toggleTask = (id: string) =>
    setDraftTaskIds((prev) => {
      const base = prev ?? linkedNow;
      return base.includes(id) ? base.filter((t) => t !== id) : [...base, id];
    });
  const datePickerValue = useMemo(
    () => (deadline ? parseLocalDate(deadline) : new Date()),
    [deadline],
  );
  const openDatePicker = () => setDatePickerFloor(pickerMinimumDate(datePickerValue));
  const datePickerOpen = datePickerFloor !== null
    && pickerAcceptsValue(datePickerFloor, datePickerValue);
  /**
   * Close on selection, on EVERY platform.
   *
   * Android already dismissed itself; iOS's inline calendar stayed mounted, so
   * a 350px picker sat between the fields and the bottom of the sheet with no
   * way to put it away. Unmounting is also the safe move rather than a risky
   * one: the picker crashes when a new value is written against a stale
   * minimumDate, and the fix recorded for that is to unmount rather than hand
   * it a value beneath its floor. `dismissed` is Android's cancel event, where
   * no date comes back and the deadline must not change.
   */
  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    setDatePickerFloor(null);
    if (event.type === 'dismissed' || !date) return;
    setDeadline(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'center' }} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={1} style={{ marginHorizontal: 20 }}>
          {/* maxHeight is load-bearing, not polish. The card is vertically
              CENTERED, and its ScrollView sizes to its content — so without a
              ceiling the card grows past the viewport and overflows off BOTH
              ends, carrying this header (Cancel and Save) off the top of the
              screen. Opening the inline date picker adds ~350px and does
              exactly that. The same bug was found once before in this file's
              BottomSheet: always pair a scrolling child with a height bound. */}
          <View style={{ backgroundColor: Colors.surface, borderRadius: 20, overflow: 'hidden', maxHeight: windowHeight * 0.82 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.border }}>
              <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={{ color: Colors.subtext, fontSize: 15, fontWeight: '500' }}>Cancel</Text></TouchableOpacity>
              <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>{goal ? 'Edit Goal' : 'New Goal'}</Text>
              <TouchableOpacity onPress={handleSave} hitSlop={10}><Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '700' }}>Save</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
              <TextInput style={[styles.input, { fontSize: 16, fontWeight: '600', color: Colors.textBright }, titleError && { borderColor: ROSE }]} placeholder="e.g. Complete Calculus unit" placeholderTextColor={Colors.subtext} value={title} onChangeText={(t) => { setTitle(t); if (titleError) setTitleError(false); }} autoFocus={!goal} maxLength={80} />
              {titleError && <Text style={{ color: ROSE, fontSize: 11, marginTop: -8, marginBottom: 12 }}>Goal title can't be empty</Text>}
              <Text style={styles.fieldLabel}>Category</Text>
              {/* Categories used to be a closed set: whatever tags already
                  existed, and nothing else. Creating one meant going and
                  tagging a TASK first, then coming back. The chip row now ends
                  in "+ New", and a category the user types is shown selected
                  immediately even though nothing uses it yet. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: newCategory !== null ? 8 : 16 }} keyboardShouldPersistTaps="handled">
                {['None', ...existingTags, ...(tag && !existingTags.includes(tag) ? [tag] : [])].map((t) => { const sel = t === 'None' ? !tag : tag === t; return (
                  <TouchableOpacity key={t} onPress={() => { setTag(t === 'None' ? null : t); setNewCategory(null); }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8, backgroundColor: sel ? Colors.primary : Colors.raised, borderWidth: 1, borderColor: sel ? Colors.primary : Colors.border }}>
                    <Text style={{ color: sel ? '#fff' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>{t}</Text>
                  </TouchableOpacity>
                ); })}
                <TouchableOpacity
                  onPress={() => setNewCategory((v) => (v === null ? '' : null))}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8, backgroundColor: Colors.raised, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border }}
                  accessibilityRole="button"
                  accessibilityLabel="Create a new category"
                >
                  <Ionicons name="add" size={13} color={Colors.primarySoft} style={{ marginRight: 3 }} />
                  <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600' }}>New</Text>
                </TouchableOpacity>
              </ScrollView>
              {newCategory !== null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0, fontSize: 14 }]}
                    placeholder="Category name"
                    placeholderTextColor={Colors.subtext}
                    value={newCategory}
                    onChangeText={setNewCategory}
                    autoFocus
                    maxLength={30}
                    returnKeyType="done"
                    onSubmitEditing={() => { const v = newCategory.trim(); if (v) setTag(v); setNewCategory(null); }}
                  />
                  <TouchableOpacity
                    onPress={() => { const v = newCategory.trim(); if (v) setTag(v); setNewCategory(null); }}
                    disabled={!newCategory.trim()}
                    style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: Colors.primary, opacity: newCategory.trim() ? 1 : 0.4 }}
                    accessibilityRole="button"
                    accessibilityLabel="Add category"
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Add</Text>
                  </TouchableOpacity>
                </View>
              )}
              {/* The session stepper used to sit here, above the deadline, and
                  it is why nobody could find the deadline. A goal is measured on
                  its tasks now, so the two things it asks for are WHEN and
                  WHICH — in that order. */}
              <Text style={styles.fieldLabel}>Due date</Text>
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

              {/* Planned focus time. Optional, and never part of whether the
                  goal is done (that stays task-based): it only adds planned vs
                  done and pace to the time screen. Hours, decimals allowed. */}
              <Text style={styles.fieldLabel}>Planned focus time</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: plannedError ? 4 : 16, gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0, fontSize: 14 }, plannedError && { borderColor: ROSE }]}
                  placeholder="e.g. 20"
                  placeholderTextColor={Colors.subtext}
                  value={plannedText}
                  onChangeText={(t) => { setPlannedText(t); if (plannedError) setPlannedError(false); }}
                  keyboardType="decimal-pad"
                  maxLength={7}
                  accessibilityLabel="Planned focus time in hours"
                />
                <Text style={{ color: Colors.subtext, fontSize: 14, fontWeight: '600' }}>hours</Text>
              </View>
              {plannedError && <Text style={{ color: ROSE, fontSize: 11, marginBottom: 12 }}>Enter hours between 1 minute and 1,666 hours, or leave it empty</Text>}

              {/* What the goal is actually measured on. Previously reachable
                  only from the other side — open a task, pick its goal — so
                  linking twelve tasks meant opening twelve tasks. */}
              <Text style={styles.fieldLabel}>
                Tasks{selectedTasks.length > 0 ? ` · ${selectedTasks.length}` : ''}
              </Text>
              {/* A dropdown to ADD, a checklist below of what is ON. One
                  always-open list of every task, with the chosen ones checked
                  somewhere inside it, buried the answer to "what is on this
                  goal" among fifty rows — and nested a scroll view inside the
                  form's own scroll view for the whole life of the sheet. */}
              <TouchableOpacity
                onPress={() => setTasksOpen((v) => !v)}
                style={[styles.input, { flexDirection: 'row', alignItems: 'center', marginBottom: tasksOpen ? 0 : 12 }]}
                accessibilityRole="button"
                accessibilityState={{ expanded: tasksOpen }}
                accessibilityLabel={tasksOpen ? 'Close the task list' : `Add tasks, ${availableTasks.length} available`}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.subtext} style={{ marginRight: 8 }} />
                <Text style={{ color: Colors.subtext, fontSize: 14, flex: 1 }}>
                  {tasksOpen ? 'Done adding' : `Add tasks${availableTasks.length > 0 ? ` (${availableTasks.length})` : ''}`}
                </Text>
                <Ionicons name={tasksOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.subtext} />
              </TouchableOpacity>
              {tasksOpen && (
                <View style={{ borderWidth: 1, borderColor: Colors.border, borderTopWidth: 0, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, marginBottom: 12, overflow: 'hidden' }}>
                  <TaskPicker
                    tasks={availableTasks}
                    goals={goals}
                    goalId={goal?.id ?? null}
                    onPick={toggleTask}
                  />
                </View>
              )}
              <SelectedTaskList tasks={selectedTasks} onRemove={toggleTask} />

              {/* Editing only. Goals previously had no delete affordance anywhere
                  in the app — they could be created but never removed. */}
              {goal && onDelete && (
                <TouchableOpacity
                  onPress={onDelete}
                  // 24, not 8. The task checklist directly above ends in a row
                  // of small circle-X buttons that remove ONE task; this button
                  // deletes the whole goal. Two removal gestures at very
                  // different scales should not be a thumb-width apart.
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, marginTop: 24, borderRadius: 12, borderWidth: 1, borderColor: ROSE }}
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
