import { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { getCalendarStyles } from './shared';

export type AddKind = 'task' | 'event' | 'note';

const BUTTONS: { kind: AddKind; label: string; a11y: string }[] = [
  { kind: 'task', label: 'Task', a11y: 'Add a task' },
  { kind: 'event', label: 'Event', a11y: 'Add an event' },
  { kind: 'note', label: 'Note', a11y: 'Add a note or to-do' },
];

/**
 * + Task / + Event / + Note, shared by Plan, Day and Month so all three look
 * and behave the same. Built from the calendar's `addChip` style, at a 44pt
 * touch height.
 */
export default function AddRow({ onAdd, dayLabel, taskTakesDay = false }: {
  onAdd: (kind: AddKind) => void;
  /** Read out with event/note, e.g. "Friday 18 October", when a day is implied. */
  dayLabel?: string;
  /** Day view's + Task lands on the day too, so it is read out with it. */
  taskTakesDay?: boolean;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {BUTTONS.map((b) => (
        <TouchableOpacity
          key={b.kind}
          onPress={() => onAdd(b.kind)}
          accessibilityRole="button"
          accessibilityLabel={dayLabel && (b.kind !== 'task' || taskTakesDay) ? `${b.a11y} on ${dayLabel}` : b.a11y}
          style={[styles.addChip, { flex: 1, justifyContent: 'center', minHeight: 44 }]}
        >
          <Ionicons name="add" size={14} color={Colors.primarySoft} />
          <Text style={[styles.addChipText, { fontSize: 13 }]}>{b.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
