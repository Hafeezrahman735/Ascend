import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { addDays, getLocalDateString, parseLocalDate } from '../../utils/date';

/**
 * Seven chips for the days of one week, for choosing which day something lands on.
 *
 * Constrained to the week the calendar is currently anchored to, on purpose. A
 * free date picker would let the user create an item outside the loaded range,
 * where it appears optimistically and then vanishes on the next refetch — the
 * range is `{gte, lte}` on the server. Limiting the choice to the visible week
 * makes that failure unreachable rather than handled, and the week chevrons at
 * the top of the tab are how you reach any other week.
 */
export default function DayPickerRow({
  weekStart,
  selected,
  onSelect,
}: {
  weekStart: Date;
  /** 'YYYY-MM-DD' */
  selected: string;
  onSelect: (dateKey: string) => void;
}) {
  const Colors = useTheme();
  const todayKey = getLocalDateString();

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => getLocalDateString(addDays(weekStart, i))),
    [weekStart],
  );

  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {days.map((dateKey) => {
        const day = parseLocalDate(dateKey);
        const isSelected = dateKey === selected;
        const isToday = dateKey === todayKey;

        return (
          <TouchableOpacity
            key={dateKey}
            onPress={() => onSelect(dateKey)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={day.toLocaleDateString(undefined, {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
            style={{
              flex: 1, alignItems: 'center', borderRadius: 11, paddingVertical: 9,
              backgroundColor: isSelected ? Colors.primary : Colors.raised,
              borderWidth: 1,
              borderColor: isSelected ? Colors.primary : isToday ? Colors.primaryDim : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 9, fontWeight: '700',
              color: isSelected ? '#fff' : Colors.subtext,
            }}>
              {day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase()}
            </Text>
            <Text style={{
              fontSize: 13, fontWeight: '700', marginTop: 2,
              color: isSelected ? '#fff' : isToday ? Colors.primarySoft : Colors.textBright,
            }}>
              {day.getDate()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
