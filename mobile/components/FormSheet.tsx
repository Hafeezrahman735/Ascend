import { useEffect, useState, type ReactNode } from 'react';
import {
  Dimensions, Keyboard, Modal, Platform, ScrollView, StyleSheet, Text,
  TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';

const SCREEN_H = Dimensions.get('window').height;

/**
 * The modal chrome a FORM sits inside: scrim, grabber, title row with a close
 * button, a scrolling body, and the keyboard handling.
 *
 * Extracted from TaskFormModal rather than copied. The keyboard maths in
 * particular is not obvious — see the comment on `marginBottom` below — and a
 * second sheet reimplementing it from memory would reintroduce the bug that
 * comment was written to record.
 *
 * Distinct from the BottomSheet local to app/(tabs)/tasks.tsx, which is a
 * fixed-height pan-to-dismiss panel with no header. Same silhouette, different
 * job: that one presents a list you flick away, this one presents fields you
 * fill in and submit.
 */
export default function FormSheet({
  visible,
  title,
  onClose,
  children,
  footer,
  overlay,
  /** Fraction of the screen the sheet may occupy before its body scrolls. */
  maxHeightRatio = 0.92,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned below the scrolling body — save/delete actions belong here. */
  footer?: ReactNode;
  /**
   * Rendered as a sibling of the sheet, INSIDE this Modal. A secondary picker
   * belongs here rather than beside <BottomSheet>: two sibling Modals both
   * visible present differently across platforms, and nesting is what the sheets
   * did before this component existed.
   */
  overlay?: ReactNode;
  maxHeightRatio?: number;
}) {
  const Colors = useTheme();

  // Track the keyboard height so the sheet can sit ABOVE the keyboard and cap its
  // own height, rather than the whole sheet being lifted (which pushed the header
  // and close button off the top of the screen).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  // Reset when the sheet closes so it reopens in a clean state.
  useEffect(() => { if (!visible) setKbHeight(0); }, [visible]);

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={onClose} accessible={false}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,2,12,0.62)' }]} />
        </TouchableWithoutFeedback>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          {/* marginBottom lifts the sheet to rest on top of the keyboard; the matching
              maxHeight reduction keeps the sheet top (and its header/close button)
              anchored near the top of the screen instead of clipping off it. */}
          <View style={{
            backgroundColor: Colors.surface,
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            borderTopWidth: 1, borderColor: Colors.border,
            marginBottom: kbHeight,
            maxHeight: SCREEN_H * maxHeightRatio - kbHeight,
          }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 38, height: 4, borderRadius: 3, backgroundColor: Colors.inactive }} />
            </View>

            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 20, paddingBottom: 14,
            }}>
              <Text style={{
                color: Colors.textBright, fontSize: 19, fontWeight: '700', letterSpacing: -0.3,
              }}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={{
                  width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.raised,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={16} color={Colors.subtext} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 26 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

            {footer}
          </View>
        </View>
        {overlay}
      </View>
    </Modal>
  );
}
