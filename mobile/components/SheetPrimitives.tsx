import { useEffect, useRef } from 'react';
import {
  View, Text, Modal, Dimensions, PanResponder,
  StyleSheet, TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 0.5) onCloseRef.current(); },
  })).current;
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

/**
 * One cell of a stats grid. `big` renders a headline numeral (display font);
 * otherwise a compact mono value. Featured cells pass a tinted bg + colored
 * border.
 *
 * `Colors` is a prop rather than a `useTheme()` call because that is how the
 * original was written and every call site already passes it. Changing the
 * signature is a separate refactor.
 */
export function StatBox({ bg, border, icon, iconColor, label, labelColor, value, sub, big, Colors }: {
  bg: string; border: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string;
  label: string; labelColor: string; value: string; sub?: string; big?: boolean; Colors: ThemeColors;
}) {
  return (
    <View style={{ flexGrow: 1, flexBasis: '47%', backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 15, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 1, color: labelColor, fontFamily: MONO }}>{label}</Text>
      </View>
      <Text style={{ color: Colors.textBright, fontWeight: '700', fontSize: big ? 30 : 19, letterSpacing: big ? -1 : 0, fontFamily: big ? undefined : MONO }}>{value}</Text>
      {sub && <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 3 }}>{sub}</Text>}
    </View>
  );
}
