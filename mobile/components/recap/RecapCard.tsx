import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';

/**
 * The receipt.
 *
 * Every card on the Ascend feed shares this chrome: who, when and where at the
 * top, and the day's numbers in a row. The numbers are the content — there is no
 * headline, no "I crushed it today", and nothing a person writes to make their
 * day sound bigger than it was. A card says what happened and stops, which is
 * the difference between showing up and showing off.
 *
 * The stat row is `RecapStats` and the frame is `RecapCardShell`. They are
 * separate so a post type with a body of its own — an unlocked achievement, a
 * group challenge, someone's written note — can sit inside the same frame
 * instead of getting its own competing card design.
 *
 * There used to be a decorative wave ruled under the stats. It was removed: it
 * was the only element on the card that carried no information, and on a card
 * whose entire argument is that the numbers speak for themselves, a squiggle
 * that looks like a chart but is identical on every post was working against it.
 */

// ─── Stat row ────────────────────────────────────────────────────────────────

export interface RecapStat {
  label: string;
  value: string;
  /** The streak is the one figure drawn in the brand colour. */
  emphasis?: boolean;
}

export function RecapStats({ stats }: { stats: RecapStat[] }) {
  const Colors = useTheme();
  if (stats.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {stats.map((s) => (
        <View key={s.label}>
          <Text style={{
            color: s.emphasis ? Colors.accent : Colors.textBright,
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

export function RecapCardShell({ own = false, children }: {
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
export function RecapCardLabel({ text }: { text: string }) {
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
export function RecapCardHeader({ emoji, name, meta, trailing }: {
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
