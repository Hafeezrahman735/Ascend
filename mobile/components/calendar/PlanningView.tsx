import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTaskStore } from '../../stores/taskStore';
import type { CalendarItem, CalendarStats } from '../../types';
import { addDays, getLocalDateString } from '../../utils/date';
import { getCalendarStyles, itemTimeRange, formatSeconds } from './shared';
import StatsView from './StatsView';

/**
 * The Planning tab — first in the row, because deciding what to work on comes
 * before looking at any particular day.
 *
 * Two modes behind one toggle. Planning is forward-looking: what has no home
 * yet, and which day could take it. Stats is backward-looking: what actually
 * happened. They answer opposite questions about the same week, which is why
 * they share a tab rather than competing for two.
 */

type Mode = 'plan' | 'stats';

/** Minutes of work already placed on a day, from items that carry a time. */
function bookedMinutes(items: CalendarItem[]): number {
  let total = 0;
  for (const item of items) {
    const range = itemTimeRange(item);
    if (range) total += range.end - range.start;
  }
  return total;
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const Colors = useTheme();
  const options: { key: Mode; label: string }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'stats', label: 'Stats' },
  ];

  return (
    <View style={{
      flexDirection: 'row', gap: 3, padding: 3, alignSelf: 'flex-start',
      backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
      borderRadius: 10, marginHorizontal: 16, marginBottom: 14,
    }}>
      {options.map((option) => {
        const selected = mode === option.key;
        return (
          <TouchableOpacity
            key={option.key}
            onPress={() => onChange(option.key)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8,
              backgroundColor: selected ? Colors.primary : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 12, fontWeight: '700', letterSpacing: 0.5,
              color: selected ? '#fff' : Colors.subtext,
            }}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function PlanningView({
  stats,
  weekStart,
  itemsByDate,
  onDayPress,
}: {
  stats: CalendarStats | null;
  /** First day of the week this tab is showing. */
  weekStart: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (dateKey: string) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const [mode, setMode] = useState<Mode>('plan');

  const tasks = useTaskStore((s) => s.tasks);

  // Work with no home yet. A task with no due date appears on no day in the
  // calendar at all, so this list is the only place it is visible here.
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.isCompleted && !t.isArchived && !t.dueDate),
    [tasks],
  );

  const days = useMemo(() => {
    const today = getLocalDateString();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const key = getLocalDateString(date);
      const items = itemsByDate.get(key) ?? [];
      return {
        key,
        date,
        isToday: key === today,
        isPast: key < today,
        booked: bookedMinutes(items),
        count: items.filter((item) => item.type !== 'note').length,
      };
    });
  }, [weekStart, itemsByDate]);

  if (mode === 'stats') {
    return (
      <View>
        <ModeToggle mode={mode} onChange={setMode} />
        <StatsView stats={stats} />
      </View>
    );
  }

  return (
    <View>
      <ModeToggle mode={mode} onChange={setMode} />

      <View style={{ paddingHorizontal: 16 }}>
        {/* ── Unscheduled ─────────────────────────────────────────────── */}
        <Text style={{
          color: unscheduled.length > 0 ? Colors.AMBER : Colors.subtext,
          fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10,
        }}>
          UNSCHEDULED · {unscheduled.length}
        </Text>

        {unscheduled.length === 0 ? (
          <View style={[styles.emptyBox, { marginBottom: 20 }]}>
            <Ionicons name="checkmark-done-outline" size={24} color={Colors.subtext} />
            <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13 }}>
              Everything has a day. Nothing waiting to be placed.
            </Text>
          </View>
        ) : (
          <View style={{
            backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1,
            borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 4,
            marginBottom: 20,
          }}>
            {unscheduled.map((task) => (
              <View key={task.id} style={styles.itemRow}>
                <View style={{
                  width: 3, alignSelf: 'stretch', borderRadius: 2,
                  backgroundColor: task.estimatedMinutes ? Colors.primary : Colors.subtext,
                }} />
                <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>
                  {task.title}
                </Text>
                {task.estimatedMinutes ? (
                  <Text style={{ color: Colors.subtext, fontSize: 10 }}>
                    {task.estimatedMinutes}m
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* ── Where it could go ───────────────────────────────────────── */}
        <Text style={{
          color: Colors.subtext, fontSize: 10, fontWeight: '700',
          letterSpacing: 1.2, marginBottom: 10,
        }}>
          THIS WEEK
        </Text>

        <View style={{ flexDirection: 'row', gap: 5, marginBottom: 6 }}>
          {days.map((day) => (
            <TouchableOpacity
              key={day.key}
              onPress={() => onDayPress(day.key)}
              accessibilityRole="button"
              accessibilityLabel={`${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${day.count} scheduled, ${Math.round(day.booked / 60 * 10) / 10} hours planned`}
              style={{
                flex: 1, alignItems: 'center', borderRadius: 11, paddingVertical: 10,
                backgroundColor: day.isToday ? Colors.primaryDim : Colors.raised,
                borderWidth: 1,
                borderColor: day.isToday ? Colors.primary : 'transparent',
                opacity: day.isPast ? 0.5 : 1,
              }}
            >
              <Text style={{
                fontSize: 9, fontWeight: '700',
                color: day.isToday ? Colors.primarySoft : Colors.subtext,
              }}>
                {day.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Text>
              <Text style={{
                fontSize: 13, fontWeight: '700', marginTop: 2,
                color: day.isToday ? Colors.primarySoft : Colors.textBright,
              }}>
                {day.date.getDate()}
              </Text>
              <Text style={{
                fontSize: 9, marginTop: 3,
                color: day.booked > 0 ? Colors.primarySoft : Colors.subtext,
              }}>
                {day.booked > 0 ? formatSeconds(day.booked * 60) : '—'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Deliberately reports time PLANNED rather than time "free". Free hours
            would need a working-day budget nobody has set, and inventing one
            would make the most prominent number on the screen a guess. */}
        <Text style={{ color: Colors.subtext, fontSize: 11, marginBottom: 24 }}>
          Hours already planned on each day. Tap a day to open it.
        </Text>
      </View>
    </View>
  );
}
