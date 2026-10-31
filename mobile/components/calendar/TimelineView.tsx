import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, TimelineSession } from '../../types';
import { getLocalDateString } from '../../utils/date';
import { formatDuration } from '../../lib/taskMetrics';
import type { BlockFill, DayPlanVsActual } from '../../lib/planVsActual';
import {
  itemTimeRange, itemTitle, itemIsDone, isPastEvent, blockStyle, calendarItemKey,
  formatTimeRange, TYPE_META, MINUTES_IN_DAY, type TimeRange,
} from './shared';

/**
 * The scheduled part of one day, drawn on an hour grid.
 *
 * Only items that actually carry a time appear here; everything untimed stays in
 * the agenda below, so nothing is shown twice. The grid fits itself to the hours
 * in use rather than always rendering 00:00–24:00 — a day with one 9am task
 * should not open on fourteen empty rows.
 *
 * With a plan-vs-actual result (lib/planVsActual), a planned task block fills
 * from the left with the focus it got that day, and focus on anything else is
 * drawn as a dashed "unplanned" block at the time it ran, laid out beside other
 * blocks like any overlapping item.
 */

const HOUR_HEIGHT = 56;
const GUTTER_WIDTH = 46;
/**
 * Enough vertical room that a short block still shows its title AND stays
 * tappable. Events skew short, and hitSlop cannot rescue a 26px row here: on a
 * stacked grid, slop creates overlapping hit zones and the wrong block opens.
 * Still under the 44pt guideline, which is why the Planning EVENTS list exists
 * as the guaranteed-reachable path to the same rows.
 */
const MIN_BLOCK_HEIGHT = 32;
/** A grid tighter than this is cramped, so short days get breathing room. */
const MIN_VISIBLE_HOURS = 4;

type Entry =
  | { kind: 'item'; item: CalendarItem; range: TimeRange }
  | { kind: 'session'; session: TimelineSession; range: TimeRange };
type PlacedEntry = Entry & { column: number; columns: number };

function entryKey(entry: Entry): string {
  return entry.kind === 'item' ? calendarItemKey(entry.item) : `session:${entry.session.id}`;
}

/** The fill drawn on a planned block: same task, same start (lib/planVsActual matches by task). */
function fillKey(taskId: string, start: number): string {
  return `${taskId}:${start}`;
}

/**
 * Assigns overlapping blocks to side-by-side columns.
 *
 * Items are grouped into clusters of mutually overlapping blocks, and every
 * block in a cluster is sized to the widest point of that cluster — so two
 * overlapping meetings each take half the width, and neither ends up hidden
 * behind the other.
 */
function placeEntries(entries: Entry[]): PlacedEntry[] {
  const sorted = [...entries].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);

  const placed: PlacedEntry[] = [];
  let cluster: PlacedEntry[] = [];
  let clusterEnd = -1;
  /** Last end minute per column, for the cluster being built. */
  let columnEnds: number[] = [];

  const flushCluster = () => {
    const width = columnEnds.length;
    for (const entry of cluster) entry.columns = width;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const entry of sorted) {
    if (entry.range.start >= clusterEnd && cluster.length > 0) flushCluster();

    let column = columnEnds.findIndex((end) => end <= entry.range.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(entry.range.end);
    } else {
      columnEnds[column] = entry.range.end;
    }

    cluster.push({ ...entry, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, entry.range.end);
  }
  if (cluster.length > 0) flushCluster();

  return placed;
}

