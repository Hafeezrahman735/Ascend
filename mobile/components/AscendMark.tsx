import { useId } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../hooks/useTheme';
import { Font } from '../constants/typography';

/**
 * The orbit-tail mark — the app's one visual signature.
 *
 * It is not a new drawing. It is the Focus ring's own progress arc and orbiting
 * dot, frozen at a quarter turn: a track ring, a tail running up the top-left
 * quadrant, and a solid dot at the leading edge. Users already watch this exact
 * shape sweep round every time they run a session, so the icon reads as a
 * captured moment of the thing rather than a logo bolted on beside it.
 *
 * The tail fades to nothing along its length, so at tab-bar size the dot is what
 * carries the mark and the fade just reads as weight. Rendered in `accent`, the
 * colour that already means done/progress everywhere else in the app.
 *
 * Kept to three places on purpose — the wordmark, the Ascend tab icon, and the
 * live Focus ring. Sprinkling it onto other screens as decoration is what would
 * cost it its recognisability.
 */

const VB = 72;          // viewBox, so geometry stays in one readable unit
const R = 26;           // ring radius
const STROKE = 7;       // ring + tail weight at 72; scales with the whole mark

export function AscendMark({ size = 28, color, trackColor }: {
  size?: number;
  /** Overrides the `accent` token — the tab bar passes its active/inactive tint. */
  color?: string;
  /** The unswept part of the ring. Defaults to the empty-track token. */
  trackColor?: string;
}) {
  const Colors = useTheme();
  const tint = color ?? Colors.accent;
  const track = trackColor ?? Colors.inactive;

  // Gradient ids are document-global in SVG. Two marks on one screen (wordmark
  // plus tab icon) would otherwise share one id and the second would win.
  const gradientId = `orbit-tail-${useId()}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} fill="none">
      <Defs>
        {/* Bottom-left (tail end, invisible) to top (dot, full strength). */}
        <LinearGradient id={gradientId} x1="0.1" y1="0.95" x2="0.5" y2="0.05">
          <Stop offset="0" stopColor={tint} stopOpacity={0} />
          <Stop offset="1" stopColor={tint} stopOpacity={1} />
        </LinearGradient>
      </Defs>

      <Circle cx={VB / 2} cy={VB / 2} r={R} stroke={track} strokeWidth={STROKE} />
      <Path
        d={`M${VB / 2 - R} ${VB / 2} A${R} ${R} 0 0 1 ${VB / 2} ${VB / 2 - R}`}
        stroke={`url(#${gradientId})`}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      <Circle cx={VB / 2} cy={VB / 2 - R} r={STROKE} fill={tint} />
    </Svg>
  );
}

/**
 * Mark + name, locked up. The one place the brand states itself: the Ascend tab
 * header and the sign-in screen.
 */
export function AscendWordmark({ size = 25, showTagline = false }: {
  size?: number;
  showTagline?: boolean;
}) {
  const Colors = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <AscendMark size={size} />
      <View>
        <Text style={{
          color: Colors.textBright,
          fontFamily: Font.display,
          fontSize: size,
          letterSpacing: -0.7,
          lineHeight: size * 1.15,
        }}>
          Ascend
        </Text>
        {showTagline && (
          <Text style={{
            color: Colors.subtext,
            fontFamily: Font.mono,
            fontSize: 10,
            letterSpacing: 1.3,
            marginTop: 5,
          }}>
            SHOW UP. LEAVE A TRACE.
          </Text>
        )}
      </View>
    </View>
  );
}
