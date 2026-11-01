import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useIsDark } from '../../hooks/useTheme';
import { getLocalDateString, parseLocalDate } from '../../utils/date';

/**
 * Pick any day, for the event and note sheets.
 *
 * It used to be seven chips limited to the anchored week, because an item saved
 * outside the loaded range appeared and then vanished on the next refetch. The
 * calendar now follows a save to its week or month and reloads it from the
 * server (`followDate` in app/(tabs)/calendar.tsx), so any date is safe.
 *
 * The picker closes on selection on every platform, like the task form's: iOS's
 * inline calendar otherwise stays mounted with no way to put it away.
 */
export default function DateField({ value, onChange }: {
  /** 'YYYY-MM-DD' */
  value: string;
  onChange: (dateKey: string) => void;
}) {
  const Colors = useTheme();
  const isDark = useIsDark();
  const [open, setOpen] = useState(false);
  // Memoised: a fresh Date each render is a changed prop to the native picker.
  const date = useMemo(() => parseLocalDate(value), [value]);
  const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const handleChange = (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    onChange(getLocalDateString(picked));
  };

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Day, ${label}. Change`}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
          minHeight: 44, backgroundColor: Colors.primaryDim, borderRadius: 10, paddingHorizontal: 12,
        }}
      >
        <Ionicons name="calendar-outline" size={15} color={Colors.primarySoft} />
        <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ backgroundColor: Colors.raised, borderRadius: 13, marginTop: 10, alignItems: 'center', overflow: 'hidden' }}>
          <DateTimePicker
            value={date}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleChange}
            themeVariant={isDark ? 'dark' : 'light'}
            accentColor={Colors.primary}
          />
        </View>
      )}
    </View>
  );
}
