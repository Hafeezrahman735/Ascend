import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note } from '../../types';
import { addDays, eachDayOfRange, getLocalDateString, parseLocalDate } from '../../utils/date';
import {
  getCalendarStyles, itemTitle, itemIsDone, typeColor, itemTimeRange,
  countsTowardLoad, isNote, calendarItemKey, formatMinutes,
} from './shared';

/** Cards drawn in a column before it collapses into a "+N" line. */
const MAX_COLUMN_CARDS = 3;

/**
 * Week as seven columns for comparison, then seven cards for detail.
 *
 * The strip answers "which day is emptiest" — load visible without reading
 * anything. The cards answer "what is actually on each day", and there is one
 * per day because this is the WEEK view: a week you have to tap through a day at
 * a time is a day view with extra steps.
 *
 * It used to show a single card for whichever column you tapped. That made six
 * of the seven days invisible until you went looking for them, and the one day
 * you most want to see — today — was only the default until you touched
 * anything. Today now pops instead of being selected, so it stays found.
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
  const todayKey = getLocalDateString();
  const days = useMemo(() => eachDayOfRange(start, addDays(start, 6)), [start]);

  return (
    <View>
      {/* ── Seven columns ─────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 10, paddingBottom: 18 }}>
        {days.map((dateKey) => {
          const dayItems = itemsByDate.get(dateKey) ?? [];
          // Commitments first, then what you wrote about the day. Notes were
          // filtered out here entirely, so a day carrying three notes and
          // nothing else showed an empty column.
          const cards = [
            ...dayItems.filter(countsTowardLoad),
            ...dayItems.filter(isNote),
          ];
          const day = parseLocalDate(dateKey);
          const isToday = dateKey === todayKey;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <TouchableOpacity
              key={dateKey}
              onPress={() => onDayPress(dateKey)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}, ${cards.length} items. Open in Day view`}
              style={{
                flex: 1, minWidth: 0, borderRadius: 12, paddingBottom: 4,
                backgroundColor: isToday ? Colors.primaryDim : 'transparent',
                opacity: isWeekend && !isToday ? 0.55 : 1,
              }}
            >
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{
                  fontSize: 9, fontWeight: '700',
                  color: isToday ? Colors.primarySoft : Colors.subtext,
                }}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase()}
                </Text>
                <Text style={{
                  fontSize: 12, fontWeight: isToday ? '700' : '600', marginTop: 1,
                  color: isToday ? Colors.primarySoft : Colors.textBright,
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
                    borderColor: idx === 0 && isToday ? Colors.primary : Colors.border,
                    borderRadius: 9,
                    paddingHorizontal: 5, paddingVertical: 6,
                    marginHorizontal: isToday ? 4 : 0,
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
                  marginHorizontal: isToday ? 4 : 0,
                }}>
                  +{cards.length - MAX_COLUMN_CARDS}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── One card per day ──────────────────────────────────────────── */}
      {days.map((dateKey) => (
        <DayCard
          key={dateKey}
          dateKey={dateKey}
          isToday={dateKey === todayKey}
          items={itemsByDate.get(dateKey) ?? []}
          onDayPress={onDayPress}
          onToggleNote={onToggleNote}
        />
      ))}
    </View>
  );
}

/**
 * One day's detail.
 *
 * Today gets an accent border and a primary-tinted glow — the same treatment the
 * home tab uses for a selected card — plus a TODAY chip, so it is findable in a
 * stack of seven without having to read the dates.
 */
function DayCard({
  dateKey,
  isToday,
  items,
  onDayPress,
  onToggleNote,
}: {
  dateKey: string;
  isToday: boolean;
  items: CalendarItem[];
  onDayPress: (date: string) => void;
  onToggleNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);

  const scheduled = items.filter(countsTowardLoad);
  // EVERY note, not just the to-dos. Filtering to `isTodo` here meant a plain
  // note — the kind you write precisely so you will see it on the day — was
  // unreachable from Week view entirely.
  const notes = items.filter(isNote).map((i) => i.data as Note);
  const count = scheduled.length + notes.length;

  const day = parseLocalDate(dateKey);
  const weekday = day.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();

  return (
    <View
      style={{
        marginHorizontal: 16, marginBottom: 10, padding: 15,
        backgroundColor: Colors.surface,
        borderWidth: isToday ? 1.5 : 1,
        borderColor: isToday ? Colors.primary : Colors.border,
        borderRadius: 16,
        // Android ignores shadowOpacity and reads elevation, so both are set.
        ...(isToday
          ? { shadowColor: Colors.primary, shadowOpacity: 0.5, shadowRadius: 10, elevation: 5 }
          : {}),
      }}
    >
      <TouchableOpacity
        onPress={() => onDayPress(dateKey)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${isToday ? 'Today, ' : ''}${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} items. Open in Day view`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: count > 0 ? 10 : 6 }}
      >
        {isToday && (
          <View style={{
            backgroundColor: Colors.primaryDim, borderRadius: 5,
            paddingHorizontal: 5, paddingVertical: 2,
          }}>
            <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: Colors.primarySoft }}>
              TODAY
            </Text>
          </View>
        )}
        <Text
          numberOfLines={1}
          style={{
            flex: 1, fontSize: 10, fontWeight: '700', letterSpacing: 1,
            color: isToday ? Colors.primarySoft : Colors.subtext,
          }}
        >
          {weekday} {day.getDate()}
          {' · '}
          {count}
          {count === 1 ? ' ITEM' : ' ITEMS'}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={Colors.subtext} />
      </TouchableOpacity>

      {count === 0 && (
        <Text style={{ color: Colors.subtext, fontSize: 12.5 }}>
          Nothing on this day.
        </Text>
      )}

      {scheduled.map((item, idx) => {
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
          losing it would be a regression dressed up as a redesign. A plain
          note is not a checkbox, so it renders as a row rather than being
          given a control that would do nothing. */}
      {notes.map((note) => (
        note.isTodo ? (
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
              color={note.isCompleted ? Colors.trace : Colors.subtext}
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
        ) : (
          <View key={note.id} style={styles.todoRow} accessibilityRole="text">
            <Ionicons name="document-text-outline" size={14} color={Colors.subtext} />
            <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: Colors.text }}>
              {note.content}
            </Text>
          </View>
        )
      ))}
    </View>
  );
}
