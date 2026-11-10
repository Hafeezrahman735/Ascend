import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import AppPressable from './AppPressable';

/**
 * Tabs that switch a screen between its main views: Calendar's Plan / Day /
 * Week / Month, the Time tab's lenses and All Tasks' status filter.
 *
 * Options INSIDE a view (Breakdown's period and grouping) use UnderlineTabs
 * instead. That split is the founder's rule (all-tasks-status-tabs D13).
 *
 * Every tab is at least 44px tall, the touch-target minimum (D17). A tab
 * with a count shows it on a second line, because four labels plus numbers
 * do not fit across a phone on one line (D14).
 */
export interface RoundedTab<K extends string> {
  key: K;
  label: string;
  /** Shown under the label; omit for a single-line tab. */
  count?: number;
  /** What the count counts, for screen readers: "3 tasks". Defaults to "items". */
  countNoun?: string;
}

export default function RoundedTabs<K extends string>({ tabs, value, onChange, style }: {
  tabs: RoundedTab<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const Colors = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row', margin: 12, padding: 3, borderRadius: 12, backgroundColor: Colors.surface, gap: 3 }, style]}
    >
      {tabs.map(({ key, label, count, countNoun }) => {
        const selected = value === key;
        const color = selected ? '#fff' : Colors.subtext;
        const spokenCount = count === undefined ? '' : `, ${count} ${countNoun ?? 'items'}`;
        return (
          <AppPressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}${spokenCount}`}
            scaleOnPress={false}
            style={{
              flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 2, backgroundColor: selected ? Colors.primary : 'transparent',
            }}
          >
            <Text numberOfLines={1} style={{ color, fontSize: count === undefined ? 13 : 12, fontWeight: selected ? '700' : '600' }}>
              {label}
            </Text>
            {count !== undefined && (
              <Text style={{ color, fontSize: 11, fontWeight: '700', marginTop: 1 }}>{count}</Text>
            )}
          </AppPressable>
        );
      })}
    </View>
  );
}