/** Minutes from local midnight, right now. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export default function TimelineView({ dateKey, items, plan, onItemPress, onSessionPress }: {
  dateKey: string;
  items: CalendarItem[];
  /** Plan vs actual for this day; without it the grid draws the plan only. */
  plan?: DayPlanVsActual;
  /** Opens the sessions behind a dashed unplanned block. */
  onSessionPress?: (session: TimelineSession) => void;
  /**
   * Opens the item behind a block. Without this there is no path to a timed
   * event at all: DayView's agenda renders only UNTIMED items, so an event with
   * a time exists nowhere else on the screen. Blocks stay inert when it is not
   * passed, rather than looking tappable and doing nothing.
   */
  onItemPress?: (item: CalendarItem) => void;
}) {
  const Colors = useTheme();
  const now = new Date();

  const entries = useMemo(() => {
    const found: Entry[] = [];
    for (const item of items) {
      const range = itemTimeRange(item);
      if (range) found.push({ kind: 'item', item, range });
    }
    for (const session of plan?.unplanned ?? []) {
      // At least a minute long, so a very short session still has a block.
      const start = session.startLocalMinutes;
      found.push({ kind: 'session', session, range: { start, end: Math.max(session.endLocalMinutes, start + 1) } });
    }
    return found;
  }, [items, plan]);

  const fills = useMemo(() => {
    const map = new Map<string, BlockFill>();
    for (const fill of plan?.fills ?? []) map.set(fillKey(fill.block.taskId, fill.block.startMinutes), fill);
    return map;
  }, [plan]);

  const placed = useMemo(() => placeEntries(entries), [entries]);

  // The visible window, snapped to whole hours around what is actually on the day.
  const { startHour, endHour } = useMemo(() => {
    if (entries.length === 0) return { startHour: 0, endHour: 0 };
    const earliest = Math.min(...entries.map((e) => e.range.start));
    const latest = Math.max(...entries.map((e) => e.range.end));

    let from = Math.floor(earliest / 60);
    let to = Math.ceil(latest / 60);
    // Grow the window symmetrically until it is worth drawing, without ever
    // running past the ends of the day.
    while (to - from < MIN_VISIBLE_HOURS && (from > 0 || to < 24)) {
      if (from > 0) from -= 1;
      if (to - from < MIN_VISIBLE_HOURS && to < 24) to += 1;
    }
    return { startHour: from, endHour: to };
  }, [entries]);

  const isToday = dateKey === getLocalDateString();
  const [minutesNow, setMinutesNow] = useState(nowMinutes);

  useEffect(() => {
    if (!isToday) return;
    // The line only ever needs to be minute-accurate.
    const id = setInterval(() => setMinutesNow(nowMinutes()), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  // Nothing scheduled — say so in one line instead of drawing an empty ladder.
  if (entries.length === 0) {
    return (
      <View style={{
        marginHorizontal: 16, marginBottom: 14, padding: 12, borderRadius: 12,
        backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
      }}>
        <Text style={{ color: Colors.subtext, fontSize: 12.5 }}>
          Nothing scheduled to a time today. Give a task a start and end time to see it here.
        </Text>
      </View>
    );
  }

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT;
  const windowStartMinute = startHour * 60;

  const offsetFor = (minute: number) => ((minute - windowStartMinute) / 60) * HOUR_HEIGHT;
  const showNowLine = isToday
    && minutesNow >= windowStartMinute
    && minutesNow <= Math.min(endHour * 60, MINUTES_IN_DAY);

  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
      <View style={{ height: gridHeight, flexDirection: 'row' }}>
        {/* Hour gutter and rules */}
        <View style={{ width: GUTTER_WIDTH }}>
          {hours.map((hour, i) => (
            <View key={hour} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start' }}>
              <Text style={{
                color: Colors.subtext, fontSize: 10, textAlign: 'right',
                paddingRight: 8, marginTop: i === 0 ? 0 : -6,
              }}>
                {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1 }}>
          {hours.map((hour, i) => (
            <View
              key={hour}
              style={{
                position: 'absolute', left: 0, right: 0, top: i * HOUR_HEIGHT,
                height: 1, backgroundColor: Colors.border,
              }}
            />
          ))}
          <View style={{
            position: 'absolute', left: 0, right: 0, top: gridHeight,
            height: 1, backgroundColor: Colors.border,
          }} />

          {placed.map((entry) => {
            const top = offsetFor(entry.range.start);
            const height = Math.max(
              MIN_BLOCK_HEIGHT,
              ((entry.range.end - entry.range.start) / 60) * HOUR_HEIGHT,
            );
            const widthPct = 100 / entry.columns;
            const position = {
              position: 'absolute' as const,
              top,
              height,
              left: `${entry.column * widthPct}%` as const,
              width: `${widthPct}%` as const,
              paddingRight: 4,
              paddingTop: 1,
            };

            if (entry.kind === 'session') {
              const { session } = entry;
              const title = session.taskTitle ?? 'Focus';
              const length = formatDuration(session.durationSeconds);
              return (
                <TouchableOpacity
                  key={entryKey(entry)}
                  onPress={onSessionPress ? () => onSessionPress(session) : undefined}
                  disabled={!onSessionPress}
                  activeOpacity={0.75}
                  accessibilityRole={onSessionPress ? 'button' : 'text'}
                  accessibilityLabel={`Unplanned focus: ${title}, ${length}, ${formatTimeRange(entry.range)}`}
                  style={position}
                >
                  <View style={{
                    flex: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden',
                    borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primarySoft,
                    flexDirection: 'row', alignItems: height >= 44 ? 'flex-start' : 'center', gap: 6,
                  }}>
                    <Text numberOfLines={1} style={{ flex: 1, color: Colors.textBright, fontSize: 12, fontWeight: '600' }}>
                      {title}
                    </Text>
                    <Text style={{ color: Colors.subtext, fontSize: 10 }}>unplanned</Text>
                    <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                      {length}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }

            const done = itemIsDone(entry.item);
            // Events never complete — you do not tick off a dentist appointment.
            // They dim once they have happened instead, which is a different
            // statement: it did not fail, it is simply behind you.
            const past = isPastEvent(entry.item, now);
            const handled = !!onItemPress;
            const taskId = entry.item.type === 'task' || entry.item.type === 'habit_instance'
              ? (entry.item.data as { id?: string }).id
              : undefined;
            const fill = taskId ? fills.get(fillKey(taskId, entry.range.start)) : undefined;
            const plannedSeconds = (entry.range.end - entry.range.start) * 60;
            const over = fill && fill.overSeconds > 0 ? ` +${formatDuration(fill.overSeconds)}` : '';
            const focusedText = fill
              ? `${formatDuration(fill.focusedSeconds)} of ${formatDuration(plannedSeconds)}${over}`
              : null;

            return (
              <TouchableOpacity
                key={entryKey(entry)}
                onPress={handled ? () => onItemPress(entry.item) : undefined}
                disabled={!handled}
                activeOpacity={0.75}
                accessibilityRole={handled ? 'button' : 'text'}
                // The type leads: sighted users get form and colour, VoiceOver
                // users used to get neither.
                accessibilityLabel={`${TYPE_META[entry.item.type].label}: ${itemTitle(entry.item)}, ${formatTimeRange(entry.range)}${focusedText ? `, focused ${focusedText}` : ''}${past ? ', past' : ''}`}
                style={position}
              >
                <View style={[
                  {
                    flex: 1,
                    borderRadius: 7,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    overflow: 'hidden',
                    opacity: done || past ? 0.55 : 1,
                  },
                  blockStyle(entry.item.type, Colors),
                ]}>
                  {fill && fill.share > 0 && (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${fill.share * 100}%`, backgroundColor: Colors.primary, opacity: 0.35,
                      }}
                    />
                  )}
                  <Text
                    numberOfLines={height >= 44 ? 2 : 1}
                    style={{
                      color: done ? Colors.subtext : Colors.textBright,
                      fontSize: 12,
                      fontWeight: '600',
                      textDecorationLine: done ? 'line-through' : 'none',
                    }}
                  >
                    {itemTitle(entry.item)}
                  </Text>
                  {height >= 44 && (
                    <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                      {formatTimeRange(entry.range)}
                    </Text>
                  )}
                  {focusedText && height >= 60 && (
                    <Text
                      numberOfLines={1}
                      style={{ color: Colors.textBright, fontSize: 11, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] }}
                    >
                      {focusedText}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {showNowLine && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: -4, right: 0, top: offsetFor(minutesNow),
                flexDirection: 'row', alignItems: 'center',
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.ROSE }} />
              <View style={{ flex: 1, height: 1, backgroundColor: Colors.ROSE }} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
