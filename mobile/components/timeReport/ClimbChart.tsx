import { useMemo, useState } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import { formatSeconds } from '../../lib/taskMetrics';
import {
  areaPath, linePath, indexAtX, dayLabel, monthYearLabel, compactHours, type ClimbPoint,
} from '../../lib/timeAnalytics';

/**
 * The climb: every focused hour since the first session, as one line that
 * only ever rises. Drag (or tap) across it to read the running total on any
 * day.
 *
 * Drawn with react-native-svg rather than a chart library: one path, one fill,
 * one dashed milestone rule. A library would have added a native module (and
 * a store build) for shapes this small.
 *
 * The gesture runs on the JS thread (`runOnJS(true)`): the only work per move
 * is picking an index and re-rendering a dot, which is cheap at ≤120 points.
 * `activeOffsetX` / `failOffsetY` let a vertical drag fall through to the
 * scroll view, so the chart never traps the page.
 */

const PAD_TOP = 8;

export default function ClimbChart({ points, milestoneSeconds, height = 150 }: {
  points: ClimbPoint[];
  /** The next milestone, drawn as a dashed rule when it fits the scale. */
  milestoneSeconds?: number;
  height?: number;
}) {
  const Colors = useTheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState<number | null>(null);

  const last = points[points.length - 1];
  const total = last?.total ?? 0;
  // Headroom to the milestone so the line visibly reaches for it.
  const max = Math.max(total, milestoneSeconds ?? 0, 1) * 1.04;
  const plotH = height - PAD_TOP;
  const values = useMemo(() => points.map((p) => p.total), [points]);

  const paths = useMemo(() => (width > 0 ? {
    area: areaPath(values, width, plotH, max),
    line: linePath(values, width, plotH, max),
  } : null), [values, width, plotH, max]);

  const pick = (x: number) => setIndex(indexAtX(x, width, points.length));
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onUpdate((e) => pick(e.x))
    .onFinalize(() => setIndex(null));
  const tap = Gesture.Tap().runOnJS(true).onEnd((e) => pick(e.x));
  const gesture = Gesture.Exclusive(pan, tap);

  const selected = index !== null ? points[index] : null;
  const dotX = index !== null && points.length > 1 ? (index / (points.length - 1)) * width : 0;
  const dotY = selected ? PAD_TOP + plotH - (selected.total / max) * plotH : 0;
  const milestoneY = milestoneSeconds ? PAD_TOP + plotH - (milestoneSeconds / max) * plotH : null;

  const summary = last
    ? `Cumulative focus time, rising from ${monthYearLabel(points[0].date)} to ${formatSeconds(total)} today.`
    : 'No focus time yet.';

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono, minHeight: 18 }}>
        {selected ? `${dayLabel(selected.date)} · ${formatSeconds(selected.total)}` : ' '}
      </Text>
      <GestureDetector gesture={gesture}>
        <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          {paths && (
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="climbFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={Colors.primary} stopOpacity={0.35} />
                  <Stop offset="1" stopColor={Colors.primary} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              {milestoneY !== null && (
                <Line
                  x1={0} x2={width} y1={milestoneY} y2={milestoneY}
                  stroke={Colors.subtext} strokeWidth={1} strokeDasharray="4 4"
                />
              )}
              <Path d={paths.area} fill="url(#climbFill)" transform={`translate(0 ${PAD_TOP})`} />
              <Path
                d={paths.line} fill="none" stroke={Colors.primary} strokeWidth={2.5}
                strokeLinejoin="round" strokeLinecap="round" transform={`translate(0 ${PAD_TOP})`}
              />
              {selected && (
                <>
                  <Line x1={dotX} x2={dotX} y1={0} y2={height} stroke={Colors.border} strokeWidth={1} />
                  <Circle cx={dotX} cy={dotY} r={4.5} fill={Colors.primary} stroke={Colors.bg} strokeWidth={2} />
                </>
              )}
            </Svg>
          )}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: Space.xs }}>
        <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
          {points[0] ? monthYearLabel(points[0].date) : ''}
        </Text>
        {milestoneSeconds ? (
          <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
            next: {compactHours(milestoneSeconds)}
          </Text>
        ) : null}
        <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>Today</Text>
      </View>
    </View>
  );
}
