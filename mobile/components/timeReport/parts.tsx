import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';

/**
 * The small pieces the time report is built from.
 *
 * Deliberately plain. This screen is a personal instrument, not a business
 * analytics dashboard, so the vocabulary is: a rule, a label, a ledger row, a
 * thin share bar. No cards, no tiles, no chart that needs a legend. Anything
 * that cannot be read at a glance does not belong on it.
 */

/** Hairline divider. The only structural device this screen uses. */
export function Rule({ inset = false }: { inset?: boolean }) {
  const Colors = useTheme();
  return (
    <View style={{
      height: 1,
      backgroundColor: Colors.border,
      marginLeft: inset ? Space.lg : 0,
    }} />
  );
}

export function SectionTitle({ children, note }: { children: string; note?: string }) {
  const Colors = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      marginTop: Space.section, marginBottom: Space.lg,
    }}>
      <Text style={{
        color: Colors.textBright, fontSize: 13, fontWeight: '700',
        letterSpacing: 1.1, textTransform: 'uppercase', fontFamily: Font.mono,
      }}>
        {children}
      </Text>
      {note ? (
        <Text style={{ color: Colors.text, fontSize: 12 }}>{note}</Text>
      ) : null}
    </View>
  );
}

/**
 * Period-over-period change, as a signed duration.
 *
 * Direction is carried by an arrow and a number, never by a coloured dot or a
 * badge — the brief rules out urgency cues, and a report is not an alert.
 * Returns null when there is nothing to compare against, rather than rendering
 * a misleading "+100%".
 */
export function DeltaText({
  current, previous, style,
}: { current: number; previous: number; style?: object }) {
  const Colors = useTheme();
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return null;

  const diff = current - previous;
  if (Math.abs(diff) < 60) {
    return <Text style={[{ color: Colors.subtext, fontSize: 12 }, style]}>level</Text>;
  }
  const up = diff > 0;
  return (
    <Text style={[{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }, style]}>
      {up ? '↑' : '↓'} {formatSeconds(Math.abs(diff))}
    </Text>
  );
}

/**
 * A share rail. Not a chart — a proportion, read at a glance.
 *
 * `height` defaults to the hairline used in the summary card. The report's
 * goals section passes 8, which is the weight concept 2A gives it: there the
 * bar is the primary comparison between goals, not a footnote under a row.
 */
export function ShareBar({ share, color, height = 3 }: {
  share: number;
  color?: string;
  height?: number;
}) {
  const Colors = useTheme();
  const width = `${Math.max(1, Math.min(100, Math.round(share * 100)))}%` as const;
  const radius = height / 2;
  return (
    <View style={{
      height, backgroundColor: Colors.inactive,
      borderRadius: radius, overflow: 'hidden', marginTop: Space.sm,
    }}>
      <View style={{ height, width, backgroundColor: color ?? Colors.primary, borderRadius: radius }} />
    </View>
  );
}

/**
 * One line of the ledger: a name on the left, a time on the right, sharing one
 * baseline and one right edge so the eye scans a single column of figures.
 */
export function LedgerRow({
  title, subtitle, seconds, share, trailing, tint,
}: {
  title: string;
  subtitle?: string | null;
  seconds: number;
  /** Omit to skip the rail entirely — used where a proportion means nothing. */
  share?: number;
  /** Rendered under the row, for a sentence that needs saying. */
  trailing?: React.ReactNode;
  tint?: string;
}) {
  const Colors = useTheme();
  return (
    <View style={{ paddingVertical: Space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: Colors.textBright, fontSize: 15, fontWeight: '600' }}
        >
          {title}
        </Text>
        <Text style={{
          color: Colors.textBright, fontSize: 15, fontFamily: Font.mono,
          fontVariant: ['tabular-nums'],
        }}>
          {formatSeconds(seconds)}
        </Text>
      </View>
      {subtitle ? (
        <Text numberOfLines={1} style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>
          {subtitle}
        </Text>
      ) : null}
      {share !== undefined && <ShareBar share={share} color={tint} />}
      {trailing}
    </View>
  );
}

/** Centred, quiet message for the empty and error states. */
export function Notice({ title, body }: { title: string; body?: string }) {
  const Colors = useTheme();
  return (
    <View style={{ paddingVertical: Space.page, paddingHorizontal: Space.lg }}>
      <Text style={{
        color: Colors.textBright, fontSize: 16, fontFamily: Font.editorial,
        textAlign: 'center',
      }}>
        {title}
      </Text>
      {body ? (
        <Text style={{
          color: Colors.text, fontSize: 13, lineHeight: 19,
          textAlign: 'center', marginTop: Space.sm,
        }}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Placeholder shapes while a lens loads for the first time. Quiet blocks in
 * the layout's own rhythm, so the page does not jump when the data lands.
 */
export function SkeletonBlocks({ heights = [44, 150, 96] }: { heights?: number[] }) {
  const Colors = useTheme();
  return (
    <View style={{ gap: Space.xl, paddingTop: Space.lg }} accessibilityLabel="Loading" accessible>
      {heights.map((h, i) => (
        <View key={i} style={{ height: h, borderRadius: Radius.md, backgroundColor: Colors.raised, opacity: 0.6 }} />
      ))}
    </View>
  );
}

/** The error state for a lens: what went wrong, and the one thing to do. */
export function ErrorRetry({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  const Colors = useTheme();
  return (
    <View>
      <Notice title={title} body={body} />
      <AppPressable
        onPress={onRetry}
        accessibilityRole="button"
        style={{
          alignSelf: 'center', paddingHorizontal: Space.xxl, paddingVertical: Space.md, minHeight: 44,
          borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
        }}
      >
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>Try again</Text>
      </AppPressable>
    </View>
  );
}

/** A tappable ledger row that opens the sessions behind it. */
export function DrillRow({ onPress, label, ...row }: React.ComponentProps<typeof LedgerRow> & {
  onPress?: () => void;
  label?: string;
}) {
  const Colors = useTheme();
  if (!onPress) return <LedgerRow {...row} />;
  return (
    <AppPressable
      onPress={onPress}
      scaleOnPress={false}
      accessibilityRole="button"
      accessibilityLabel={label ?? `${row.title}, ${formatSeconds(row.seconds)}. Show sessions.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }}
    >
      <View style={{ flex: 1 }}><LedgerRow {...row} /></View>
      <Text style={{ color: Colors.subtext, fontSize: 16 }}>›</Text>
    </AppPressable>
  );
}
