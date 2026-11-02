import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note, Task, TimelineSession } from '../../types';
import { addDays, getLocalDateString, parseLocalDate } from '../../utils/date';
import { formatMinutes, formatSeconds, typeColor } from './shared';
import { weekRows, type WeekRow } from '../../lib/planScreen';
import {
  planVsActual, plannedBlocksFromCalendar, summaryLine, type DayPlanVsActual,
} from '../../lib/planVsActual';
import { axisTicks, laneSummary, taskFocusOnDay, weekAxis, type LaneAxis } from '../../lib/calendarViews';
import { DayRowList, dayName, hoursLabel, type PlanHighlight } from './DayRows';

/**
 * Week as seven day lanes (design W3).
 *
 * Each day is one row: its date, a track with blocks at their real times, and
 * the hours booked. All seven tracks share one time axis (eng review D2), so 9am
 * lines up down the screen and the week reads like a heat map: busy mornings,
 * free evenings, the day you will regret. Blocks are see-through (D11), so a
 * clash shows as a darker patch.
 *
 * Every lane starts folded, as on Plan; tapping one lists the day inline (the
 * same DayRowList and item row Plan uses) with the day's focus against its plan
 * and each planned task's own focus (D3). A day with focus but nothing booked
 * still opens, or that focus would be invisible here. A thin bar under each
 * track keeps focus-against-plan comparable across the week without a tap (D9).
 *
 * Week lives inside the calendar tab's shared ScrollView now: its own scroller
 * only existed to pin the old seven-column strip.
 */

/** Left column (day and date) and right column (hours) of a lane. */
const LABEL_WIDTH = 40;
const META_WIDTH = 48;
const GAP = 10;
const CHEVRON_WIDTH = 14;
/** A block is never drawn thinner than this, so a short meeting stays visible. */
const MIN_BLOCK_PX = 3;
/** See-through blocks: overlap reads darker (D11). */
const BLOCK_OPACITY = 0.55;

interface LaneRow extends WeekRow {
  plan: DayPlanVsActual;
  focusCount: number;
}

function anytimeLabel(anytime: number, notes: number): string {
  if (anytime > 0) return `+${anytime} any`;
  if (notes > 0) return `${notes} note${notes === 1 ? '' : 's'}`;
  return '';
}

/** Focused against planned under the track: fills by the plan's share that got focus, lighter for unplanned-only. */
function FocusBar({ totals }: { totals: DayPlanVsActual['totals'] }) {
  const Colors = useTheme();
  const { plannedMinutes, focusedSeconds } = totals;
  const share = plannedMinutes > 0 ? Math.min(1, focusedSeconds / (plannedMinutes * 60)) : focusedSeconds > 0 ? 1 : 0;
  return (
    <View style={{ height: 3, borderRadius: 2, marginTop: 3, backgroundColor: Colors.inactive, overflow: 'hidden' }}>
      <View style={{
        width: `${share * 100}%`, height: 3,
        backgroundColor: plannedMinutes > 0 ? Colors.primary : Colors.primarySoft,
      }} />
    </View>
  );
}

function Track({ items, axis, nowAt, totals, showFocus }: {
  items: CalendarItem[];
  axis: LaneAxis;
  /** 0-1 position of "now" on today's lane, else null. */
  nowAt: number | null;
  totals: DayPlanVsActual['totals'];
  showFocus: boolean;
}) {
  const Colors = useTheme();
  const { segments } = laneSummary(items, axis);
  return (
    <View style={{ flex: 1 }}>
      <View style={{
        height: 22, borderRadius: 6, backgroundColor: Colors.surface,
        borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
      }}>
        {segments.map((s) => (
          <View
            key={s.key}
            style={{
              position: 'absolute', top: 3, bottom: 3, borderRadius: 3,
              left: `${s.left * 100}%`, width: `${s.width * 100}%`, minWidth: MIN_BLOCK_PX,
              backgroundColor: typeColor(s.type, Colors), opacity: BLOCK_OPACITY,
            }}
          />
        ))}
        {nowAt !== null && (
          <View style={{ position: 'absolute', top: 0, bottom: 0, width: 2, left: `${nowAt * 100}%`, backgroundColor: Colors.ROSE }} />
        )}
      </View>
      {showFocus && <FocusBar totals={totals} />}
    </View>
  );
}

