import { useMemo } from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, CalendarItemType } from '../../types';
import { eachDayOfRange, getLocalDateString, parseLocalDate, startOfMonth, endOfMonth } from '../../utils/date';
import { getCalendarStyles, typeColor, TYPE_META } from './shared';

const SCREEN_W = Dimensions.get('window').width;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** Max density dots per cell — beyond this a "+N" counter reads better. */
const MAX_DOTS = 4;

/**
 * Month grid. Cells show density indicators (one dot per item type present),
 * not item text — at this zoom level the useful question is "how busy was that
 * day", and tapping through to Day view answers "with what".
 */
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
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);

  const first = startOfMonth(anchorDate);
  const days = useMemo(() => eachDayOfRange(first, endOfMonth(anchorDate)), [anchorDate]);
  const leadingBlanks = first.getDay();
  const todayKey = getLocalDateString(new Date());
  const cellW = (SCREEN_W - 24) / 7;

  return (
    <View style={{ paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_INITIALS.map((d, i) => (
          <View key={i} style={{ width: cellW, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ color: Colors.subtext, fontSize: 11, fontWeight: '700' }}>{d}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <View key={`blank-${i}`} style={{ width: cellW, height: 62 }} />
        ))}

        {days.map((dateKey) => {
          const dayItems = itemsByDate.get(dateKey) ?? [];
          const isToday = dateKey === todayKey;
          const presentTypes = [...new Set(dayItems.map((i) => i.type))].slice(0, MAX_DOTS);

          return (
            <TouchableOpacity
              key={dateKey}
              onPress={() => onDayPress(dateKey)}
              accessibilityRole="button"
              accessibilityLabel={`${dateKey}, ${dayItems.length} items`}
              style={[
                styles.monthCell,
                { width: cellW },
                isToday && { backgroundColor: Colors.primaryDim, borderRadius: 10 },
              ]}
            >
              <Text
                style={{
                  color: isToday ? Colors.primary : Colors.text,
                  fontSize: 13,
                  fontWeight: isToday ? '800' : '500',
                }}
              >
                {parseLocalDate(dateKey).getDate()}
              </Text>
              <View style={{ flexDirection: 'row', gap: 3, marginTop: 4, height: 6 }}>
                {presentTypes.map((t) => (
                  <View
                    key={t}
                    style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: typeColor(t, Colors) }}
                  />
                ))}
              </View>
              {dayItems.length > MAX_DOTS && (
                <Text style={{ color: Colors.subtext, fontSize: 8 }}>+{dayItems.length - MAX_DOTS}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Legend />
    </View>
  );
}

function Legend() {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 14, justifyContent: 'center' }}>
      {(Object.keys(TYPE_META) as CalendarItemType[]).map((t) => (
        <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: typeColor(t, Colors) }} />
          <Text style={{ color: Colors.subtext, fontSize: 10 }}>{TYPE_META[t].label}</Text>
        </View>
      ))}
    </View>
  );
}
