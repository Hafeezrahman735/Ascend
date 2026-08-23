import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, TaskGoal } from '../../types';
import { formatDeadlineLabel } from '../../utils/date';
import {
  getCalendarStyles, itemIsDone, itemTimeRange, itemTitle, formatMinutes, typeColor,
} from './shared';

/**
 * A single calendar entry. Used by every view so a task, habit or external event
 * looks identical wherever it appears.
 */
export default function ItemRow({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const done = itemIsDone(item);
  const color = typeColor(item.type, Colors);

  // Anything with a slot shows when it starts — a scheduled task and an external
  // event read the same way. Untimed items fall back to whatever else is worth
  // saying: all-day for external events, urgency for a goal deadline.
  let meta: string | null = null;
  const range = itemTimeRange(item);
  if (range) {
    meta = formatMinutes(range.start);
  } else if (item.type === 'external_google' || item.type === 'external_apple') {
    meta = 'All day';
  } else if (item.type === 'goal_deadline') {
    meta = formatDeadlineLabel((item.data as TaskGoal).deadline);
  }

  return (
    <View style={[styles.itemRow, compact && { paddingVertical: 5 }]}>
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color }} />
      <Text
        style={{
          flex: 1,
          color: done ? Colors.subtext : Colors.text,
          fontSize: compact ? 12 : 14,
          textDecorationLine: done ? 'line-through' : 'none',
        }}
        numberOfLines={compact ? 1 : 2}
      >
        {itemTitle(item)}
      </Text>
      {meta && <Text style={{ color: Colors.subtext, fontSize: 10 }}>{meta}</Text>}
    </View>
  );
}
