import { useMemo } from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem } from '../../types';
import {
  getLocalDateString, startOfMonth, endOfMonth, eachDayOfRange, parseLocalDate,
} from '../../utils/date';

const SCREEN_W = Dimensions.get('window').width;
/** Sessions in a day before the cell renders at full intensity. */
const HEAVY_DAY_SESSIONS = 8;

/**
 * Month heat grid — focus intensity per day.
 *
 * Moved here from the Tasks tab, which had its own parallel calendar. It answers
 * a different question from MonthView above it: MonthView shows *what is
 * scheduled* on each day, this shows *how much work actually happened*. A dot
 * marks days with something due.
 *
 * Session counts come from GET /calendar/stats (`sessionsPerDay`), which buckets
 * by the user's timezone — a session at 11pm local would otherwise land on the
 * next day.
 */
export default function SessionHeatGrid({
  anchorDate,
  sessionsPerDay,
  itemsByDate,
  onDayPress,
}: {
  anchorDate: Date;
  sessionsPerDay: Record<string, number>;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (date: string) => void;
}) {
  const Colors = useTheme();

  const first = startOfMonth(anchorDate);
  const days = useMemo(() => eachDayOfRange(first, endOfMonth(anchorDate)), [anchorDate]);
  const todayKey = getLocalDateString(new Date());

  // Monday-first grid, matching the original Tasks-tab layout.
  const firstDayOfWeek = first.getDay();
  const padding = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const cells: (string | null)[] = [
    ...Array.from({ length: padding }, () => null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const cellSize = Math.floor((SCREEN_W - 40 - 12) / 7);

  // "N of M days" counts only elapsed days — crediting the rest of the month as
  // missed would make every month look bad until the 31st.
  const elapsed = days.filter((d) => d <= todayKey);
  const daysWithSessions = elapsed.filter((d) => (sessionsPerDay[d] ?? 0) > 0).length;

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '700' }}>
          Focus days
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 12 }}>
          {daysWithSessions} of {elapsed.length} days
        </Text>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <View key={i} style={{ width: cellSize, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, color: Colors.subtext, fontWeight: '600' }}>{d}</Text>
          </View>
        ))}
      </View>

      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', marginBottom: 2 }}>
          {row.map((dateKey, ci) => {
            if (!dateKey) return <View key={ci} style={{ width: cellSize, height: cellSize }} />;

            const count = sessionsPerDay[dateKey] ?? 0;
            const isToday = dateKey === todayKey;
            const isFuture = dateKey > todayKey;
            const hasSession = !isFuture && count > 0;
            const isHeavy = hasSession && count >= HEAVY_DAY_SESSIONS;
            // Any scheduled item — task, habit, goal deadline — marks the day.
            const hasScheduled = (itemsByDate.get(dateKey)?.length ?? 0) > 0;

            const opacity = isToday ? 1 : isFuture ? 0.15 : hasSession ? (isHeavy ? 1 : 0.7) : 0.25;

            return (
              <TouchableOpacity
                key={ci}
                onPress={() => onDayPress(dateKey)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`${dateKey}, ${count} sessions`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  borderRadius: 6,
                  backgroundColor: isToday ? 'transparent' : hasSession ? Colors.primary : Colors.inactive,
                  opacity,
                  borderWidth: isToday ? 2 : 0,
                  borderColor: isToday ? Colors.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 8,
                    fontWeight: '700',
                    color: isToday ? Colors.primary : hasSession ? 'rgba(255,255,255,0.8)' : Colors.subtext,
                  }}
                >
                  {parseLocalDate(dateKey).getDate()}
                </Text>
                {hasScheduled && (
                  <View
                    style={{
                      width: 3, height: 3, borderRadius: 2, marginTop: 1,
                      backgroundColor: isToday ? Colors.primary : Colors.ROSE,
                    }}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}
