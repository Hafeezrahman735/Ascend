import { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem } from '../../types';
import { getLocalDateString } from '../../utils/date';
import {
  itemTimeRange, itemTitle, itemIsDone, typeColor, formatTimeRange,
  MINUTES_IN_DAY, type TimeRange,
} from './shared';

/**
 * The scheduled part of one day, drawn on an hour grid.
 *
 * Only items that actually carry a time appear here; everything untimed stays in
 * the agenda below, so nothing is shown twice. The grid fits itself to the hours
 * in use rather than always rendering 00:00–24:00 — a day with one 9am task
 * should not open on fourteen empty rows.
 */

const HOUR_HEIGHT = 56;
const GUTTER_WIDTH = 46;
/** Enough vertical room that a 15-minute block still shows its title. */
const MIN_BLOCK_HEIGHT = 26;
/** A grid tighter than this is cramped, so short days get breathing room. */
const MIN_VISIBLE_HOURS = 4;

interface Entry { item: CalendarItem; range: TimeRange }
interface PlacedEntry extends Entry { column: number; columns: number }

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

export default function TimelineView({ dateKey, items }: {
  dateKey: string;
  items: CalendarItem[];
}) {
  const Colors = useTheme();

  const entries = useMemo(() => {
    const found: Entry[] = [];
    for (const item of items) {
      const range = itemTimeRange(item);
      if (range) found.push({ item, range });
    }
    return found;
  }, [items]);

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

          {placed.map((entry, idx) => {
            const color = typeColor(entry.item.type, Colors);
            const done = itemIsDone(entry.item);
            const top = offsetFor(entry.range.start);
            const height = Math.max(
              MIN_BLOCK_HEIGHT,
              ((entry.range.end - entry.range.start) / 60) * HOUR_HEIGHT,
            );
            const widthPct = 100 / entry.columns;

            return (
              <View
                key={`${entry.item.type}-${idx}`}
                accessibilityRole="text"
                accessibilityLabel={`${itemTitle(entry.item)}, ${formatTimeRange(entry.range)}`}
                style={{
                  position: 'absolute',
                  top,
                  height,
                  left: `${entry.column * widthPct}%`,
                  width: `${widthPct}%`,
                  paddingRight: 4,
                  paddingTop: 1,
                }}
              >
                <View style={{
                  flex: 1,
                  backgroundColor: Colors.surface,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                  borderRadius: 7,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  overflow: 'hidden',
                  opacity: done ? 0.55 : 1,
                }}>
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
                </View>
              </View>
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
