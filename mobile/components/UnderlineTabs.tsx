import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import AppPressable from './AppPressable';

/**
 * Tabs for choosing an option inside a view, such as Breakdown's period
 * (Today … All) and its grouping (goal, task, category).
 *
 * Switching a screen's main view uses RoundedTabs instead
 * (all-tasks-status-tabs D13).
 */
export interface UnderlineTab<K extends string> {
  key: K;
  label: string;
}

export default function UnderlineTabs<K extends string>({ tabs, value, onChange, style }: {
  tabs: UnderlineTab<K>[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const Colors = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border }, style]}
    >
      {tabs.map(({ key, label }) => {
        const selected = value === key;
        return (
          <AppPressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            scaleOnPress={false}
            style={{
              flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44,
              borderBottomWidth: 2, borderBottomColor: selected ? Colors.primary : 'transparent', marginBottom: -1,
            }}
          >
            <Text numberOfLines={1} style={{ color: selected ? Colors.textBright : Colors.text, fontSize: 13, fontWeight: selected ? '700' : '500' }}>
              {label}
            </Text>
          </AppPressable>
        );
      })}
    </View>
  );
}
