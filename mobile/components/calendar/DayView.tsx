import { useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, CalendarItemType, Note } from '../../types';
import {
  getCalendarStyles, DAY_GROUP_ORDER, TYPE_META, typeColor, itemTimeRange,
  countsTowardLoad, calendarItemKey,
} from './shared';
import ItemRow from './ItemRow';
import TimelineView from './TimelineView';

/**
 * Full agenda for one day: the hour grid first, then everything that has no time
 * on it, then the notes/to-do section — schedule, backlog, then what you jotted
 * down about it.
 *
 * The split is by whether an item carries a time, not by its type, so an item
 * appears in exactly one of the two places and never in both.
 */
export default function DayView({
  dateKey,
  itemsByDate,
  noteDraft,
  onNoteDraftChange,
  onAddNote,
  onToggleNote,
  onDeleteNote,
  onItemPress,
}: {
  dateKey: string;
  itemsByDate: Map<string, CalendarItem[]>;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onAddNote: () => void;
  onToggleNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  /** Opens an item for editing. Reaches both the grid above and the agenda below. */
  onItemPress?: (item: CalendarItem) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const dayItems = useMemo(() => itemsByDate.get(dateKey) ?? [], [itemsByDate, dateKey]);

  // Anything with a time is drawn on the grid; the agenda below takes the rest.
  const untimedItems = useMemo(
    () => dayItems.filter((item) => itemTimeRange(item) === null),
    [dayItems],
  );

  const grouped = useMemo(() => {
    const map = new Map<CalendarItemType, CalendarItem[]>();
    for (const item of untimedItems) {
      const bucket = map.get(item.type);
      if (bucket) bucket.push(item);
      else map.set(item.type, [item]);
    }
    return map;
  }, [untimedItems]);

  const notes = grouped.get('note') ?? [];
  const hasTimed = useMemo(() => dayItems.some((item) => itemTimeRange(item) !== null), [dayItems]);
  // Anything at all, notes included. This used to exclude notes, so a day
  // holding only notes rendered "Nothing on this day" directly above the notes
  // it was holding — the empty state contradicting the screen under it.
  const hasAnything = dayItems.length > 0;
  // The timeline draws time, so it needs a time-bearing item to be worth
  // showing; a note-only day gets the agenda below and no empty grid.
  const hasScheduled = useMemo(() => dayItems.some(countsTowardLoad), [dayItems]);
  const hasUnscheduled = untimedItems.some(countsTowardLoad);

  return (
    <View style={{ paddingTop: 6 }}>
      {/* When the day is completely empty the box below says so; a second empty
          prompt from the timeline would just be noise. */}
      {hasScheduled && (
        <TimelineView dateKey={dateKey} items={dayItems} onItemPress={onItemPress} />
      )}

      <View style={{ paddingHorizontal: 16 }}>
        {!hasAnything && (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-clear-outline" size={26} color={Colors.subtext} />
            <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13 }}>
              Nothing on this day. Good day to get ahead.
            </Text>
          </View>
        )}

        {/* Only worth a heading when there is a grid above to distinguish it from. */}
        {hasTimed && hasUnscheduled && (
          <Text style={{
            color: Colors.subtext, fontSize: 10, fontWeight: '700',
            letterSpacing: 1, marginBottom: 10,
          }}>
            UNSCHEDULED
          </Text>
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
              {group.map((item) => (
                <ItemRow
                  key={calendarItemKey(item)}
                  item={item}
                  // Only events are editable from here so far; the rest of the
                  // calendar is still read-only and should not pretend otherwise.
                  onPress={onItemPress && item.type === 'event'
                    ? () => onItemPress(item)
                    : undefined}
                />
              ))}
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
    </View>
  );
}
