import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note } from '../../types';
import { addDays, eachDayOfRange, getLocalDateString, parseLocalDate } from '../../utils/date';
import {
  getCalendarStyles, itemTitle, itemIsDone, typeColor, itemTimeRange,
  countsTowardLoad, isNote, calendarItemKey, formatMinutes,
} from './shared';

/** Cards drawn in a column before it collapses into a "+N" line. */
const MAX_COLUMN_CARDS = 5;

/**
 * Share of the view the pinned strip occupies.
 *
 * A fixed band rather than height-to-content, and that is the point of it: the
 * columns are a comparison, so they only compare if the space they are drawn in
 * is the same every week. It also means how full a column looks IS the day's
 * load, read against a constant, instead of against six neighbours that all
 * shrank together on a quiet week.
 *
 * Under half so the list below still reads as the main content — a pane that
 * takes exactly half looks like a split screen, not a header.
 */
const STRIP_HEIGHT = '46%';

/**
 * Week as seven pinned columns for comparison, then a scrolling card list.
 *
 * The strip answers "which day is emptiest" — load visible without reading
 * anything, and it always shows all seven, so an empty day is still visible as
 * an empty column. The cards below answer "what is actually on each day", for
 * every day that has anything: a week you have to tap through a day at a time is
 * a day view with extra steps.
 *
 * The strip stays put while those cards scroll, which is why this owns a
 * ScrollView instead of sitting inside the calendar tab's shared one — a header
 * can only be pinned by the scroll container it is a sibling of. That is also
 * why pull-to-refresh is a prop: the RefreshControl has to live on whichever
 * ScrollView the user is actually dragging.
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
  refreshing,
  onRefresh,
}: {
  start: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (date: string) => void;
  onToggleNote: (note: Note) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const todayKey = getLocalDateString();
  const days = useMemo(() => eachDayOfRange(start, addDays(start, 6)), [start]);

  // Only the days with something on them get a card. A card reading "Nothing on
  // this day" costs a full box of vertical space to say the week strip above it
  // has already said with an empty column — and on a quiet week it said it six
  // times, pushing the days that DO have something off the screen.
  //
  // `items.length` is the test, not `countsTowardLoad`: a day holding only notes
  // has something on it. See the note on countsTowardLoad in lib/calendarItems.
  const busyDays = useMemo(
    () => days
      .map((dateKey) => ({ dateKey, items: itemsByDate.get(dateKey) ?? [] }))
      .filter(({ items }) => items.length > 0),
    [days, itemsByDate],
  );

  return (
    <View style={{ flex: 1 }}>
      {/* ── Seven pinned columns ──────────────────────────────────────── */}
      <View style={{
        height: STRIP_HEIGHT,
        flexDirection: 'row',
        gap: 5,
        paddingHorizontal: 10,
        paddingBottom: 12,
        // The list scrolls under this, so the band needs an edge of its own or
        // cards appear to slide out of nowhere.
        borderBottomWidth: 1,
        borderBottomColor: Colors.border,
        backgroundColor: Colors.bg,
      }}>
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
          const hidden = cards.length - MAX_COLUMN_CARDS;

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
                  fontSize: 13, fontWeight: isToday ? '700' : '600', marginTop: 1,
                  color: isToday ? Colors.primarySoft : Colors.textBright,
                }}>
                  {day.getDate()}
                </Text>
              </View>

              {/* Cards take whatever the band has left, and clip rather than
                  push. A phone short enough to cut the last card still gets a
                  strip that ends where the band ends, which is the whole point
                  of a fixed band — and the count below stays visible because it
                  sits outside this box. */}
              <View style={{ flex: 1, overflow: 'hidden' }}>
                {cards.slice(0, MAX_COLUMN_CARDS).map((item, idx) => (
                  <View
                    key={calendarItemKey(item)}
                    style={{
                      backgroundColor: Colors.surface,
                      borderWidth: 1,
                      borderColor: idx === 0 && isToday ? Colors.primary : Colors.border,
                      borderRadius: 9,
                      paddingHorizontal: 5, paddingVertical: 7,
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
                        fontSize: 10, lineHeight: 12.5,
                        color: itemIsDone(item) ? Colors.subtext : Colors.text,
                        textDecorationLine: itemIsDone(item) ? 'line-through' : 'none',
                      }}
                    >
                      {itemTitle(item)}
                    </Text>
                  </View>
                ))}
              </View>

              {hidden > 0 && (
                <Text style={{
                  fontSize: 9, textAlign: 'center', color: Colors.subtext,
                  marginHorizontal: isToday ? 4 : 0, paddingTop: 2,
                }}>
                  +{hidden}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── The scrolling half ────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* One card per day that has something on it. */}
        {busyDays.map(({ dateKey, items }) => (
          <DayCard
            key={dateKey}
            dateKey={dateKey}
            isToday={dateKey === todayKey}
            items={items}
            onDayPress={onDayPress}
            onToggleNote={onToggleNote}
          />
        ))}

      {/* One line for a wholly empty week. Dropping the per-day cards must not
          leave the section blank under a strip of seven empty columns — that
          reads as a screen that failed to load rather than a free week. */}
        {busyDays.length === 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <View style={styles.emptyBox}>
              <Ionicons name="calendar-clear-outline" size={26} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13 }}>
                Nothing planned this week. Tap a day to add something.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One day's detail. Only rendered for a day that has something on it, so this
 * never has to draw an empty state — see `busyDays` above.
 *
 * Today gets an accent border and a primary-tinted glow — the same treatment the
 * home tab uses for a selected card — plus a TODAY chip, so it is findable in a
 * stack of cards without having to read the dates.
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
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}
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
