import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';

/**
 * The receipt.
 *
 * Every card on the Trace feed shares this chrome: who, when and where at the
 * top, the day's numbers in a row, and a trace line ruled underneath. The
 * numbers are the content — there is no headline, no "I crushed it today", and
 * nothing a person writes to make their day sound bigger than it was. A card
 * says what happened and stops, which is the difference between showing up and
 * showing off.
 *
 * The stat row is `TraceStats`, the squiggle is `TraceLine`, and the frame is
 * `TraceCardShell`. They are separate so a post type with a body of its own —
 * an unlocked achievement, a group challenge, someone's written note — can sit
 * inside the same frame instead of getting its own competing card design.
 */

// ─── Trace line ──────────────────────────────────────────────────────────────

/**
 * The thin wave under the stats. Decoration, and the one place the mark's motif
 * is allowed to appear beyond the icon and the Focus ring.
 *
 * Not a data visualisation: it is the same wave on every card and must never be
 * mistaken for one, which is why it carries no axis, no scale and no variation
 * by value. Hidden from screen readers for the same reason.
 */
export function TraceLine() {
  const Colors = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={9} viewBox="0 0 300 9" preserveAspectRatio="none" fill="none">
        <Path
          d="M1 6 q25 -5 50 0 t50 0 t50 0 t50 0 t50 0 t48 0"
          stroke={Colors.trace}
          strokeWidth={1.6}
          strokeLinecap="round"
          opacity={0.6}
        />
      </Svg>
    </View>
  );
}

// ─── Stat row ────────────────────────────────────────────────────────────────

export interface TraceStat {
  label: string;
  value: string;
  /** The streak is the one figure drawn in the brand colour. */
  emphasis?: boolean;
}

export function TraceStats({ stats }: { stats: TraceStat[] }) {
  const Colors = useTheme();
  if (stats.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {stats.map((s) => (
        <View key={s.label}>
          <Text style={{
            color: s.emphasis ? Colors.trace : Colors.textBright,
            fontFamily: Font.monoMedium,
            fontSize: 16,
          }}>
            {s.value}
          </Text>
          <Text style={{
            color: Colors.subtext,
            fontFamily: Font.mono,
            fontSize: 9,
            letterSpacing: 0.8,
            marginTop: 1,
          }}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Card shell ──────────────────────────────────────────────────────────────

export function TraceCardShell({ own = false, children }: {
  /** Your own card is ringed in the CTA colour and labelled, like Strava's. */
  own?: boolean;
  children: React.ReactNode;
}) {
  const Colors = useTheme();
  return (
    <View style={{
      backgroundColor: Colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: own ? Colors.primary : Colors.BORDER_SOFT,
      marginHorizontal: 16,
      marginBottom: 10,
      padding: 14,
    }}>
      {children}
    </View>
  );
}

/** The small uppercase line above your own card. */
export function TraceCardLabel({ text }: { text: string }) {
  const Colors = useTheme();
  return (
    <Text style={{
      color: Colors.primarySoft,
      fontFamily: Font.mono,
      fontSize: 9,
      letterSpacing: 1.2,
      marginBottom: 9,
    }}>
      {text}
    </Text>
  );
}

/**
 * Avatar, name, and the "2h ago · Finals" line.
 *
 * `meta` names the destination as well as the time on purpose: on a screen where
 * you read several groups at once, "which of my places did this land in" is part
 * of what the card has to answer.
 */
export function TraceCardHeader({ emoji, name, meta, trailing }: {
  emoji: string;
  name: string;
  meta: string;
  trailing?: React.ReactNode;
}) {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 11 }}>
      <View style={{
        width: 34, height: 34, borderRadius: 11,
        backgroundColor: Colors.raised,
        alignItems: 'center', justifyContent: 'center',
        marginRight: 10,
      }}>
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: Colors.textBright, fontSize: 14, fontWeight: '700' }}>
          {name}
        </Text>
        <Text numberOfLines={1} style={{ color: Colors.subtext, fontSize: 11, marginTop: 1 }}>
          {meta}
        </Text>
      </View>
      {trailing}
    </View>
  );
}
