import { useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { dayLabel, hourLabel, type WeekBar } from '../../lib/timeAnalytics';

/**
 * The small charts: plain Views, no SVG, because a bar is a rectangle.
 * Each carries its own accessibility label, since a screen reader cannot see
 * a bar's height.
 */

const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Monday to Sunday, scaled by time, with the user's daily target as a dashed
 * rule. A day that met the target turns the completion colour. Tap a bar to
 * read it.
 */
export function WeekBars({ bars, targetSeconds, height = 96 }: {
  bars: WeekBar[];
  /** The daily target from the timer settings; 0 hides the rule. */
  targetSeconds: number;
  height?: number;
}) {
  const Colors = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(targetSeconds * 1.15, ...bars.map((b) => b.seconds), 1);
  const targetY = targetSeconds > 0 ? (targetSeconds / max) * height : null;
  const shown = picked !== null ? bars[picked] : bars.find((b) => b.isToday) ?? null;

  return (
    <View>
      <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono, marginBottom: Space.sm }}>
        {shown ? `${dayLabel(shown.date)} · ${shown.isFuture ? 'ahead' : formatSeconds(shown.seconds)}` : ' '}
      </Text>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm }}>
        {targetY !== null && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: targetY,
              borderTopWidth: 1, borderStyle: 'dashed', borderColor: Colors.subtext,
            }}
          />
        )}
        {bars.map((b, i) => {
          const met = targetSeconds > 0 && b.seconds >= targetSeconds;
          const h = b.seconds > 0 ? Math.max(4, (b.seconds / max) * height) : 3;
          return (
            <AppPressable
              key={b.date}
              onPress={() => setPicked(i === picked ? null : i)}
              scaleOnPress={false}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(b.date)}: ${b.isFuture ? 'not yet' : formatSeconds(b.seconds)}${met ? ', target met' : ''}`}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
            >
              <View style={{
                height: h,
                borderRadius: Radius.sm / 2,
                backgroundColor: b.seconds === 0 ? Colors.inactive : met ? Colors.accent : Colors.primary,
                opacity: b.isFuture ? 0.35 : picked === null || picked === i ? 1 : 0.55,
              }} />
            </AppPressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.sm }}>
        {bars.map((b, i) => (
          <Text
            key={b.date}
            style={{
              flex: 1, textAlign: 'center', fontSize: 11, fontFamily: Font.mono,
              color: b.isToday ? Colors.textBright : Colors.text,
              fontWeight: b.isToday ? '700' : '400',
            }}
          >
            {WEEK_LETTERS[i]}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Seven averages, Monday first, as labelled bars. */
export function WeekdayAverageBars({ averages }: { averages: number[] }) {
  const Colors = useTheme();
  const max = Math.max(...averages, 1);
  const best = averages.indexOf(Math.max(...averages));
  return (
    <View style={{ gap: Space.sm }}>
      {averages.map((s, i) => (
        <View
          key={i}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}
          accessible
          accessibilityLabel={`${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}: ${formatSeconds(s)} on average`}
        >
          <Text style={{ width: 28, color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}
          </Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.inactive, overflow: 'hidden' }}>
            <View style={{
              width: `${Math.round((s / max) * 100)}%`, height: 8, borderRadius: 4,
              backgroundColor: Colors.primary, opacity: i === best && s > 0 ? 1 : 0.6,
            }} />
          </View>
          <Text style={{
            width: 56, textAlign: 'right', color: Colors.textBright, fontSize: 12,
            fontFamily: Font.mono, fontVariant: ['tabular-nums'],
          }}>
            {formatSeconds(s)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Twenty-four thin bars, midnight to midnight, with four hour marks. */
export function HourBars({ byHour, height = 64 }: { byHour: number[]; height?: number }) {
  const Colors = useTheme();
  const max = Math.max(...byHour, 1);
  return (
    <View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {byHour.map((s, h) => (
          <View
            key={h}
            style={{
              flex: 1,
              height: s > 0 ? Math.max(3, (s / max) * height) : 2,
              borderRadius: 2,
              backgroundColor: s > 0 ? Colors.primary : Colors.inactive,
              opacity: s === max && s > 0 ? 1 : 0.65,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: Space.xs }}>
        {[0, 6, 12, 18].map((h) => (
          <Text key={h} style={{ color: Colors.text, fontSize: 11, fontFamily: Font.mono }}>{hourLabel(h)}</Text>
        ))}
        <Text style={{ color: Colors.text, fontSize: 11, fontFamily: Font.mono }}>{hourLabel(0)}</Text>
      </View>
    </View>
  );
}

/**
 * Planned vs done as one bar: the track is the plan, the fill is time spent,
 * and the tick is where an even schedule would be today. No tick without a
 * deadline, because then there is no schedule to be on.
 */
export function PaceBar({ done, expected, tone = 'primary' }: {
  /** 0..1 of the plan. */
  done: number;
  /** 0..1 of the plan, or null for no schedule. */
  expected: number | null;
  tone?: 'primary' | 'accent' | 'warning';
}) {
  const Colors = useTheme();
  const fill = tone === 'accent' ? Colors.accent : tone === 'warning' ? Colors.warning : Colors.primary;
  return (
    <View style={{ height: 14, justifyContent: 'center', marginTop: Space.sm }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: Colors.inactive, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(done * 100)}%`, height: 8, borderRadius: 4, backgroundColor: fill }} />
      </View>
      {expected !== null && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, bottom: 0, width: 2, borderRadius: 1,
            left: `${Math.round(expected * 100)}%`, marginLeft: -1, backgroundColor: Colors.textBright,
          }}
        />
      )}
    </View>
  );
}
