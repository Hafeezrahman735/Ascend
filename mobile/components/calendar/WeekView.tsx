import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note } from '../../types';
import { addDays, eachDayOfRange, getLocalDateString, parseLocalDate } from '../../utils/date';
import {
  getCalendarStyles, itemTitle, itemIsDone, typeColor, itemTimeRange,
  isScheduledItem, calendarItemKey, formatMinutes,
} from './shared';

/** Cards drawn in a column before it collapses into a "+N" line. */
const MAX_COLUMN_CARDS = 3;

/**
 * Week as seven columns — load visible at a glance, without reading anything.
 *
 * The previous layout stacked seven full-width rows, which answered "what is on
 * Tuesday" but never "which day is emptiest", because you could not see two days
 * at once. Columns trade per-item detail for comparison, and the detail comes
 * back in the card below: tapping a column fills it.
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
  const todayKey = getLocalDateString();
  const days = useMemo(() => eachDayOfRange(start, addDays(start, 6)), [start]);

  // Selecting a column only changes what the detail card shows. The choice is
  // DERIVED rather than synced in an effect: paging to another week makes the
  // stored key fall out of `days` and the fallback takes over immediately, so
  // there is never a frame where the card describes a day that is not on screen.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selectedKey = pickedKey && days.includes(pickedKey)
    ? pickedKey
    : (days.includes(todayKey) ? todayKey : days[0]);

  const selectedItems = itemsByDate.get(selectedKey) ?? [];
  const selectedScheduled = selectedItems.filter(isScheduledItem);
  const selectedTodos = selectedItems
    .filter((i) => i.type === 'note')
    .map((i) => i.data as Note)
    .filter((n) => n.isTodo);

  return (
    <View>
      {/* ── Seven columns ─────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingBottom: 18 }}>
        {days.map((dateKey) => {
          const dayItems = itemsByDate.get(dateKey) ?? [];
          const cards = dayItems.filter(isScheduledItem);
          const day = parseLocalDate(dateKey);
          const isSelected = dateKey === selectedKey;
          const isToday = dateKey === todayKey;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <TouchableOpacity
              key={dateKey}
              onPress={() => setPickedKey(dateKey)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}, ${cards.length} scheduled`}
              style={{
                flex: 1, minWidth: 0, borderRadius: 12, paddingBottom: 4,
                backgroundColor: isSelected ? Colors.primaryDim : 'transparent',
                opacity: isWeekend && !isSelected ? 0.55 : 1,
              }}
            >
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{
                  fontSize: 9, fontWeight: '700',
                  color: isSelected ? Colors.primarySoft : Colors.subtext,
                }}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase()}
                </Text>
                <Text style={{
                  fontSize: 12, fontWeight: isSelected || isToday ? '700' : '600', marginTop: 1,
                  color: isSelected ? Colors.primarySoft : isToday ? Colors.primary : Colors.textBright,
                }}>
                  {day.getDate()}
                </Text>
              </View>

              {cards.slice(0, MAX_COLUMN_CARDS).map((item, idx) => (
                <View
                  key={calendarItemKey(item)}
                  style={{
                    backgroundColor: Colors.surface,
                    borderWidth: 1,
                    borderColor: idx === 0 && isSelected ? Colors.primary : Colors.border,
                    borderRadius: 9,
                    paddingHorizontal: 5, paddingVertical: 6,
                    marginHorizontal: isSelected ? 4 : 0,
                    marginBottom: 5,
                  }}
                >
                  <View style={{
                    height: 3, borderRadius: 2, marginBottom: 4,
                    backgroundColor: typeColor(item.type, Colors),
                  }} />
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: 9, lineHeight: 11,
                      color: itemIsDone(item) ? Colors.subtext : Colors.text,
                      textDecorationLine: itemIsDone(item) ? 'line-through' : 'none',
                    }}
                  >
                    {itemTitle(item)}
                  </Text>
                </View>
              ))}

              {cards.length > MAX_COLUMN_CARDS && (
                <Text style={{
                  fontSize: 9, textAlign: 'center', color: Colors.subtext,
                  marginHorizontal: isSelected ? 4 : 0,
                }}>
                  +{cards.length - MAX_COLUMN_CARDS}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Detail for the selected column ────────────────────────────── */}
      <View style={{
        marginHorizontal: 16, marginBottom: 16, padding: 15,
        backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
        borderRadius: 16,
      }}>
        <TouchableOpacity
          onPress={() => onDayPress(selectedKey)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${parseLocalDate(selectedKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} in Day view`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}
        >
          <Text style={{
            flex: 1, fontSize: 10, fontWeight: '700', letterSpacing: 1,
            color: Colors.primarySoft,
          }}>
            {parseLocalDate(selectedKey).toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}
            {' · '}
            {selectedScheduled.length} {selectedScheduled.length === 1 ? 'ITEM' : 'ITEMS'}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={Colors.subtext} />
        </TouchableOpacity>

        {selectedScheduled.length === 0 && selectedTodos.length === 0 && (
          <Text style={{ color: Colors.subtext, fontSize: 12.5 }}>
            Nothing on this day.
          </Text>
        )}

        {selectedScheduled.map((item, idx) => {
          const range = itemTimeRange(item);
          const done = itemIsDone(item);
          return (
            <View
              key={calendarItemKey(item)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: Colors.border,
              }}
            >
              <View style={{
                width: 3, height: 14, borderRadius: 2,
                backgroundColor: typeColor(item.type, Colors),
              }} />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1, fontSize: 13,
                  color: done ? Colors.subtext : Colors.text,
                  textDecorationLine: done ? 'line-through' : 'none',
                }}
              >
                {itemTitle(item)}
              </Text>
              {range && (
                <Text style={{ fontSize: 10, color: Colors.subtext }}>
                  {formatMinutes(range.start)}
                </Text>
              )}
            </View>
          );
        })}

        {/* To-dos stay toggleable here — the previous layout allowed it and
            losing it would be a regression dressed up as a redesign. */}
        {selectedTodos.map((note) => (
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
              numberOfLines={1}
              style={{
                flex: 1, fontSize: 12,
                color: note.isCompleted ? Colors.subtext : Colors.text,
                textDecorationLine: note.isCompleted ? 'line-through' : 'none',
              }}
            >
              {note.content}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
