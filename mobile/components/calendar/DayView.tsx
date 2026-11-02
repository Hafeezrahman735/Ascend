import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note, TimelineSession } from '../../types';
import { parseLocalDate } from '../../utils/date';
import { planVsActual, plannedBlocksFromCalendar } from '../../lib/planVsActual';
import PlanSummary from '../PlanSummary';
import {
  getCalendarStyles, DAY_GROUP_ORDER, itemTimeRange, itemTitle, countsTowardLoad, calendarItemKey, isNote,
} from './shared';
import AddRow, { type AddKind } from './AddRow';
import { CalendarItemRow } from './DayRows';
import TimelineView from './TimelineView';

/**
 * Full agenda for one day. Top to bottom: + Task / + Event / + Note, the plan
 * against focus, the hour grid, everything without a time ("Anytime"), then
 * notes and to-dos.
 *
 * The split is by whether an item carries a time, not by its type, so an item
 * appears in exactly one of the grid and Anytime, never in both. Anytime is one
 * list rather than a heading per type: the colour stripe already says the type.
 *
 * Every row is the shared CalendarItemRow, so taps work as on Plan and Week:
 * events, tasks and notes open their sheet, a to-do's checkbox ticks it. Notes
 * are added with + Note, which opens the note sheet on this day.
 *
 * Focus sessions go on the grid too: planned blocks fill with the focus they
 * got, and other focus shows as unplanned blocks (lib/planVsActual). A day with
 * sessions but nothing scheduled still gets a grid.
 */

function byDayOrder(a: CalendarItem, b: CalendarItem): number {
  const byType = DAY_GROUP_ORDER.indexOf(a.type) - DAY_GROUP_ORDER.indexOf(b.type);
  if (byType !== 0) return byType;
  const byTitle = itemTitle(a).localeCompare(itemTitle(b));
  if (byTitle !== 0) return byTitle;
  return calendarItemKey(a) < calendarItemKey(b) ? -1 : 1;
}

function SectionLabel({ label, trailing }: { label: string; trailing?: string }) {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, marginTop: 4 }}>
      <Text style={{ flex: 1, color: Colors.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
      {trailing && <Text style={{ color: Colors.subtext, fontSize: 11 }}>{trailing}</Text>}
    </View>
  );
}

export default function DayView({
  dateKey,
  itemsByDate,
  onAdd,
  onToggleNote,
  onItemPress,
  sessions = [],
  focusError = null,
  onRetryFocus,
  onSessionPress,
}: {
  dateKey: string;
  itemsByDate: Map<string, CalendarItem[]>;
  /** + Task / + Event / + Note, all landing on this day. */
  onAdd: (kind: AddKind) => void;
  onToggleNote: (note: Note) => void;
  /** Opens an item's sheet. Reaches both the grid and the lists below it. */
  onItemPress: (item: CalendarItem) => void;
  /** Focus sessions for the visible range; only this day's are used. */
  sessions?: TimelineSession[];
  /** Set when the sessions could not be loaded and none are cached. */
  focusError?: string | null;
  onRetryFocus?: () => void;
  onSessionPress?: (session: TimelineSession) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const dayItems = useMemo(() => itemsByDate.get(dateKey) ?? [], [itemsByDate, dateKey]);
  const daySessions = useMemo(() => sessions.filter((s) => s.localDate === dateKey), [sessions, dateKey]);
  const plan = useMemo(
    () => planVsActual(dateKey, plannedBlocksFromCalendar(dayItems), daySessions),
    [dateKey, dayItems, daySessions],
  );

  // Anything with a time is drawn on the grid; Anytime takes the rest.
  const anytime = useMemo(
    () => dayItems.filter((item) => !isNote(item) && itemTimeRange(item) === null).sort(byDayOrder),
    [dayItems],
  );
  const notes = useMemo(() => dayItems.filter(isNote), [dayItems]);
  const todos = notes.filter((n) => (n.data as Note).isTodo);
  const todosDone = todos.filter((n) => (n.data as Note).isCompleted).length;

  // Anything at all, notes included, so a notes-only day never says "Nothing on this day".
  const hasAnything = dayItems.length > 0 || daySessions.length > 0;
  // A commitment or some focus earns the grid; with only untimed work it shows
  // its own "nothing scheduled to a time" hint. A notes-only day gets no grid.
  const hasScheduled = dayItems.some(countsTowardLoad) || plan.unplanned.length > 0;
  const dayLabel = parseLocalDate(dateKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <View style={{ paddingTop: 6 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <AddRow onAdd={onAdd} dayLabel={dayLabel} taskTakesDay />
      </View>

      <PlanSummary totals={plan.totals} style={{ marginHorizontal: 16, marginBottom: 12 }} />
      {focusError && daySessions.length === 0 && (
        <TouchableOpacity
          onPress={onRetryFocus}
          disabled={!onRetryFocus}
          accessibilityRole="button"
          accessibilityLabel="Focus time unavailable. Retry"
          style={{ marginHorizontal: 16, marginBottom: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.subtext} />
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>
            Focus time unavailable · <Text style={{ color: Colors.primarySoft, fontWeight: '600' }}>Retry</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* When the day is completely empty the box below says so; a second empty
          prompt from the timeline would just be noise. */}
      {hasScheduled && (
        <TimelineView
          dateKey={dateKey}
          items={dayItems}
          plan={plan}
          onItemPress={onItemPress}
          onSessionPress={onSessionPress}
        />
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

        {anytime.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <SectionLabel label={`ANYTIME · ${anytime.length}`} />
            {anytime.map((item) => (
              <CalendarItemRow key={calendarItemKey(item)} item={item} onPress={onItemPress} onToggleNote={onToggleNote} />
            ))}
          </View>
        )}

        {notes.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <SectionLabel
              label="NOTES & TO-DO"
              trailing={todos.length > 0 ? `${todosDone} of ${todos.length} done` : undefined}
            />
            {notes.map((item) => (
              <CalendarItemRow key={calendarItemKey(item)} item={item} onPress={onItemPress} onToggleNote={onToggleNote} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
