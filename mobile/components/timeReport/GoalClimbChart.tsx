import { useMemo, useState } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import { formatSeconds } from '../../lib/taskMetrics';
import { goalClimb, linePath, areaPath, indexAtX, dayLabel } from '../../lib/timeAnalytics';
import { useGoalDaily } from '../../hooks/useTimeReport';
import type { TaskGoal } from '../../types';
import { SkeletonBlocks, ErrorRetry } from './parts';

/**
 * One goal's climb: the solid line is focus time so far, the dashed line is
 * where an even schedule from the goal's start would put it, reaching the plan
 * on the deadline. Drag or tap to read any day.
 *
 * Same drawing and gesture approach as ClimbChart; see the note there. The
 * series comes from /time-report/goals/:id/daily, which follows each task's
 * current goal, so the line ends on the total printed above it.
 */

const HEIGHT = 120;
const PAD_TOP = 6;

export default function GoalClimbChart({ goal, today }: { goal: TaskGoal; today: string }) {
  const Colors = useTheme();
  const { goalDaily, loading, error, reload } = useGoalDaily(goal.id);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState<number | null>(null);

  const climb = useMemo(() => (goalDaily ? goalClimb({
    daily: goalDaily.daily,
    startDay: goalDaily.startDay,
    today,
    deadline: goal.deadline,
    plannedMinutes: goal.plannedMinutes,
  }) : null), [goalDaily, today, goal.deadline, goal.plannedMinutes]);

  if (!goalDaily && loading) return <SkeletonBlocks heights={[HEIGHT]} />;
  if (!climb) {
    return <ErrorRetry title="Could not load this goal's climb" body={error ?? ''} onRetry={reload} />;
  }

  const n = climb.dates.length;
  const plotH = HEIGHT - PAD_TOP;
  const last = climb.actual[climb.actual.length - 1] ?? 0;
  const max = Math.max(last, climb.plannedSeconds ?? 0, 1) * 1.05;
  const xAt = (i: number) => (n > 1 ? (i / (n - 1)) * width : 0);
  const actualWidth = xAt(climb.actual.length - 1);
  const yAt = (v: number) => PAD_TOP + plotH - (v / max) * plotH;
  // A plan with no deadline has no schedule, so the plan shows as a flat rule.
  const planRuleY = climb.plannedSeconds !== null && climb.pace === null ? yAt(climb.plannedSeconds) : null;

  const pick = (x: number) => setIndex(indexAtX(x, width, n));
  const gesture = Gesture.Exclusive(
    Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6]).failOffsetY([-12, 12])
      .onUpdate((e) => pick(e.x)).onFinalize(() => setIndex(null)),
    Gesture.Tap().runOnJS(true).onEnd((e) => pick(e.x)),
  );

  const readout = index !== null
    ? [
        dayLabel(climb.dates[index]),
        index < climb.actual.length ? formatSeconds(climb.actual[index]) : null,
        climb.pace ? `plan ${formatSeconds(climb.pace[index])}` : null,
      ].filter(Boolean).join(' · ')
    : ' ';

  const summary = `Focus on ${goal.title} over time: ${formatSeconds(last)} so far`
    + (climb.plannedSeconds !== null ? ` of ${formatSeconds(climb.plannedSeconds)} planned.` : '.');

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ marginTop: Space.md }}>
      <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono, minHeight: 18 }}>{readout}</Text>
      <GestureDetector gesture={gesture}>
        <View style={{ height: HEIGHT }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && (
            <Svg width={width} height={HEIGHT}>
              {planRuleY !== null && (
                <Line x1={0} x2={width} y1={planRuleY} y2={planRuleY} stroke={Colors.subtext} strokeWidth={1} strokeDasharray="4 4" />
              )}
              {climb.pace && (
                <Path
                  d={linePath(climb.pace, width, plotH, max)} fill="none"
                  stroke={Colors.text} strokeWidth={1.5} strokeDasharray="5 4" transform={`translate(0 ${PAD_TOP})`}
                />
              )}
              <Path d={areaPath(climb.actual, actualWidth, plotH, max)} fill={Colors.primary} fillOpacity={0.15} transform={`translate(0 ${PAD_TOP})`} />
              <Path
                d={linePath(climb.actual, actualWidth, plotH, max)} fill="none" stroke={Colors.primary}
                strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" transform={`translate(0 ${PAD_TOP})`}
              />
              {index !== null && (
                <>
                  <Line x1={xAt(index)} x2={xAt(index)} y1={0} y2={HEIGHT} stroke={Colors.border} strokeWidth={1} />
                  {index < climb.actual.length && (
                    <Circle cx={xAt(index)} cy={yAt(climb.actual[index])} r={4} fill={Colors.primary} stroke={Colors.bg} strokeWidth={2} />
                  )}
                </>
              )}
            </Svg>
          )}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: Space.xs }}>
        <Text style={{ color: Colors.text, fontSize: 11, fontFamily: Font.mono }}>{dayLabel(climb.dates[0])}</Text>
        <Text style={{ color: Colors.text, fontSize: 11, fontFamily: Font.mono }}>
          {climb.pace ? '— done   - - even pace' : climb.plannedSeconds !== null ? '— done   - - plan' : '— done'}
        </Text>
        <Text style={{ color: Colors.text, fontSize: 11, fontFamily: Font.mono }}>
          {n > climb.actual.length ? dayLabel(climb.dates[n - 1]) : 'Today'}
        </Text>
      </View>
    </View>
  );
}
