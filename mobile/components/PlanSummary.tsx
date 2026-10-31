import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { Space, Radius } from '../constants/spacing';
import { summaryLine, type DayPlanVsActual } from '../lib/planVsActual';

/**
 * One day's plan against actual in a line and a bar: focus on planned work
 * (solid), then focus on anything else (lighter), measured against whichever
 * is larger of the plan and the focus. Renders nothing on a day with neither.
 * Used on Today and at the top of the calendar's Day view.
 */
export default function PlanSummary({ totals, style }: {
  totals: DayPlanVsActual['totals'];
  style?: StyleProp<ViewStyle>;
}) {
  const Colors = useTheme();
  const line = summaryLine(totals);
  if (!line) return null;

  const plannedSeconds = totals.plannedMinutes * 60;
  const onPlanSeconds = totals.focusedSeconds - totals.unplannedSeconds;
  const scale = Math.max(plannedSeconds, totals.focusedSeconds, 1);

  return (
    <View
      accessible
      accessibilityLabel={line}
      style={[style, {
        backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
        paddingHorizontal: 14, paddingVertical: 10, gap: Space.sm,
      }]}
    >
      <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {line}
      </Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden', flexDirection: 'row' }}>
        <View style={{ width: `${(onPlanSeconds / scale) * 100}%`, backgroundColor: Colors.primary }} />
        <View style={{ width: `${(totals.unplannedSeconds / scale) * 100}%`, backgroundColor: Colors.primarySoft, opacity: 0.6 }} />
      </View>
    </View>
  );
}
