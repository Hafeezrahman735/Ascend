import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import type { CalendarItem } from '../../types';
import { eachDayOfRange, getLocalDateString, parseLocalDate, startOfMonth, endOfMonth } from '../../utils/date';
import { itemTitle, itemIsDone, typeColor, itemTimeRange, formatMinutes, formatSeconds } from './shared';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Hours booked that read as a light, a moderate, and a full day. */
const MODERATE_MINUTES = 2 * 60;
const BUSY_MINUTES = 4 * 60;

/**
 * Month as a workload grid.
 *
 * Cells are shaded by how much of the day is spoken for, not by which item types
 * are present. The old version drew one coloured dot per type, which answered
 * "what kind of thing is on the 12th" — a question nobody asks at month zoom.
 * The question at this zoom is "which week am I going to regret", and shading
 * answers it without reading a single word.
 *
 * Days with items but no times still shade, one step down, so an untimed day is
 * never mistaken for an empty one.
 */

type Load = 'empty' | 'light' | 'moderate' | 'busy';

function dayLoad(items: CalendarItem[]): { load: Load; bookedMinutes: number } {
  const scheduled = items.filter((i) => i.type !== 'note');
  if (scheduled.length === 0) return { load: 'empty', bookedMinutes: 0 };

  let booked = 0;
  for (const item of scheduled) {
    const range = itemTimeRange(item);
    if (range) booked += range.end - range.start;
  }

  // Nothing carries a time — fall back to count so the day still reads as used.
  if (booked === 0) return { load: scheduled.length >= 3 ? 'moderate' : 'light', bookedMinutes: 0 };
  if (booked >= BUSY_MINUTES) return { load: 'busy', bookedMinutes: booked };
  if (booked >= MODERATE_MINUTES) return { load: 'moderate', bookedMinutes: booked };
  return { load: 'light', bookedMinutes: booked };
}

function cellColors(load: Load, Colors: ThemeColors): { bg: string; fg: string } {
  switch (load) {
    case 'busy':     return { bg: Colors.primary, fg: '#fff' };
    case 'moderate': return { bg: Colors.primaryDim, fg: Colors.textBright };
    case 'light':    return { bg: Colors.raised, fg: Colors.text };
    default:         return { bg: Colors.raised, fg: Colors.subtext };
  }
}

function StatTile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  const Colors = useTheme();
  return (
    <View style={{
      flex: 1, backgroundColor: Colors.raised, borderRadius: 10,
      paddingVertical: 9, alignItems: 'center',
    }}>
      <Text style={{
        fontSize: 15, fontWeight: '700',
        color: accent ? Colors.AMBER : Colors.textBright,
      }}>
        {value}
      </Text>
      <Text style={{ fontSize: 9, color: Colors.subtext, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export default function MonthView({
  anchorDate,
  itemsByDate,
  onDayPress,
}: {
  anchorDate: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (date: string) => void;
}) {
  const Colors = useTheme();
  const first = useMemo(() => startOfMonth(anchorDate), [anchorDate]);
  const days = useMemo(() => eachDayOfRange(first, endOfMonth(anchorDate)), [first, anchorDate]);
  const leadingBlanks = first.getDay();
  const todayKey = getLocalDateString();

  // The panel below follows the grid. DERIVED, not synced in an effect: paging
  // to another month makes the stored key fall out of `days` and the fallback
  // takes over on the same render, so the panel can never describe a day that
  // is not visible above it.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selectedKey = pickedKey && days.includes(pickedKey)
    ? pickedKey
    : (days.includes(todayKey) ? todayKey : days[0]);

  const selectedItems = itemsByDate.get(selectedKey) ?? [];
  const selectedScheduled = selectedItems.filter((i) => i.type !== 'note');
  const { bookedMinutes } = dayLoad(selectedItems);
  const taskCount = selectedScheduled.filter(
    (i) => i.type === 'task' || i.type === 'habit_instance',
  ).length;
  const eventCount = selectedScheduled.length - taskCount;

  return (
    <View>
      {/* ── Legend ────────────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', gap: 14, justifyContent: 'flex-end',
        paddingHorizontal: 16, marginBottom: 10,
      }}>
        {([['light', Colors.raised], ['busy', Colors.primary]] as const).map(([label, color]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: color }} />
            <Text style={{ fontSize: 10, color: Colors.subtext }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text
              key={i}
              style={{ flex: 1, textAlign: 'center', fontSize: 9, color: Colors.subtext }}
            >
              {d}
            </Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
              <View style={{ aspectRatio: 1 }} />
            </View>
          ))}

          {days.map((dateKey) => {
            const dayItems = itemsByDate.get(dateKey) ?? [];
            const { load, bookedMinutes: booked } = dayLoad(dayItems);
            const isSelected = dateKey === selectedKey;
            const isToday = dateKey === todayKey;
            const { bg, fg } = cellColors(load, Colors);

            return (
              <View key={dateKey} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
                <TouchableOpacity
                  onPress={() => setPickedKey(dateKey)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${parseLocalDate(dateKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${load === 'empty' ? 'nothing scheduled' : `${booked > 0 ? `${Math.round(booked / 60 * 10) / 10} hours booked` : `${dayItems.length} scheduled`}`}`}
                  style={{
                    aspectRatio: 1, borderRadius: 8,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isSelected ? Colors.primary : bg,
                    borderWidth: isSelected || isToday ? 2 : 0,
                    borderColor: isSelected ? Colors.primarySoft : Colors.primary,
                  }}
                >
                  <Text style={{
                    fontSize: isSelected ? 11 : 10,
                    fontWeight: isSelected || isToday ? '700' : '500',
                    color: isSelected ? '#fff' : isToday ? Colors.primary : fg,
                  }}>
                    {parseLocalDate(dateKey).getDate()}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Live panel for the selected day ───────────────────────────── */}
      <View style={{
        margin: 16, padding: 15,
        backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary,
        borderRadius: 16,
      }}>
        <TouchableOpacity
          onPress={() => onDayPress(selectedKey)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${parseLocalDate(selectedKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} in Day view`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 11 }}
        >
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textBright }}>
            {parseLocalDate(selectedKey).toLocaleDateString(undefined, {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.primarySoft }}>
            {selectedScheduled.length} SCHEDULED
          </Text>
          <Ionicons name="chevron-forward" size={13} color={Colors.subtext} />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 11 }}>
          <StatTile value={bookedMinutes > 0 ? formatSeconds(bookedMinutes * 60) : '—'} label="booked" />
          <StatTile value={String(taskCount)} label={taskCount === 1 ? 'task' : 'tasks'} />
          <StatTile value={String(eventCount)} label={eventCount === 1 ? 'event' : 'events'} accent={eventCount > 0} />
        </View>

        {selectedScheduled.length === 0 ? (
          <Text style={{ color: Colors.subtext, fontSize: 12.5 }}>Nothing on this day.</Text>
        ) : (
          selectedScheduled.slice(0, 4).map((item, idx) => {
            const range = itemTimeRange(item);
            const done = itemIsDone(item);
            return (
              <View
                key={`${item.type}-${idx}`}
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
                    flex: 1, fontSize: 12.5,
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
          })
        )}

        {selectedScheduled.length > 4 && (
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 6 }}>
            +{selectedScheduled.length - 4} more
          </Text>
        )}
      </View>
    </View>
  );
}
