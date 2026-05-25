import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, TextInput,
  Alert, Platform, Dimensions, PanResponder, Animated,
  StyleSheet, TouchableWithoutFeedback, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Swipeable } from 'react-native-gesture-handler';
import { Task } from '../../types';
import { Colors } from '../../constants/Colors';
import { useTasksList, useSelectedTaskId, useTaskActions, useSettings } from '../../store/hooks';
import { useFocusEffect } from 'expo-router';
import { getSessionHistory, mergeWithServerSessions, type SessionRecord } from '../../store/sync';
import { api } from '../../services/api';
import { tagColor } from '../../utils/tag';
import { priorityColor, priorityLabel } from '../../utils/priority';
import { calcDaysWorked, calcDaysUntilDue } from '../../store/selectors/tasks';

// ─── Design tokens ────────────────────────────────────────────────────
const ROSE = '#F06292';
const ROSE_DIM = '#3A0F20';

const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
const SCREEN_H = Dimensions.get('window').height;

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────

function formatFocusTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDueChip(task: Task): { label: string; bg: string; fg: string } | null {
  if (!task.dueDate) return null;
  if (task.isCompleted) return { label: '✓ Done', bg: Colors.tealDim, fg: Colors.accent };
  const daysLeft = calcDaysUntilDue(task);
  if (daysLeft === null) return null;
  const dayName = new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  if (daysLeft < 0) return { label: '⚠ Overdue', bg: ROSE_DIM, fg: ROSE };
  if (daysLeft <= 3) return { label: `⚠ ${dayName}`, bg: ROSE_DIM, fg: ROSE };
  return { label: `Due ${dayName}`, bg: Colors.inactive, fg: Colors.subtext };
}

function relativeDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── BottomSheet wrapper ──────────────────────────────────────────────

function BottomSheet({
  visible, onClose, children, sheetHeight,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  sheetHeight: number;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) onCloseRef.current();
      },
    }),
  ).current;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
        </TouchableWithoutFeedback>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View
            style={{
              backgroundColor: Colors.surface,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              minHeight: sheetHeight,
            }}
          >
            {/* Drag handle */}
            <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
            </View>
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── TaskStatsModal ───────────────────────────────────────────────────

