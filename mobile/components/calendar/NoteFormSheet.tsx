import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import FormSheet from '../FormSheet';
import DayPickerRow from './DayPickerRow';
import type { Note } from '../../types';

/**
 * Create or edit a note or to-do on a chosen day.
 *
 * Day view already has a one-line inline composer, which is the right shape
 * there — you are looking at the day, so the day is implied. This sheet exists
 * for Planning, where the whole point is that you have not chosen a day yet, and
 * so the day has to be part of the form.
 */

export interface NoteDraft {
  content: string;
  date: string;
  isTodo: boolean;
}

export default function NoteFormSheet({
  visible,
  note,
  weekStart,
  defaultDate,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  /** null when creating. */
  note: Note | null;
  weekStart: Date;
  /** 'YYYY-MM-DD' the sheet opens on when creating. */
  defaultDate: string;
  onSave: (draft: NoteDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const Colors = useTheme();
  const label = {
    fontSize: 10, fontWeight: '700' as const, letterSpacing: 1,
    color: Colors.subtext, marginBottom: 9,
  };

  const [content, setContent] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [isTodo, setIsTodo] = useState(true);
  const [contentError, setContentError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setContent(note?.content ?? '');
    // A note reached from Planning always has a day: it was opened from one, or
    // it is being created onto one. The fallback covers an unscheduled note
    // opened from elsewhere.
    setDate(note?.date ?? defaultDate);
    setIsTodo(note?.isTodo ?? true);
    setContentError(false);
  }, [visible, note, defaultDate]);

  const handleSave = () => {
    const trimmed = content.trim();
    if (!trimmed) { setContentError(true); return; }
    onSave({ content: trimmed, date, isTodo });
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete note?', content.trim().slice(0, 80) || 'This note', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <FormSheet
      visible={visible}
      title={note ? 'Edit note' : 'New note'}
      onClose={onClose}
    >
      <TextInput
        style={[
          {
            backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1,
            borderColor: Colors.border, paddingHorizontal: 15, paddingVertical: 14,
            minHeight: 88, color: Colors.textBright, fontSize: 15,
            textAlignVertical: 'top', marginBottom: contentError ? 6 : 18,
          },
          contentError && { borderColor: Colors.ROSE, borderWidth: 1.5 },
        ]}
        placeholder="Something to remember, or something to do…"
        placeholderTextColor={Colors.subtext}
        value={content}
        onChangeText={(t) => { setContent(t); if (contentError) setContentError(false); }}
        autoFocus
        multiline
        maxLength={2000}
        accessibilityLabel="Note text"
      />
      {contentError && (
        <Text style={{ color: Colors.ROSE, fontSize: 11, marginBottom: 18 }}>
          A note needs something in it
        </Text>
      )}

      <Text style={label}>DAY</Text>
      <View style={{ marginBottom: 18 }}>
        <DayPickerRow weekStart={weekStart} selected={date} onSelect={setDate} />
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 4, marginBottom: 20,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>To-do</Text>
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>
            Gives it a checkbox you can tick off
          </Text>
        </View>
        <Switch
          value={isTodo}
          onValueChange={setIsTodo}
          trackColor={{ false: Colors.inactive, true: Colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <TouchableOpacity
        onPress={handleSave}
        accessibilityRole="button"
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15,
        }}
      >
        <Ionicons name={note ? 'checkmark' : 'add'} size={16} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
          {note ? 'Save changes' : 'Add note'}
        </Text>
      </TouchableOpacity>

      {note && onDelete && (
        <TouchableOpacity
          onPress={confirmDelete}
          accessibilityRole="button"
          style={{
            marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
            backgroundColor: Colors.ROSE_DIM, borderWidth: 0.5, borderColor: Colors.ROSE + '40',
          }}
        >
          <Text style={{ color: Colors.ROSE, fontWeight: '700', fontSize: 14 }}>Delete note</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}
