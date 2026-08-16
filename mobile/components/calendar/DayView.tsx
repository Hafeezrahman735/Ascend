import { useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, CalendarItemType, Note } from '../../types';
import { getCalendarStyles, DAY_GROUP_ORDER, TYPE_META, typeColor } from './shared';
import ItemRow from './ItemRow';

/**
 * Full agenda for one day, grouped by item type, with the notes/to-do section
 * at the bottom — schedule first, then what you jotted down about it.
 */
export default function DayView({
  dateKey,
  itemsByDate,
  noteDraft,
  onNoteDraftChange,
  onAddNote,
  onToggleNote,
  onDeleteNote,
}: {
  dateKey: string;
  itemsByDate: Map<string, CalendarItem[]>;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onAddNote: () => void;
  onToggleNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const dayItems = useMemo(() => itemsByDate.get(dateKey) ?? [], [itemsByDate, dateKey]);

  const grouped = useMemo(() => {
    const map = new Map<CalendarItemType, CalendarItem[]>();
    for (const item of dayItems) {
      const bucket = map.get(item.type);
      if (bucket) bucket.push(item);
      else map.set(item.type, [item]);
    }
    return map;
  }, [dayItems]);

  const notes = grouped.get('note') ?? [];
  const hasScheduled = dayItems.some((i) => i.type !== 'note');

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
      {!hasScheduled && (
        <View style={styles.emptyBox}>
          <Ionicons name="calendar-clear-outline" size={26} color={Colors.subtext} />
          <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13 }}>
            Nothing on this day. Good day to get ahead.
          </Text>
        </View>
      )}

      {DAY_GROUP_ORDER.filter((t) => t !== 'note').map((type) => {
        const group = grouped.get(type);
        if (!group || group.length === 0) return null;
        return (
          <View key={type} style={{ marginBottom: 18 }}>
            <View style={styles.groupHeader}>
              <Ionicons name={TYPE_META[type].icon} size={14} color={typeColor(type, Colors)} />
              <Text style={styles.groupTitle}>{TYPE_META[type].label}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 11 }}>{group.length}</Text>
            </View>
            {group.map((item, idx) => <ItemRow key={`${type}-${idx}`} item={item} />)}
          </View>
        );
      })}

      <View style={{ marginTop: 4 }}>
        <View style={styles.groupHeader}>
          <Ionicons name={TYPE_META.note.icon} size={14} color={Colors.subtext} />
          <Text style={styles.groupTitle}>{TYPE_META.note.label}</Text>
        </View>

        <View style={styles.addRow}>
          <TextInput
            value={noteDraft}
            onChangeText={onNoteDraftChange}
            placeholder="Add a note or to-do…"
            placeholderTextColor={Colors.subtext}
            style={styles.addInput}
            onSubmitEditing={onAddNote}
            returnKeyType="done"
            accessibilityLabel="New note"
          />
          <TouchableOpacity
            onPress={onAddNote}
            disabled={!noteDraft.trim()}
            style={[styles.addBtn, { opacity: noteDraft.trim() ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Add note"
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
          </TouchableOpacity>
        </View>

        {notes.map((item) => {
          const note = item.data as Note;
          return (
            <TouchableOpacity
              key={note.id}
              onPress={() => note.isTodo && onToggleNote(note)}
              onLongPress={() => onDeleteNote(note)}
              delayLongPress={400}
              style={styles.noteRow}
              accessibilityRole={note.isTodo ? 'checkbox' : 'text'}
              accessibilityState={note.isTodo ? { checked: note.isCompleted } : undefined}
            >
              {note.isTodo && (
                <Ionicons
                  name={note.isCompleted ? 'checkbox' : 'square-outline'}
                  size={17}
                  color={note.isCompleted ? Colors.accent : Colors.subtext}
                />
              )}
              <Text
                style={{
                  color: note.isCompleted ? Colors.subtext : Colors.text,
                  fontSize: 13,
                  flex: 1,
                  textDecorationLine: note.isCompleted ? 'line-through' : 'none',
                }}
              >
                {note.content}
              </Text>
            </TouchableOpacity>
          );
        })}

        {notes.length > 0 && (
          <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 6 }}>
            Long-press a note to delete
          </Text>
        )}
      </View>
    </View>
  );
}