function TaskStatsModal({
  task, sessionHistory, sessionLengthMinutes, onClose, onLoadTimer, onToggleComplete,
}: {
  task: Task | null;
  sessionHistory: SessionRecord[];
  sessionLengthMinutes: number;
  onClose: () => void;
  onLoadTimer: (taskId: string) => void;
  onToggleComplete: (taskId: string) => void;
}) {
  const taskSessions = useMemo(
    () => (task ? sessionHistory.filter((s) => s.taskId === task.id && s.type === 'focus') : []),
    [task, sessionHistory],
  );

  const totalFocusSeconds = useMemo(
    () => taskSessions.reduce((sum, s) => sum + s.durationSeconds, 0),
    [taskSessions],
  );

  const sessionsToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return taskSessions.filter((s) => s.completedAt >= start.getTime()).length;
  }, [taskSessions]);

  const sessionsThisWeek = useMemo(() => {
    const mon = getMonday(new Date());
    return taskSessions.filter((s) => new Date(s.completedAt) >= mon).length;
  }, [taskSessions]);

  const lastWorked = useMemo(() => {
    if (taskSessions.length === 0) return null;
    const sorted = [...taskSessions].sort((a, b) => b.completedAt - a.completedAt);
    return relativeDate(sorted[0].completedAt);
  }, [taskSessions]);

  if (!task) return null;

  const isPendingOrActive = !task.isCompleted;
  const subjectTag = task.tags.length > 0 ? task.tags[0] : null;

  // estimatedMinutes-based progress (no targetSessions in model)
  const progressFrac = task.estimatedMinutes
    ? Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60))
    : null;

  return (
    <BottomSheet visible onClose={onClose} sheetHeight={SCREEN_H * 0.52}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: Colors.textBright, fontSize: 17, fontWeight: '700', flex: 1, marginRight: 12 }} numberOfLines={2}>
            {task.title}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={Colors.subtext} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {subjectTag && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: tagColor(subjectTag) + '25' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: tagColor(subjectTag) }}>{subjectTag}</Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: priorityColor(task.priority ?? 'medium') + '25' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: priorityColor(task.priority ?? 'medium') }}>
              {priorityLabel(task.priority ?? 'medium')}
            </Text>
          </View>
        </View>
      </View>

      {/* Divider */}
      <View style={{ height: 0.5, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 16 }} />

      {/* Stats body */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>

        {/* Sessions summary */}
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 }}>
            <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '700' }}>
              {task.sessionsOnTask}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 13, fontWeight: '500', marginLeft: 6 }}>
              sessions completed
            </Text>
          </View>
          {/* NOTE: targetSessions does not exist in the task model — session dots skipped */}
        </View>

        {/* Focus breakdown */}
        <View style={{
          backgroundColor: Colors.raised, borderRadius: 16, padding: 14,
          borderWidth: 0.5, borderColor: Colors.border, marginBottom: 16,
          gap: 10,
        }}>
          <StatRow label="Total focus time" value={formatSeconds(totalFocusSeconds)} />
          <StatRow label="Avg session length" value={`${sessionLengthMinutes}m`} />
          {sessionsToday > 0 && <StatRow label="Sessions today" value={String(sessionsToday)} />}
          {sessionsThisWeek > 0 && <StatRow label="This week" value={`${sessionsThisWeek} sessions`} />}
          {lastWorked && <StatRow label="Last worked" value={lastWorked} />}
          {task.sessionDates.length > 0 && <StatRow label="Days worked" value={String(new Set(task.sessionDates).size)} />}
        </View>

        {/* Time-based progress (only if estimatedMinutes set; targetSessions not in model) */}
        {progressFrac !== null && (
          <View style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '600' }}>
                Time progress
              </Text>
              {task.isCompleted ? (
                <Text style={{ color: Colors.accent, fontSize: 12, fontWeight: '700' }}>✓ Complete</Text>
              ) : (
                <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '700' }}>
                  {Math.round(progressFrac * 100)}% complete
                </Text>
              )}
            </View>
            <View style={{ height: 8, backgroundColor: Colors.inactive, borderRadius: 4, overflow: 'hidden' }}>
              <View style={{
                width: `${Math.round(progressFrac * 100)}%`,
                height: '100%', borderRadius: 4,
                backgroundColor: task.isCompleted ? Colors.accent : Colors.primary,
              }} />
            </View>
            <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 4 }}>
              {formatSeconds(task.totalTimeOnTask)} of {task.estimatedMinutes}m estimated
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Footer action */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 28, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: Colors.border }}>
        {isPendingOrActive ? (
          <TouchableOpacity
            style={{
              backgroundColor: Colors.primary, borderRadius: 14,
              paddingVertical: 14, alignItems: 'center',
            }}
            onPress={() => { onLoadTimer(task.id); onClose(); }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Load into Timer</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={{
              borderRadius: 14, paddingVertical: 13, alignItems: 'center',
              borderWidth: 1.5, borderColor: Colors.border,
            }}
            onPress={() => { onToggleComplete(task.id); onClose(); }}
          >
            <Text style={{ color: Colors.subtext, fontSize: 15, fontWeight: '600' }}>Mark Incomplete</Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '500' }}>{label}</Text>
      <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

// ─── TaskFormModal (centered modal, add + edit) ───────────────────────

type FormSaveData = {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
};

function TaskFormModal({
  visible, task, existingTags, sessionLengthMinutes, onSave, onClose, onDelete,
}: {
  visible: boolean;
  task: Task | null;
  existingTags: string[];
  sessionLengthMinutes: number;
  onSave: (data: FormSaveData) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [estimatedMinutes, setEstimatedMinutes] = useState(0);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [tagInput, setTagInput] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [titleError, setTitleError] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitle(task?.title ?? '');
      setDescription(task?.description ?? '');
      setDueDate(task?.dueDate ?? '');
      setTags(task?.tags ?? []);
      setEstimatedMinutes(task?.estimatedMinutes ?? 0);
      setPriority(task?.priority ?? 'medium');
      setTagInput('');
      setTitleError(false);
    }
  }, [visible, task]);

  const allTagChips = useMemo(
    () => Array.from(new Set([...existingTags, ...tags])),
    [existingTags, tags],
  );

  const toggleTag = (tag: string) => {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const addCustomTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput('');
  };

  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    setTitleError(false);

    if (task) {
      // Edit mode: only send changed fields
      const update: FormSaveData = { title: title.trim() };
      const newDesc = description.trim() || null;
      if (newDesc !== (task.description ?? null)) update.description = newDesc;
      const newDue = dueDate || null;
      if (newDue !== (task.dueDate ?? null)) update.dueDate = newDue;
      const tagsChanged = JSON.stringify([...tags].sort()) !== JSON.stringify([...(task.tags ?? [])].sort());
      if (tagsChanged) update.tags = tags;
      const newEst = estimatedMinutes > 0 ? estimatedMinutes : null;
      if (newEst !== (task.estimatedMinutes ?? null)) update.estimatedMinutes = newEst;
      if (priority !== task.priority) update.priority = priority;
      onSave(update);
    } else {
      onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        tags,
        estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined,
        priority,
      });
    }
  };

  const datePickerValue = dueDate ? new Date(dueDate + 'T00:00:00') : new Date();

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) {
      setDueDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
    }
  };

  const estimatedLabel = estimatedMinutes > 0 ? `≈ ${formatFocusTime(estimatedMinutes)}` : null;

  // NOTE: task.targetSessions does not exist in the model — planned sessions field skipped
  // NOTE: task.notes does not exist in the model — using task.description as Notes field

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      {/* Full-screen backdrop — absolute so it doesn't affect KAV layout */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
      />
      {/* KAV centers the card and shifts it above the keyboard */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'center' }}
        pointerEvents="box-none"
      >
          {/* Inner card — absorbs touches so they don't reach the backdrop */}
          <TouchableOpacity activeOpacity={1} style={{ marginHorizontal: 20 }}>
            <View style={{
              backgroundColor: Colors.surface,
              borderRadius: 20,
              height: SCREEN_H * 0.82,
              overflow: 'hidden',
            }}>
              {/* Header */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
                borderBottomWidth: 0.5, borderBottomColor: Colors.border,
              }}>
                <TouchableOpacity onPress={onClose}>
                  <Text style={{ color: Colors.subtext, fontSize: 15, fontWeight: '500' }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>
                  {task ? 'Edit Task' : 'New Task'}
                </Text>
                <TouchableOpacity onPress={handleSave}>
                  <Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '700' }}>Save</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* Task name */}
                <TextInput
                  style={[
                    styles.input,
                    { fontSize: 16, fontWeight: '600', color: Colors.textBright },
                    titleError && { borderColor: ROSE, borderWidth: 1.5 },
                  ]}
                  placeholder="What are you working on?"
                  placeholderTextColor={Colors.subtext}
                  value={title}
                  onChangeText={(t) => { setTitle(t); if (titleError) setTitleError(false); }}
                  autoFocus
                  maxLength={100}
                  returnKeyType="next"
                />
                {titleError && (
                  <Text style={{ color: ROSE, fontSize: 11, marginTop: -8, marginBottom: 12 }}>
                    Task name can't be empty
                  </Text>
                )}

                {/* Priority */}
                <Text style={styles.fieldLabel}>Priority</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {PRIORITIES.map(({ value, label }) => {
                    const selected = priority === value;
                    const color = priorityColor(value);
                    return (
                      <TouchableOpacity
                        key={value}
                        onPress={() => setPriority(value)}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                          backgroundColor: selected ? color + '25' : Colors.raised,
                          borderWidth: 1.5,
                          borderColor: selected ? color : Colors.border,
                        }}
                      >
                        <Text style={{ color: selected ? color : Colors.subtext, fontSize: 11, fontWeight: '700' }}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Subject / tags — chip row */}
                <Text style={styles.fieldLabel}>Subject / Tags</Text>
                {allTagChips.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                    {allTagChips.map((tag) => {
                      const selected = tags.includes(tag);
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => toggleTag(tag)}
                          style={{
                            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8,
                            backgroundColor: selected ? Colors.primary : Colors.raised,
                            borderWidth: 1,
                            borderColor: selected ? Colors.primary : Colors.border,
                          }}
                        >
                          <Text style={{ color: selected ? '#FFFFFF' : Colors.subtext, fontSize: 12, fontWeight: '600' }}>
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Add tag…"
                    placeholderTextColor={Colors.subtext}
                    value={tagInput}
                    onChangeText={(t) => {
                      if (t.endsWith(',') || t.endsWith('\n')) addCustomTag();
                      else setTagInput(t);
                    }}
                    onSubmitEditing={addCustomTag}
                    blurOnSubmit={false}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={{
                      width: 36, height: 44, borderRadius: 10,
                      backgroundColor: Colors.raised, alignItems: 'center', justifyContent: 'center',
                    }}
                    onPress={addCustomTag}
                  >
                    <Ionicons name="add" size={18} color={Colors.primarySoft} />
                  </TouchableOpacity>
                </View>

                {/* Estimated focus time (stepper) */}
                <Text style={styles.fieldLabel}>Estimated focus time</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <TouchableOpacity
                    style={[styles.stepper, { opacity: estimatedMinutes <= 0 ? 0.3 : 1 }]}
                    disabled={estimatedMinutes <= 0}
                    onPress={() => setEstimatedMinutes(Math.max(0, estimatedMinutes - 5))}
                  >
                    <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>−</Text>
                  </TouchableOpacity>
                  <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', width: 88, textAlign: 'center' }}>
                    {estimatedMinutes > 0 ? `${estimatedMinutes} min` : 'not set'}
                  </Text>
                  <TouchableOpacity
                    style={[styles.stepper, { opacity: estimatedMinutes >= 480 ? 0.3 : 1 }]}
                    disabled={estimatedMinutes >= 480}
                    onPress={() => setEstimatedMinutes(Math.min(480, estimatedMinutes + 5))}
                  >
                    <Text style={{ color: Colors.primarySoft, fontSize: 20, fontWeight: '600' }}>+</Text>
                  </TouchableOpacity>
                  {estimatedLabel && (
                    <Text style={{ color: Colors.subtext, fontSize: 11, marginLeft: 12 }}>{estimatedLabel}</Text>
                  )}
                </View>
                <Text style={{ color: Colors.subtext, fontSize: 10, marginBottom: 16 }}>
                  Based on {sessionLengthMinutes}m session length
                </Text>

                {/* Due date */}
                <Text style={styles.fieldLabel}>Due date</Text>
                {dueDate ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
                      borderRadius: 20, backgroundColor: Colors.primaryDim, marginRight: 8,
                    }}>
                      <Ionicons name="calendar-outline" size={14} color={Colors.primarySoft} style={{ marginRight: 6 }} />
                      <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600' }}>
                        Due {new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setDueDate('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color={Colors.subtext} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.input, { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }]}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Ionicons name="calendar-outline" size={16} color={Colors.subtext} style={{ marginRight: 8 }} />
                    <Text style={{ color: Colors.subtext, fontSize: 14 }}>Set due date</Text>
                  </TouchableOpacity>
                )}

                {showDatePicker && (
                  <DateTimePicker
                    value={datePickerValue}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                  />
                )}

                {/* Notes (mapped to task.description) */}
                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput
                  style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                  placeholder="Any notes for this task…"
                  placeholderTextColor={Colors.subtext}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                />

                {/* Delete button (edit mode only) */}
                {task && onDelete && (
                  <TouchableOpacity
                    style={{
                      marginTop: 8, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                      backgroundColor: ROSE_DIM, borderWidth: 0.5, borderColor: ROSE + '40',
                    }}
                    onPress={onDelete}
                  >
                    <Text style={{ color: ROSE, fontWeight: '700', fontSize: 14 }}>Delete Task</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.raised, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: Colors.textBright, marginBottom: 16, fontSize: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  fieldLabel: {
    color: Colors.subtext, fontSize: 11, fontWeight: '600',
    marginBottom: 8, letterSpacing: 0.5,
  },
  stepper: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.raised, alignItems: 'center', justifyContent: 'center',
  },
});

// ─── TaskRow ──────────────────────────────────────────────────────────

function TaskRow({
  task, isActive, onTap, onEdit, onComplete,
}: {
  task: Task;
  isActive: boolean;
  onTap: () => void;
  onEdit: () => void;
  onComplete: () => void;
}) {
  const isCompleted = task.isCompleted;
  const barColor = isActive ? Colors.primary : isCompleted ? Colors.accent : Colors.subtext;
  const chip = getDueChip(task);
  const subjectTag = task.tags.length > 0 ? task.tags[0] : null;
  const progressFrac = task.estimatedMinutes
    ? Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60))
    : null;

  const swipeRef = useRef<Swipeable>(null);

  const handleSwipeOpen = useCallback((direction: 'left' | 'right') => {
    swipeRef.current?.close();
    if (direction === 'left') {
      // Swiped right → mark complete / undo
      onComplete();
    } else {
      // Swiped left → edit
      onEdit();
    }
  }, [onComplete, onEdit]);

  // Swipe right → shows teal/rose complete action (left side)
  const renderLeftActions = () => (
    <View style={{
      width: 72, marginRight: 6, marginBottom: 8, borderRadius: 14,
      backgroundColor: isCompleted ? ROSE_DIM : Colors.tealDim,
      justifyContent: 'center', alignItems: 'center',
    }}>
      <Ionicons
        name={isCompleted ? 'arrow-undo' : 'checkmark-circle'}
        size={22}
        color={isCompleted ? ROSE : Colors.accent}
      />
      <Text style={{ color: isCompleted ? ROSE : Colors.accent, fontSize: 9, fontWeight: '700', marginTop: 3 }}>
        {isCompleted ? 'Undo' : 'Done'}
      </Text>
    </View>
  );

  // Swipe left → shows edit action (right side)
  const renderRightActions = () => (
    <View style={{
      width: 72, marginLeft: 6, marginBottom: 8, borderRadius: 14,
      backgroundColor: Colors.primaryDim,
      justifyContent: 'center', alignItems: 'center',
    }}>
      <Ionicons name="pencil" size={20} color={Colors.primarySoft} />
      <Text style={{ color: Colors.primarySoft, fontSize: 9, fontWeight: '700', marginTop: 3 }}>Edit</Text>
    </View>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onTap}
        style={{
          flexDirection: 'row',
          backgroundColor: isActive ? Colors.raised : Colors.surface,
          borderRadius: 14,
          marginBottom: 8,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: isActive ? Colors.primary + '50' : Colors.border,
          opacity: isCompleted ? 0.5 : 1,
        }}
      >
        {/* Left accent bar */}
        <View style={{ width: 3, backgroundColor: barColor }} />

        {/* Content */}
        <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: progressFrac !== null ? 10 : 12 }}>
          {/* Row 1: checkbox + title + tag chip */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{
              width: 20, height: 20, borderRadius: 10, marginRight: 10,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: isCompleted ? Colors.accent : 'transparent',
              borderWidth: isCompleted ? 0 : 1.5,
              borderColor: isCompleted ? Colors.accent : isActive ? Colors.primary : Colors.subtext,
            }}>
              {isCompleted && <Ionicons name="checkmark" size={12} color={Colors.bg} />}
            </View>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: isCompleted ? Colors.subtext : Colors.textBright,
                fontSize: 14, fontWeight: '600',
                textDecorationLine: isCompleted ? 'line-through' : 'none',
              }}
            >
              {task.title}
            </Text>
            {subjectTag && (
              <View style={{
                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, marginLeft: 6,
                backgroundColor: tagColor(subjectTag) + '25',
              }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: tagColor(subjectTag) }}>
                  {subjectTag}
                </Text>
              </View>
            )}
          </View>

          {/* Row 2: session count + due chip */}
          {(task.sessionsOnTask > 0 || chip) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, gap: 8 }}>
              {task.sessionsOnTask > 0 && (
                <Text style={{
                  color: isActive ? Colors.primarySoft : Colors.subtext,
                  fontSize: 11, fontWeight: '500',
                }}>
                  {task.sessionsOnTask} session{task.sessionsOnTask !== 1 ? 's' : ''}
                </Text>
              )}
              {chip && (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: chip.bg }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: chip.fg }}>{chip.label}</Text>
                </View>
              )}
            </View>
          )}

          {/* Progress bar (time-based, only if estimatedMinutes set) */}
          {progressFrac !== null && (
            <View style={{ height: 3, backgroundColor: Colors.inactive, borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
              <View style={{
                width: `${Math.round(progressFrac * 100)}%`,
                height: '100%', borderRadius: 2,
                backgroundColor: isCompleted ? Colors.accent : Colors.primary,
              }} />
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────

function Toast({ message }: { message: string | null }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View style={{
      position: 'absolute', bottom: 96, alignSelf: 'center',
      backgroundColor: Colors.tealDim, paddingHorizontal: 16, paddingVertical: 9,
      borderRadius: 20, borderWidth: 0.5, borderColor: Colors.accent,
      opacity,
    }}>
      <Text style={{ color: Colors.accent, fontSize: 13, fontWeight: '700' }}>{message}</Text>
    </Animated.View>
  );
}

// ─── Analytics sub-components (unchanged) ────────────────────────────

function TodayPill({ value, label }: { value: string; label: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10,
      alignItems: 'center', borderWidth: 0.5, borderColor: Colors.border,
    }}>
      <Text style={{ color: Colors.primarySoft, fontSize: 18, fontWeight: '700', marginBottom: 3 }}>{value}</Text>
      <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, textAlign: 'center' }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function GroupHeader({ dotColor, label, count }: { dotColor: string; label: string; count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor, marginRight: 8 }} />
      <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700', flex: 1, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
      <View style={{ backgroundColor: dotColor + '25', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
        <Text style={{ color: dotColor, fontSize: 11, fontWeight: '700' }}>{count}</Text>
      </View>
    </View>
  );
}

function BarColumn({ dayLabel, sessions, maxSessions, isToday, isFuture }: {
  dayLabel: string; sessions: number; maxSessions: number; isToday: boolean; isFuture: boolean;
}) {
  const BAR_MAX_H = 60;
  const barHeight = isFuture ? 3 : Math.max(sessions > 0 ? (sessions / maxSessions) * BAR_MAX_H : 3, 3);
  const barColor = isToday ? Colors.accent : Colors.primary;
  const countLabel = isFuture ? '—' : isToday && sessions > 0 ? `${sessions}↗` : String(sessions);
  const labelColor = isToday ? Colors.accent : Colors.subtext;

  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 3 }}>
      <View style={{ height: BAR_MAX_H, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
        <View style={{
          width: '70%', height: barHeight, borderRadius: 3,
          backgroundColor: isFuture ? Colors.inactive : barColor,
          opacity: isFuture ? 0.15 : sessions === 0 && !isToday ? 0.25 : 1,
        }} />
      </View>
      <Text style={{ fontSize: 10, fontWeight: '700', marginTop: 5, color: labelColor }}>{countLabel}</Text>
      <Text style={{ fontSize: 10, fontWeight: '500', marginTop: 2, color: labelColor }}>{dayLabel}</Text>
    </View>
  );
}

function WeeklyCard({ value, label, delta, deltaLabel }: {
  value: string; label: string; delta: number | null; deltaLabel: string;
}) {
  const deltaColor = delta === null ? Colors.subtext : delta > 0 ? Colors.accent : delta < 0 ? ROSE : Colors.subtext;
  const deltaText = delta === null ? null
    : delta > 0 ? `↑${delta}${deltaLabel}`
    : delta < 0 ? `↓${Math.abs(delta)}${deltaLabel}`
    : null;

  return (
    <View style={{
      flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
      alignItems: 'center', borderWidth: 0.5, borderColor: Colors.border,
    }}>
      <Text style={{ color: Colors.textBright, fontSize: 20, fontWeight: '700', marginBottom: 3 }}>{value}</Text>
      <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 5 }}>
        {label.toUpperCase()}
      </Text>
      {deltaText && (
        <Text style={{ color: deltaColor, fontSize: 9, fontWeight: '700' }}>{deltaText}</Text>
      )}
    </View>
  );
}

