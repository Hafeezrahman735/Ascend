import { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, Modal, Dimensions, PanResponder,
  StyleSheet, TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { Font } from '../constants/typography';

/**
 * The bottom sheet and the stat cell, shared by the task and goal stats modals.
 *
 * Both lived as unexported locals in `app/(tabs)/tasks.tsx` and were therefore
 * unreachable from anywhere else — "reuse `BottomSheet`" was not actually
 * possible across a file boundary, only "copy it". Moved here verbatim so the
 * second consumer does not become a second copy.
 *
 * Kept in ONE file rather than two because they are always used together and
 * share the screen-height constants. Note this is a different component from
 * `FormSheet` (a keyboard-aware sheet with a header, for forms) — see the note
 * in that file.
 */

const SCREEN_H = Dimensions.get('window').height;

/**
 * No bottom sheet may grow past this. A sheet is anchored at bottom:0 and only
 * had a minHeight, so tall content (a recurring task carries a streak card, a
 * lifetime-focus card AND notes) grew it upward past the top of the screen. The
 * title, the close button, the drag handle and the tappable backdrop all live in
 * that overflow, so every way out of the sheet disappeared at once.
 */
const SHEET_MAX_H = SCREEN_H * 0.9;

/** Monospace family for stat numerals / section labels (matches JetBrains Mono). */
export const MONO = Font.mono;

export { SCREEN_H, SHEET_MAX_H };

export function BottomSheet({ visible, onClose, children, sheetHeight }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; sheetHeight: number;
}) {
  const Colors = useTheme();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  // useMemo, not useRef(...).current: the ref form evaluates its argument on
  // every render and throws the result away, so every re-render of an open sheet
  // built a PanResponder for nothing. The handlers read onCloseRef at gesture
  // time, so an empty dep list is correct — the responder never needs rebuilding.
  //
  // react-hooks/refs still warns here ("passing a ref to a function may read its
  // value during render"). It is a false positive: PanResponder.create STORES
  // these callbacks, it never invokes them, so onCloseRef is only read on a drag.
  // Do not "fix" it by depending on [onClose] and dropping the ref — every call
  // site forwards onClose down from a parent, so an inline arrow anywhere above
  // would rebuild the responder on every render, which is the thing this avoids.
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) onCloseRef.current(); },
  }), []);
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
        </TouchableWithoutFeedback>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: Colors.border, minHeight: Math.min(sheetHeight, SHEET_MAX_H), maxHeight: SHEET_MAX_H }}>
            <View {...panResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 38, height: 4, borderRadius: 3, backgroundColor: Colors.inactive }} />
            </View>
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Bento ────────────────────────────────────────────────────────────────────
/**
 * The stat grid used by the task and goal stats sheets.
 *
 * Replaces the six equal `StatBox` cells at `flexBasis: '47%'`, which was a
 * table rather than a bento: every cell the same size says every number has the
 * same importance, which was never true. Here a parent sets `flex` per cell, so
 * size carries rank. `StatBox` went with them — the task and goal sheets were
 * its only two consumers, and both now use these. (The `StatBox` in
 * app/user/[id].tsx is a different, local component.)
 *
 * Two fixes are baked in rather than left to call sites:
 *
 *   1. **Labels are legible.** The old label was 9px `subtext` on `raised` —
 *      about 2.6:1, against a 4.5:1 floor, and too small to qualify as large
 *      text. These are 11px on `Colors.text` (9.9:1).
 *   2. **Cells are compact.** Padding and type are a step down from `StatBox`
 *      so a six-cell grid does not fill the sheet before the content does.
 *
 */

/** Vertical rhythm inside a cell. Kept here so the two sheets cannot drift. */
const CELL_PAD_V = 11;
const CELL_PAD_H = 12;

export function BentoCell({
  label, value, sub, feature, icon, style, Colors,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Tinted + accented border. At most one per grid, or it stops meaning anything. */
  feature?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: object;
  Colors: ThemeColors;
}) {
  return (
    <View style={[{
      backgroundColor: feature ? Colors.primaryDim : Colors.raised,
      borderWidth: 1,
      borderColor: feature ? Colors.primary : Colors.border,
      borderRadius: 14,
      paddingVertical: CELL_PAD_V,
      paddingHorizontal: CELL_PAD_H,
      justifyContent: 'center',
    }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon && <Ionicons name={icon} size={11} color={Colors.text} />}
        <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.text }} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          color: Colors.textBright, fontSize: 18, fontWeight: '700',
          fontFamily: MONO, marginTop: 3,
        }}
      >
        {value}
      </Text>
      {sub ? (
        <Text style={{ color: Colors.subtext, fontSize: 10.5, marginTop: 1 }} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The one large cell: a progress ring with its numbers underneath.
 *
 * `fraction` is clamped for the ARC only — the caption still says 240% when
 * that is the truth. A ring that silently stops at full would hide exactly the
 * overrun the user needs to see.
 */
export function BentoRingCell({
  fraction, centerLabel, caption, sub, tint, style, Colors,
}: {
  fraction: number;
  centerLabel: string;
  caption: string;
  sub?: string;
  /** Defaults to primary; pass accent for a completed thing. */
  tint?: string;
  style?: object;
  Colors: ThemeColors;
}) {
  const SIZE = 92;
  const STROKE = 8;
  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(1, fraction));
  const color = tint ?? Colors.primary;

  return (
    <View style={[{
      backgroundColor: Colors.primaryDim,
      borderWidth: 1, borderColor: color,
      borderRadius: 14,
      paddingVertical: 14, paddingHorizontal: CELL_PAD_H,
      alignItems: 'center', justifyContent: 'center', gap: 9,
    }, style]}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={r}
            stroke={Colors.inactive} strokeWidth={STROKE} fill="none"
          />
          <Circle
            cx={SIZE / 2} cy={SIZE / 2} r={r}
            stroke={color} strokeWidth={STROKE} fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: Colors.textBright, fontSize: 21, fontWeight: '800' }}>
            {centerLabel}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: Colors.textBright, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
          {caption}
        </Text>
        {sub ? (
          <Text style={{ color: Colors.text, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
