import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, GoogleCalendarEvent, TaskGoal } from '../../types';
import { formatDeadlineLabel } from '../../utils/date';
import { getCalendarStyles, itemIsDone, itemTitle, typeColor } from './shared';

/**
 * A single calendar entry. Used by every view so a task, habit or external event
 * looks identical wherever it appears.
 */
export default function ItemRow({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const done = itemIsDone(item);
  const color = typeColor(item.type, Colors);

  // External events show their start time; goal deadlines show urgency instead.
  let meta: string | null = null;
  if (item.type === 'external_google' || item.type === 'external_apple') {
    const event = item.data as GoogleCalendarEvent;
    meta = event.isAllDay || !event.startTime
      ? 'All day'
      : new Date(event.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