function DaysWorkedGrid({ sessionsByDate }: { sessionsByDate: Map<string, number> }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const todayStr = getDateStr(today);
  const monthName = today.toLocaleString('en-US', { month: 'long' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const padding = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  let daysWithSessions = 0;
  let daysElapsed = 0;
  const cells: { day: number | null; dateStr: string | null }[] = [];
  for (let i = 0; i < padding; i++) cells.push({ day: null, dateStr: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr });
    if (dateStr <= todayStr) {
      daysElapsed++;
      if ((sessionsByDate.get(dateStr) ?? 0) > 0) daysWithSessions++;
    }
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, dateStr: null });

  const SCREEN_W = Dimensions.get('window').width;
  const CELL_SIZE = Math.floor((SCREEN_W - 40 - 12) / 7);

  const calRows: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) calRows.push(cells.slice(i, i + 7));

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 32 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ color: Colors.textBright, fontSize: 16, fontWeight: '700' }}>{monthName} {year}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '500' }}>{daysWithSessions} of {daysElapsed} days</Text>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <View key={i} style={{ width: CELL_SIZE, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, color: Colors.subtext, fontWeight: '600' }}>{d}</Text>
          </View>
        ))}
      </View>
      {calRows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', marginBottom: 2 }}>
          {row.map((cell, ci) => {
            if (!cell.day || !cell.dateStr) {
              return <View key={ci} style={{ width: CELL_SIZE, height: CELL_SIZE }} />;
            }
            const count = sessionsByDate.get(cell.dateStr) ?? 0;
            const isToday = cell.dateStr === todayStr;
            const isFuture = cell.dateStr > todayStr;
            const hasSession = !isFuture && count > 0;
            const isHeavy = hasSession && count >= 8;
            const bg = hasSession ? Colors.primary : Colors.inactive;
            const opacity = isToday ? 1 : isFuture ? 0.15 : hasSession ? (isHeavy ? 1 : 0.7) : 0.25;
            return (
              <View key={ci} style={{
                width: CELL_SIZE, height: CELL_SIZE, borderRadius: 6,
                backgroundColor: isToday ? 'transparent' : bg,
                opacity,
                borderWidth: isToday ? 2 : 0,
                borderColor: isToday ? Colors.primary : 'transparent',
                alignItems: 'center', justifyContent: 'center',
                shadowColor: isHeavy ? Colors.primary : 'transparent',
                shadowOpacity: isHeavy ? 0.55 : 0,
                shadowRadius: isHeavy ? 5 : 0,
                elevation: isHeavy ? 5 : 0,
              }}>
                {isToday && (
                  <Text style={{ fontSize: 8, fontWeight: '700', color: Colors.primary }}>{cell.day}</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── TasksScreen ──────────────────────────────────────────────────────

export default function TasksScreen() {
  const tasks = useTasksList();
  const selectedTaskId = useSelectedTaskId();
  const taskActions = useTaskActions();
  const settings = useSettings();
  const sessionLengthMinutes = Math.round(settings.workDuration / 60);

  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
  const [statsTask, setStatsTask] = useState<Task | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [formTask, setFormTask] = useState<Task | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(useCallback(() => {
    loadData();
  }, []));

  const loadData = async () => {
    try {
      const hist = await getSessionHistory();
      setSessionHistory(hist);
    } catch (err) {
      console.warn('[tasks] loadData failed:', err);
    }
    const res = await api.get<{ sessions: { id: string; completedAt: string; durationSeconds: number; taskId: string | null; taskLabel: string | null; clientSessionId: string | null }[] }>('/timer/sessions');
    if (res.success && res.data?.sessions) {
      await mergeWithServerSessions(res.data.sessions);
      const merged = await getSessionHistory();
      setSessionHistory(merged);
    }
  };

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── Date anchors ──
  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => getDateStr(now), [now]);
  const startOfToday = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);
  const monday = useMemo(() => getMonday(now), [now]);
  const lastMonday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() - 7); return d; }, [monday]);
  const nextMonday = useMemo(() => { const d = new Date(monday); d.setDate(d.getDate() + 7); return d; }, [monday]);

  // ── Today's sessions ──
  const todayFocusSessions = useMemo(
    () => sessionHistory.filter((s) => s.type === 'focus' && s.completedAt >= startOfToday.getTime()),
    [sessionHistory, startOfToday],
  );
  const todaySessionCount = todayFocusSessions.length;
  const todayFocusMinutes = useMemo(
    () => todayFocusSessions.reduce((sum, s) => sum + s.durationSeconds / 60, 0),
    [todayFocusSessions],
  );

  const tasksDoneToday = useMemo(
    () => tasks.filter((t) => t.isCompleted && t.completedAt && new Date(t.completedAt) >= startOfToday).length,
    [tasks, startOfToday],
  );
  const totalActiveTasks = useMemo(() => tasks.filter((t) => !t.isArchived).length, [tasks]);

  // ── Weekly data ──
  const thisWeekByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const s of sessionHistory) {
      if (s.type !== 'focus') continue;
      const d = new Date(s.completedAt);
      if (d >= monday && d < nextMonday) {
        const dow = d.getDay();
        counts[dow === 0 ? 6 : dow - 1]++;
      }
    }
    return counts;
  }, [sessionHistory, monday, nextMonday]);

  const lastWeekByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const s of sessionHistory) {
      if (s.type !== 'focus') continue;
      const d = new Date(s.completedAt);
      if (d >= lastMonday && d < monday) {
        const dow = d.getDay();
        counts[dow === 0 ? 6 : dow - 1]++;
      }
    }
    return counts;
  }, [sessionHistory, monday, lastMonday]);

  const weekTotalSessions = useMemo(() => thisWeekByDay.reduce((a, b) => a + b, 0), [thisWeekByDay]);
  const lastWeekTotalSessions = useMemo(() => lastWeekByDay.reduce((a, b) => a + b, 0), [lastWeekByDay]);

  const weekFocusMinutes = useMemo(
    () => sessionHistory
      .filter((s) => s.type === 'focus' && new Date(s.completedAt) >= monday && new Date(s.completedAt) < nextMonday)
      .reduce((sum, s) => sum + s.durationSeconds / 60, 0),
    [sessionHistory, monday, nextMonday],
  );

  const lastWeekFocusMinutes = useMemo(
    () => sessionHistory
      .filter((s) => s.type === 'focus' && new Date(s.completedAt) >= lastMonday && new Date(s.completedAt) < monday)
      .reduce((sum, s) => sum + s.durationSeconds / 60, 0),
    [sessionHistory, monday, lastMonday],
  );

  const daysWorkedThisWeek = useMemo(() => thisWeekByDay.filter((c) => c > 0).length, [thisWeekByDay]);
  const avgSessionsPerDay = daysWorkedThisWeek > 0
    ? (weekTotalSessions / daysWorkedThisWeek).toFixed(1)
    : '0.0';

  const maxDaySessions = useMemo(() => Math.max(...thisWeekByDay, 1), [thisWeekByDay]);

  const weekLabel = useMemo(() => {
    const end = new Date(monday); end.setDate(end.getDate() + 6);
    return `${formatShortDate(monday)}–${formatShortDate(end)}`;
  }, [monday]);

  const todayColIndex = useMemo(() => { const d = now.getDay(); return d === 0 ? 6 : d - 1; }, [now]);

  // ── Monthly calendar data ──
  const monthSessionsByDate = useMemo(() => {
    const map = new Map<string, number>();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    for (const s of sessionHistory) {
      if (s.type !== 'focus') continue;
      if (s.completedAt < firstOfMonth || s.completedAt >= firstOfNextMonth) continue;
      const key = getDateStr(new Date(s.completedAt));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [sessionHistory, now]);

  // ── Task groups ──
  const nonArchived = useMemo(() => tasks.filter((t) => !t.isArchived), [tasks]);
  const activeTask = useMemo(
    () => nonArchived.find((t) => t.id === selectedTaskId && !t.isCompleted) ?? null,
    [nonArchived, selectedTaskId],
  );
  const pendingTasks = useMemo(
    () => nonArchived.filter((t) => !t.isCompleted && t.id !== selectedTaskId),
    [nonArchived, selectedTaskId],
  );
  const doneTasks = useMemo(() => nonArchived.filter((t) => t.isCompleted), [nonArchived]);

  // ── Existing tags for form chips ──
  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) t.tags.forEach((tag) => set.add(tag));
    return Array.from(set);
  }, [tasks]);

  // ── Handlers ──
  const openCreate = useCallback(() => {
    setFormTask(null);
    setShowFormModal(true);
  }, []);

  const openEdit = useCallback((task: Task) => {
    setFormTask(task);
    setShowFormModal(true);
  }, []);

  const handleFormSave = useCallback(async (data: FormSaveData) => {
    setShowFormModal(false);
    if (formTask) {
      await taskActions.updateTask(formTask.id, data as any);
    } else {
      await taskActions.createTask(data as any);
    }
    setFormTask(null);
  }, [formTask, taskActions]);

  const handleDeleteById = useCallback((taskId: string) => {
    Alert.alert('Delete Task', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await taskActions.deleteTask(taskId);
          setShowFormModal(false);
          setFormTask(null);
        },
      },
    ]);
  }, [taskActions]);

  const handleDeleteFromModal = useCallback(() => {
    if (formTask) handleDeleteById(formTask.id);
  }, [formTask, handleDeleteById]);

  const handleComplete = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    await taskActions.toggleComplete(taskId);
    showToast(task.isCompleted ? 'Marked incomplete' : '✓ Marked complete');
  }, [tasks, taskActions, showToast]);

  // ── Render ──
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>Tasks</Text>
              <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '500', marginTop: 2 }}>Planning + Analytics</Text>
            </View>
            <TouchableOpacity
              onPress={openCreate}
              style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="add" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Today's Totals */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TodayPill value={`${tasksDoneToday}/${totalActiveTasks}`} label="Tasks done" />
            <TodayPill value={String(todaySessionCount)} label="Sessions" />
            <TodayPill value={formatFocusTime(todayFocusMinutes)} label="Focus time" />
          </View>
        </View>

        {/* Task List */}
        <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
          {nonArchived.length === 0 ? (
            <View style={{
              paddingVertical: 36, alignItems: 'center',
              backgroundColor: Colors.surface, borderRadius: 16,
              borderWidth: 0.5, borderColor: Colors.border,
            }}>
              <Ionicons name="checkbox-outline" size={32} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 10, textAlign: 'center' }}>
                No tasks yet — tap + to add one
              </Text>
            </View>
          ) : (
            <>
              {activeTask && (
                <View style={{ marginBottom: 16 }}>
                  <GroupHeader dotColor={Colors.primary} label="Active" count={1} />
                  <TaskRow
                    task={activeTask}
                    isActive
                    onTap={() => setStatsTask(activeTask)}
                    onEdit={() => openEdit(activeTask)}
                    onComplete={() => handleComplete(activeTask.id)}
                  />
                </View>
              )}

              {pendingTasks.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <GroupHeader dotColor={Colors.subtext} label="Pending" count={pendingTasks.length} />
                  {pendingTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isActive={false}
                      onTap={() => setStatsTask(task)}
                      onEdit={() => openEdit(task)}
                      onComplete={() => handleComplete(task.id)}
                    />
                  ))}
                </View>
              )}

              {doneTasks.length > 0 && (
                <View>
                  <GroupHeader dotColor={Colors.accent} label="Done" count={doneTasks.length} />
                  {doneTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isActive={false}
                      onTap={() => setStatsTask(task)}
                      onEdit={() => openEdit(task)}
                      onComplete={() => handleComplete(task.id)}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </View>

        {/* Weekly Graph */}
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700' }}>This Week</Text>
            <Text style={{ color: Colors.subtext, fontSize: 12, fontWeight: '500' }}>{weekLabel}</Text>
          </View>
          <View style={{
            backgroundColor: Colors.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 20,
            borderWidth: 0.5, borderColor: Colors.border,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              {DAY_LABELS.map((label, i) => (
                <BarColumn
                  key={i}
                  dayLabel={label}
                  sessions={thisWeekByDay[i]}
                  maxSessions={maxDaySessions}
                  isToday={i === todayColIndex}
                  isFuture={i > todayColIndex}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Weekly Totals */}
        <View style={{ paddingHorizontal: 20, marginBottom: 28 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <WeeklyCard
              value={String(weekTotalSessions)}
              label="Sessions"
              delta={weekTotalSessions - lastWeekTotalSessions}
              deltaLabel=" vs last wk"
            />
            <WeeklyCard
              value={`${Math.floor(weekFocusMinutes / 60)}h`}
              label="Focus time"
              delta={Math.round((weekFocusMinutes - lastWeekFocusMinutes) / 60)}
              deltaLabel="h vs last wk"
            />
            <WeeklyCard
              value={avgSessionsPerDay}
              label="Avg / day"
              delta={null}
              deltaLabel=""
            />
          </View>
        </View>

        {/* Days Worked Grid */}
        <DaysWorkedGrid sessionsByDate={monthSessionsByDate} />

      </ScrollView>

      {/* Stats modal */}
      {statsTask && (
        <TaskStatsModal
          task={statsTask}
          sessionHistory={sessionHistory}
          sessionLengthMinutes={sessionLengthMinutes}
          onClose={() => setStatsTask(null)}
          onLoadTimer={(id) => { taskActions.selectTask(id); setStatsTask(null); }}
          onToggleComplete={(id) => { handleComplete(id); setStatsTask(null); }}
        />
      )}

      {/* Form modal (add + edit) */}
      <TaskFormModal
        visible={showFormModal}
        task={formTask}
        existingTags={existingTags}
        sessionLengthMinutes={sessionLengthMinutes}
        onSave={handleFormSave}
        onClose={() => { setShowFormModal(false); setFormTask(null); }}
        onDelete={formTask ? handleDeleteFromModal : undefined}
      />

      {/* Toast */}
      <Toast message={toast} />

    </SafeAreaView>
  );
}
