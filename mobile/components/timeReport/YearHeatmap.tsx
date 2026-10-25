import { memo, useMemo, useState } from 'react';
import { View, Text, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import { formatSeconds } from '../../lib/taskMetrics';
import { dayLabel, HEATMAP_WEEKS, type HeatCell } from '../../lib/timeAnalytics';

/**
 * A rolling year of days, one square each, Monday at the top. Tap a square to
 * read that day.
 *
 * One <Svg> of ~370 <Rect>s, drawn once per width and theme: the grid is
 * memoised separately from the selection, so tapping a day redraws a single
 * outline, not the year. One Tap gesture on the whole grid maps the touch to a
 * cell, instead of 370 pressables.
 */

const MONTH_ROW = 14;
const GAP = 2;
const LEVEL_OPACITY = [0, 0.28, 0.5, 0.75, 1];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function geometry(width: number) {
  const pitch = width / HEATMAP_WEEKS;
  return { pitch, size: Math.max(2, pitch - GAP) };
}

const Grid = memo(function Grid({ cells, width, Colors }: {
  cells: HeatCell[];
  width: number;
  Colors: ThemeColors;
}) {
  const { pitch, size } = geometry(width);
  const months: { col: number; label: string }[] = [];
  for (const c of cells) {
    if (c.row === 0) {
      const day = Number(c.date.slice(8, 10));
      if (day <= 7 && c.col > 0) months.push({ col: c.col, label: MONTHS[Number(c.date.slice(5, 7)) - 1] });
    }
  }
  return (
    <>
      {months.map((m) => (
        <SvgText
          key={`m${m.col}`} x={m.col * pitch} y={10} fontSize={10}
          fill={Colors.text} fontFamily={Font.mono}
        >
          {m.label}
        </SvgText>
      ))}
      {cells.map((c) => (c.isFuture ? null : (
        <Rect
          key={c.date}
          x={c.col * pitch}
          y={MONTH_ROW + c.row * pitch}
          width={size}
          height={size}
          rx={1.5}
          fill={c.level === 0 ? Colors.inactive : Colors.primary}
          fillOpacity={c.level === 0 ? 1 : LEVEL_OPACITY[c.level]}
        />
      )))}
    </>
  );
});

export default function YearHeatmap({ cells }: { cells: HeatCell[] }) {
  const Colors = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<HeatCell | null>(null);
  const { pitch, size } = geometry(width);
  const height = MONTH_ROW + 7 * pitch;

  const byPosition = useMemo(() => new Map(cells.map((c) => [`${c.col}:${c.row}`, c])), [cells]);
  const tap = Gesture.Tap().runOnJS(true).onEnd((e) => {
    if (pitch <= 0) return;
    const col = Math.floor(e.x / pitch);
    const row = Math.floor((e.y - MONTH_ROW) / pitch);
    const cell = byPosition.get(`${col}:${row}`);
    setSelected(cell && !cell.isFuture ? cell : null);
  });

  const active = cells.filter((c) => c.seconds > 0).length;

  return (
    <View>
      <GestureDetector gesture={tap}>
        <View
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: width > 0 ? height : 120 }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Focus by day over the last year: ${active} days with focus.`}
        >
          {width > 0 && (
            <Svg width={width} height={height}>
              <Grid cells={cells} width={width} Colors={Colors} />
              {selected && (
                <Rect
                  x={selected.col * pitch - 1}
                  y={MONTH_ROW + selected.row * pitch - 1}
                  width={size + 2}
                  height={size + 2}
                  rx={2}
                  fill="none"
                  stroke={Colors.textBright}
                  strokeWidth={1.5}
                />
              )}
            </Svg>
          )}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Space.sm }}>
        <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
          {selected
            ? `${dayLabel(selected.date)} · ${selected.seconds > 0 ? formatSeconds(selected.seconds) : 'no focus'}`
            : 'Tap a day'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ color: Colors.text, fontSize: 11, marginRight: 2 }}>less</Text>
          {LEVEL_OPACITY.map((o, i) => (
            <View
              key={i}
              style={{
                width: 9, height: 9, borderRadius: 2,
                backgroundColor: i === 0 ? Colors.inactive : Colors.primary, opacity: i === 0 ? 1 : o,
              }}
            />
          ))}
          <Text style={{ color: Colors.text, fontSize: 11, marginLeft: 2 }}>more</Text>
        </View>
      </View>
    </View>
  );
}
