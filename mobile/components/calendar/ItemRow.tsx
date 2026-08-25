import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, TaskGoal } from '../../types';
import { formatDeadlineLabel } from '../../utils/date';
import {
  getCalendarStyles, itemIsDone, itemTimeRange, itemTitle, isPastEvent,
  formatMinutes, typeColor, TYPE_META,
} from './shared';

/**
 * A single calendar entry. Used by every view so a task, event or external
 * event looks identical wherever it appears.
 */
export default function ItemRow({ item, compact, onPress }: {
  item: CalendarItem;
  compact?: boolean;
  /**
   * Opens the item. Only reaches UNTIMED items here — DayView's agenda filters
   * to those, and anything with a time is drawn by TimelineView instead, which
   * takes its own handler. For an event that means this covers all-day ones.
   */
  onPress?: () => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const done = itemIsDone(item);
  const past = isPastEvent(item, new Date());
  const color = typeColor(item.type, Colors);

  // Anything with a slot shows when it starts — a scheduled task and an external
  // event read the same way. Untimed items fall back to whatever else is worth
  // saying: all-day for events, urgency for a goal deadline.
  let meta: string | null = null;
  const range = itemTimeRange(item);
  if (range) {
    meta = formatMinutes(range.start);
  } else if (item.type === 'event' || item.type === 'external_google' || item.type === 'external_apple') {
    meta = 'All day';
  } else if (item.type === 'goal_deadline') {
    meta = formatDeadlineLabel((item.data as TaskGoal).deadline);
  }

  const label = `${TYPE_META[item.type].label}: ${itemTitle(item)}${meta ? `, ${meta}` : ''}${done ? ', done' : ''}${past ? ', past' : ''}`;

  const body = (
    <>
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
    </>
  );

  const style = [
    styles.itemRow,
    compact && { paddingVertical: 5 },
    past && { opacity: 0.55 },
  ];

  // A plain View when nothing handles a tap, so the row never looks pressable
  // and then does nothing.
  if (!onPress) {
    return <View style={style} accessibilityRole="text" accessibilityLabel={label}>{body}</View>;
  }

  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </TouchableOpacity>
  );
}
