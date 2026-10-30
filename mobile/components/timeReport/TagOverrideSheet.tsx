import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { BottomSheet, SCREEN_H } from '../SheetPrimitives';
import {
  useTagOverrideStore, TAG_COLOR_TOKENS, TAG_ICONS,
  getTagColor, getTagIcon, type TagColorKey,
} from '../../utils/tagStyle';
import { getStyles } from '../formStyles';

/**
 * Pick a tag's colour and icon (long-press a tag anywhere on Today or Time).
 * Moved out of the Today route so the Time tab can mount it too.
 */
export default function TagOverrideSheet({ tag, visible, onClose }: { tag: string; visible: boolean; onClose: () => void }) {
  const Colors = useTheme();
  const styles = useMemo(() => getStyles(Colors), [Colors]);
  const { overrides, setOverride, clearOverride } = useTagOverrideStore();
  const current = overrides[tag];
  // Initialize to null — the effect sets the correct value the moment visible becomes true,
  // preventing a stale value from showing on any frame before the sheet opens.
  const [selColor, setSelColor] = useState<TagColorKey | null>(null);
  const [selIcon, setSelIcon]   = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const ov = useTagOverrideStore.getState().overrides[tag];
      setSelColor((ov?.colorKey ?? getTagColor(tag).key) as TagColorKey);
      setSelIcon(ov?.icon ?? getTagIcon(tag));
    }
  }, [visible, tag]);

  const preview = (selColor ? TAG_COLOR_TOKENS.find((t) => t.key === selColor) : null) ?? TAG_COLOR_TOKENS[0];

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetHeight={SCREEN_H * 0.65}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: preview.bg }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: preview.text }}>{selIcon} {tag}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={Colors.subtext} /></TouchableOpacity>
        </View>
      </View>
      <View style={{ height: 0.5, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 16 }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.fieldLabel}>Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {TAG_COLOR_TOKENS.map((token) => (
            <TouchableOpacity key={token.key} onPress={() => setSelColor(token.key as TagColorKey)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: token.bar, alignItems: 'center', justifyContent: 'center', borderWidth: selColor === token.key ? 3 : 0, borderColor: '#fff' }}>
              {selColor === token.key && <Ionicons name="checkmark" size={18} color="#fff" />}
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Icon</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {TAG_ICONS.map((icon) => (
            <TouchableOpacity key={icon} onPress={() => setSelIcon(icon)} style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: selIcon === icon ? Colors.raised : 'transparent', borderWidth: selIcon === icon ? 1.5 : 0.5, borderColor: selIcon === icon ? Colors.primary : Colors.border }}>
              <Text style={{ fontSize: 22 }}>{icon}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => { if (selColor && selIcon) setOverride(tag, selColor, selIcon); onClose(); }} style={{ backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save</Text>
        </TouchableOpacity>
        {current && (
          <TouchableOpacity onPress={() => { clearOverride(tag); onClose(); }} style={{ borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }}>
            <Text style={{ color: Colors.subtext, fontWeight: '600', fontSize: 14 }}>Reset to default</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
