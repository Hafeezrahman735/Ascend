import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note } from '../../types';
import { addDays, eachDayOfRange, getLocalDateString, parseLocalDate } from '../../utils/date';
import { getCalendarStyles } from './shared';
import ItemRow from './ItemRow';

/** Non-note items shown per day before collapsing into a "+N more" line. */
const MAX_VISIBLE_ITEMS = 4;

/**
 * Week agenda — one row per day, each summarising its items with an inline
 * to-do list. Tapping a day header drills into Day view.
 */
export default function WeekView({
  start,
  itemsByDate,
  onDayPress,
  onToggleNote,
}: {
  start: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (date: string) => void;
  onToggleNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const todayKey = getLocalDateString(new Date());
  const days = useMemo(() => eachDayOfRange(start, addDays(start, 6)), [start]);

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
      {days.map((dateKey) => {
        const dayItems = itemsByDate.get(dateKey) ?? [];
        const scheduled = dayItems.filter((i) => i.type !== 'note');
        const todos = dayItems
          .filter((i) => i.type === 'note')
          .map((i) => i.data as Note)
          .filter((n) => n.isTodo);
        const openTodos = todos.filter((t) => !t.isCompleted).length;
        const day = parseLocalDate(dateKey);
        const isToday = dateKey === todayKey;

        return (
          <View key={dateKey} style={[styles.weekRow, isToday && { borderColor: Colors.primary, borderWidth: 1 }]}>
            <TouchableOpacity
              onPress={() => onDayPress(dateKey)}
              style={styles.weekRowHeader}
              accessibilityRole="button"
              accessibilityLabel={`Open ${dateKey}`}
            >
              <Text style={{ color: isToday ? Colors.primary : Colors.textBright, fontWeight: '700', fontSize: 13 }}>
                {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
              </Text>
              <Text style={{ color: Colors.subtext, fontSize: 11 }}>
                {dayItems.length === 0
                  ? 'Nothing planned'
                  : `${dayItems.length} item${dayItems.length === 1 ? '' : 's'}`}
                {todos.length > 0 ? ` · ${openTodos}/${todos.length} to-do` : ''}
              </Text>
            </TouchableOpacity>

            {scheduled.slice(0, MAX_VISIBLE_ITEMS).map((item, idx) => (
              <ItemRow key={`${item.type}-${idx}`} item={item} compact />
            ))}

            {todos.map((note) => (
              <TouchableOpacity
                key={note.id}
                onPress={() => onToggleNote(note)}
                style={styles.todoRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: note.isCompleted }}
              >
                <Ionicons
                  name={note.isCompleted ? 'checkbox' : 'square-outline'}
                  size={15}
                  color={note.isCompleted ? Colors.accent : Colors.subtext}
                />
                <Text
                  style={{
                    color: note.isCompleted ? Colors.subtext : Colors.text,
                    fontSize: 12,
                    flex: 1,
                    textDecorationLine: note.isCompleted ? 'line-through' : 'none',
                  }}
                  numberOfLines={1}
                >
                  {note.content}
                </Text>
              </TouchableOpacity>
            ))}

            {scheduled.length > MAX_VISIBLE_ITEMS && (
              <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 4 }}>
                +{scheduled.length - MAX_VISIBLE_ITEMS} more
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
