import { useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, Linking, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';

/**
 * Focus Mode walkthrough.
 *
 * iOS gives NO app the ability to turn Do Not Disturb / Focus on, and none to
 * silence another app's notifications. Only the person holding the phone can do
 * it, by hand or through a Shortcuts Automation they create themselves. So this
 * sheet is a guided manual setup, and it says so plainly rather than implying
 * Ascend is doing something it cannot.
 *
 * Deliberately NOT used here: `App-Prefs:` / `prefs:root=` URLs that jump
 * straight to the Focus pane. Those are undocumented, therefore private API,
 * and Apple review rejects them. `Linking.openSettings()` is the only sanctioned
 * call, and it lands on Ascend's own page — the copy says that, because that is
 * where it lands.
 */

const SHORTCUTS_URL = 'shortcuts://';

const AUTOMATION_STEPS = [
  'Open the Shortcuts app, then the Automation tab.',
  'Tap +, then App.',
  'Choose Ascend, and set it to run when the app is Opened.',
  'Pick Run Immediately so it does not ask you every time.',
  'Add the action Set Focus, and set it to turn Do Not Disturb On.',
  'Optionally add a second automation for App Closed that turns it back Off.',
];

function Step({ index, text }: { index: number; text: string }) {
  const Colors = useTheme();
  return (
    <View style={{ flexDirection: 'row', marginBottom: 12 }}>
      <View style={{
        width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primaryDim,
        alignItems: 'center', justifyContent: 'center', marginRight: 11, marginTop: 1,
      }}>
        <Text style={{ color: Colors.primarySoft, fontSize: 11, fontWeight: '800' }}>{index}</Text>
      </View>
      <Text style={{ flex: 1, color: Colors.text, fontSize: 13.5, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

export default function FocusModeSheet({ visible, onClose }: {
  visible: boolean;
  onClose: () => void;
}) {
  const Colors = useTheme();
  const [shortcutsMissing, setShortcutsMissing] = useState(false);

  const openShortcuts = async () => {
    try {
      const ok = await Linking.canOpenURL(SHORTCUTS_URL);
      if (!ok) { setShortcutsMissing(true); return; }
      await Linking.openURL(SHORTCUTS_URL);
    } catch {
      // A failed open is not worth an alert on top of a sheet — surface it
      // inline so the written steps stay usable without Shortcuts.
      setShortcutsMissing(true);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: Colors.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '88%', paddingBottom: 32,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>

          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 20, paddingVertical: 12,
          }}>
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 19, fontWeight: '800' }}>
              Focus Mode
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={Colors.subtext} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 21, marginBottom: 8 }}>
              A session works best when nothing else is allowed to interrupt it.
              Turning on Do Not Disturb silences other apps for as long as you are
              focusing.
            </Text>

            {/* Say the honest thing up front. Implying the app can flip Focus
                itself would be a promise it can never keep. */}
            <View style={{
              flexDirection: 'row', gap: 10, backgroundColor: Colors.raised,
              borderRadius: 12, padding: 13, marginTop: 6, marginBottom: 20,
              borderWidth: 1, borderColor: Colors.BORDER_SOFT,
            }}>
              <Ionicons name="information-circle-outline" size={17} color={Colors.subtext} />
              <Text style={{ flex: 1, color: Colors.subtext, fontSize: 12.5, lineHeight: 18 }}>
                iOS does not let any app switch Focus on for you. Ascend can only
                walk you to the switch. The setup below is a one-time thing.
              </Text>
            </View>

            <Text style={{
              color: Colors.subtext, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.5, marginBottom: 12,
            }}>
              AUTOMATIC, VIA SHORTCUTS
            </Text>
            <Text style={{ color: Colors.text, fontSize: 13.5, lineHeight: 20, marginBottom: 14 }}>
              This is the closest thing to automatic that iOS allows. Once set up,
              Do Not Disturb turns itself on whenever you open Ascend.
            </Text>

            {AUTOMATION_STEPS.map((text, i) => (
              <Step key={i} index={i + 1} text={text} />
            ))}

            {shortcutsMissing && (
              <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 4, marginBottom: 10 }}>
                The Shortcuts app is not available on this device. The steps above
                still apply if you install it.
              </Text>
            )}

            {Platform.OS === 'ios' && !shortcutsMissing && (
              <Pressable
                onPress={openShortcuts}
                accessibilityRole="button"
                accessibilityLabel="Open the Shortcuts app"
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: Colors.primary, borderRadius: 14,
                  paddingVertical: 14, marginTop: 6, marginBottom: 22,
                }}
              >
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Open Shortcuts</Text>
              </Pressable>
            )}

            <View style={{ height: 1, backgroundColor: Colors.BORDER_SOFT, marginBottom: 18 }} />

            <Text style={{
              color: Colors.subtext, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.5, marginBottom: 12,
            }}>
              MANUALLY, EVERY TIME
            </Text>
            <Text style={{ color: Colors.text, fontSize: 13.5, lineHeight: 20, marginBottom: 14 }}>
              Swipe down from the top-right of your screen to open Control Centre,
              then tap Focus and choose Do Not Disturb.
            </Text>

            {/* Honest label: iOS only sanctions opening the app's OWN settings
                page. There is no approved link to the Focus pane. */}
            <Pressable
              onPress={() => Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel="Open Ascend settings in iOS"
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                borderRadius: 14, paddingVertical: 13,
                borderWidth: 1, borderColor: Colors.BORDER_SOFT,
              }}
            >
              <Ionicons name="settings-outline" size={16} color={Colors.subtext} />
              <Text style={{ color: Colors.subtext, fontSize: 13.5, fontWeight: '600' }}>
                Open Ascend in iOS Settings
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