export default function WeekView({
  start,
  itemsByDate,
  sessions = [],
  focusError = null,
  onRetryFocus,
  highlight,
  onDayPress,
  onItemPress,
  onToggleNote,
}: {
  start: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  /** Focus sessions for the week. */
  sessions?: TimelineSession[];
  /** Set when the sessions could not be loaded; focus figures hide rather than read 0 (D12). */
  focusError?: string | null;
  onRetryFocus?: () => void;
  /** A task just saved here: its lane opens and its row tints. */
  highlight: PlanHighlight | null;
  onDayPress: (date: string) => void;
  onItemPress: (item: CalendarItem) => void;
  onToggleNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  // Read per render, never captured: the tab stays mounted across days.
  const now = new Date();
  const todayKey = getLocalDateString(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const dayKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => getLocalDateString(addDays(start, i))),
    [start],
  );
  const axis = useMemo(() => weekAxis(dayKeys, itemsByDate), [dayKeys, itemsByDate]);
  const span = axis.end - axis.start;
  const ticks = axisTicks(axis);
  const focusUnavailable = !!focusError && sessions.length === 0;

  const rows: LaneRow[] = useMemo(() => weekRows(dayKeys, itemsByDate, todayKey, { allDays: true }).map((row) => {
    const daySessions = sessions.filter((s) => s.localDate === row.key);
    return {
      ...row,
      plan: planVsActual(row.key, plannedBlocksFromCalendar(row.items), daySessions),
      focusCount: daySessions.length,
    };
  }), [dayKeys, itemsByDate, todayKey, sessions]);

  const weekBooked = rows.reduce((sum, r) => sum + r.booked, 0);
  const sideInset = { marginLeft: LABEL_WIDTH + GAP, marginRight: GAP + META_WIDTH + GAP + CHEVRON_WIDTH };

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
      <Text style={{ color: Colors.subtext, fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
        {weekBooked > 0 ? `${hoursLabel(weekBooked)} booked` : 'Nothing booked this week'}
      </Text>

      {focusUnavailable && (
        <TouchableOpacity
          onPress={onRetryFocus}
          disabled={!onRetryFocus}
          accessibilityRole="button"
          accessibilityLabel="Focus time unavailable. Retry"
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.subtext} />
          <Text style={{ color: Colors.subtext, fontSize: 12 }}>
            Focus time unavailable · <Text style={{ color: Colors.primarySoft, fontWeight: '600' }}>Retry</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* One axis for every lane: labels positioned over the track column. */}
      <View style={[sideInset, { height: 14 }]} importantForAccessibility="no-hide-descendants">
        {span > 0 && ticks.map((t) => (
          <Text
            key={t.minutes}
            style={{
              position: 'absolute', left: `${t.at * 100}%`, fontSize: 9, color: Colors.subtext,
              transform: [{ translateX: t.at === 0 ? 0 : -10 }],
            }}
          >
            {formatMinutes(t.minutes).replace(':00', '')}
          </Text>
        ))}
      </View>

      <DayRowList
        key={dayKeys[0]}
        rows={rows}
        highlight={highlight}
        onItemPress={onItemPress}
        onToggleNote={onToggleNote}
        onOpenDay={onDayPress}
        expandedIndent={LABEL_WIDTH + GAP}
        isExpandable={(row) => row.items.length > 0 || row.focusCount > 0}
        a11ySummary={(row) => {
          const { anytimeCount, noteCount } = laneSummary(row.items, axis);
          const focus = focusUnavailable ? null : summaryLine(row.plan.totals);
          return [
            dayName(row.key, 'long'),
            row.key === todayKey ? 'today' : null,
            row.booked > 0 ? `${hoursLabel(row.booked)} booked` : 'nothing booked',
            anytimeCount > 0 ? `${anytimeCount} without a time` : null,
            noteCount > 0 ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : null,
            focus,
          ].filter(Boolean).join(', ');
        }}
        renderSummary={(row) => {
          const day = parseLocalDate(row.key);
          const isToday = row.key === todayKey;
          const isPast = row.key < todayKey;
          const { anytimeCount, noteCount } = laneSummary(row.items, axis);
          const nowAt = isToday && span > 0 && nowMinutes >= axis.start && nowMinutes <= axis.end
            ? (nowMinutes - axis.start) / span : null;
          return (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: GAP, opacity: isPast ? 0.5 : 1 }}>
              <View style={{ width: LABEL_WIDTH }}>
                <Text style={{ fontSize: 9.5, fontWeight: '700', color: isToday ? Colors.AMBER : Colors.subtext }}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase()}
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: isToday ? Colors.AMBER : Colors.textBright }}>
                  {day.getDate()}
                </Text>
              </View>
              <Track
                items={row.items}
                axis={axis}
                nowAt={nowAt}
                totals={row.plan.totals}
                showFocus={!focusUnavailable}
              />
              <View style={{ width: META_WIDTH, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 11, color: row.booked > 0 ? Colors.textBright : Colors.subtext, fontVariant: ['tabular-nums'] }}>
                  {row.booked > 0 ? hoursLabel(row.booked) : '–'}
                </Text>
                <Text style={{ fontSize: 9.5, color: Colors.subtext }}>{anytimeLabel(anytimeCount, noteCount)}</Text>
              </View>
            </View>
          );
        }}
        renderExpandedHeader={(row) => {
          const line = focusUnavailable ? null : summaryLine(row.plan.totals);
          return line ? (
            <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '600', paddingTop: 4 }}>{line}</Text>
          ) : null;
        }}
        itemTrailing={(item, row) => {
          if (focusUnavailable || (item.type !== 'task' && item.type !== 'habit_instance')) return null;
          const focus = taskFocusOnDay(row.plan, (item.data as Task).id);
          if (!focus || focus.plannedMinutes === null || focus.seconds === 0) return null;
          return `${formatSeconds(focus.seconds)}/${formatSeconds(focus.plannedMinutes * 60)}`;
        }}
      />
    </View>
  );
}
