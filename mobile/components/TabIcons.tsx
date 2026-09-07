import { useId } from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../hooks/useTheme';

/**
 * The five tab-bar icons, drawn as one set.
 *
 * These replace the Ionicons filled/outline pairs. Ionicons swapped SHAPE on
 * selection — an outline icon became a solid one — which read as five unrelated
 * glyphs that each did their own thing when tapped. Here every icon is the same
 * line drawing at every state, on the same 24-unit grid at the same weight, and
 * selection is carried by colour and a slightly heavier stroke alone. That is
 * what makes them look like a set rather than five borrowed pictures.
 *
 * Ascend is the exception, and deliberately: its tail and dot stay in the `accent`
 * colour whether or not the tab is selected, because that mark is the brand and
 * it should not go grey. Only its track ring picks up the active/inactive tint.
 */

type IconProps = {
  /**
   * Supplied by the navigator from tabBarActive/InactiveTintColor. ColorValue,
   * not string: React Navigation may hand back a platform colour object.
   */
  color: ColorValue;
  focused: boolean;
  size?: number;
};

const SIZE = 22;

function strokeWidth(focused: boolean): number {
  return focused ? 2 : 1.8;
}

/** Ascend-tail, small. The same geometry as components/AscendMark. */
export function AscendTabIcon({ color, focused, size = SIZE }: IconProps) {
  const Colors = useTheme();
  const gradientId = `tab-orbit-tail-${useId()}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0.1" y1="0.95" x2="0.5" y2="0.05">
          <Stop offset="0" stopColor={Colors.accent} stopOpacity={0} />
          <Stop offset="1" stopColor={Colors.accent} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={focused ? 2.2 : 1.8} />
      <Path d="M4 12 A8 8 0 0 1 12 4" stroke={`url(#${gradientId})`} strokeWidth={2.4} strokeLinecap="round" />
      <Circle cx={12} cy={4} r={2.6} fill={Colors.accent} />
    </Svg>
  );
}

/** A timer: dial, hand, and the stem across the top. */
export function FocusTabIcon({ color, focused, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={13.5} r={7.5} stroke={color} strokeWidth={strokeWidth(focused)} />
      <Path d="M12 13.5 V9.5 M9 2.5 h6" stroke={color} strokeWidth={strokeWidth(focused)} strokeLinecap="round" />
    </Svg>
  );
}

/** A checked box. */
export function TasksTabIcon({ color, focused, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4} width={16} height={16} rx={4.5} stroke={color} strokeWidth={strokeWidth(focused)} />
      <Path d="M8.5 12.2 l2.6 2.6 l4.6 -5.2" stroke={color} strokeWidth={strokeWidth(focused)} strokeLinecap="round" />
    </Svg>
  );
}

/** A month grid with its two binder rings. */
export function CalendarTabIcon({ color, focused, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5.5} width={17} height={15} rx={3.5} stroke={color} strokeWidth={strokeWidth(focused)} />
      <Path d="M8 3 v3 M16 3 v3 M3.5 10.5 h17" stroke={color} strokeWidth={strokeWidth(focused)} strokeLinecap="round" />
    </Svg>
  );
}

/** Head and shoulders. */
export function ProfileTabIcon({ color, focused, size = SIZE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.8} stroke={color} strokeWidth={strokeWidth(focused)} />
      <Path d="M5 20 q2.6 -5.2 7 -5.2 t7 5.2" stroke={color} strokeWidth={strokeWidth(focused)} strokeLinecap="round" />
    </Svg>
  );
}
