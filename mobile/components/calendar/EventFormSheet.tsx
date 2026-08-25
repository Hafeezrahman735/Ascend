import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, Platform, Alert } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useIsDark } from '../../hooks/useTheme';
import FormSheet from '../FormSheet';
import DayPickerRow from './DayPickerRow';
import { formatMinutes, MINUTES_IN_DAY } from './shared';
import type { CalendarEvent } from '../../types';

/**
 * Create or edit an event — time that is spoken for but is not work you do.
 *
 * Four fields, deliberately. No description, no location, no reminders: those
 * are omissions rather than oversights. Location is the most-expected field on
 * anything called an event, so its absence is worth stating rather than
 * discovering. Add it when someone asks for it, not before.
 */

const DEFAULT_START = 9 * 60;
const DEFAULT_DURATION = 60;

export interface EventDraft {
  title: string;
  date: string;
  startMinutes: number | null;
  endMinutes: number | null;
}

/**
 * One end of the time range. Defined at module scope, not inside the sheet: a
 * component created during render is a new type every time, so React remounts it
 * and it loses any state it holds.
 */
function TimeButton({ which, value, active, onPress }: {
  which: 'start' | 'end';
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  const Colors = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${which === 'start' ? 'Start' : 'End'} time, ${formatMinutes(value)}`}
      style={{
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: Colors.raised, borderRadius: 13,
        borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
        paddingHorizontal: 14, paddingVertical: 13,
      }}
    >
      <Ionicons name="time-outline" size={15} color={Colors.subtext} />
      <View>
        <Text style={{ color: Colors.subtext, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 }}>
          {which === 'start' ? 'STARTS' : 'ENDS'}
        </Text>
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>
          {formatMinutes(value)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function EventFormSheet({
  visible,
  event,
  weekStart,
  defaultDate,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  /** null when creating. */
  event: CalendarEvent | null;
  weekStart: Date;
  /** 'YYYY-MM-DD' the sheet opens on when creating. */
  defaultDate: string;
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const Colors = useTheme();
  const isDark = useIsDark();
  const label = {
    fontSize: 10, fontWeight: '700' as const, letterSpacing: 1,
    color: Colors.subtext, marginBottom: 9,
  };

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [isAllDay, setIsAllDay] = useState(false);
  const [startMinutes, setStartMinutes] = useState(DEFAULT_START);
  const [endMinutes, setEndMinutes] = useState(DEFAULT_START + DEFAULT_DURATION);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [titleError, setTitleError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(event?.title ?? '');
    setDate(event?.date ?? defaultDate);
    // An existing event with no times is all-day; a new one defaults to timed,
    // because a 9am slot is the more common thing to want and is one tap to clear.
    const allDay = event ? event.startMinutes == null : false;
    setIsAllDay(allDay);
    setStartMinutes(event?.startMinutes ?? DEFAULT_START);
    setEndMinutes(event?.endMinutes ?? DEFAULT_START + DEFAULT_DURATION);
    setPicking(null);
    setTitleError(false);
  }, [visible, event, defaultDate]);

  // The same rule the server enforces, mirrored here so the sheet can explain
  // itself instead of failing after it closes. Overnight events are out of
  // scope: endMinutes cannot exceed the end of the day.
  const timeError = !isAllDay && endMinutes <= startMinutes
    ? 'End time must be after the start time'
    : null;

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) { setTitleError(true); return; }
    if (timeError) return;
    onSave({
      title: trimmed,
      date,
      startMinutes: isAllDay ? null : startMinutes,
      endMinutes: isAllDay ? null : endMinutes,
    });
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete event?', title.trim() || 'This event', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  /** A fixed calendar date carrying the time, which is all the picker reads. */
  const pickerValue = useMemo(() => {
    const m = picking === 'end' ? endMinutes : startMinutes;
    return new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
  }, [picking, startMinutes, endMinutes]);

  const handleTimeChange = (_e: DateTimePickerEvent, picked?: Date) => {
    const editing = picking;
    if (Platform.OS === 'android') setPicking(null);
    if (!picked || !editing) return;
    const minutes = picked.getHours() * 60 + picked.getMinutes();
    if (editing === 'end') { setEndMinutes(minutes); return; }
    // Moving the start carries the block with it, so a one-hour meeting stays a
    // one-hour meeting rather than silently becoming invalid.
    const span = Math.max(15, endMinutes - startMinutes);
    setStartMinutes(minutes);
    setEndMinutes(Math.min(MINUTES_IN_DAY - 1, minutes + span));
  };

  return (
    <FormSheet
      visible={visible}
      title={event ? 'Edit event' : 'New event'}
      onClose={onClose}
    >
      <TextInput
        style={[
          {
            backgroundColor: Colors.raised, borderRadius: 13, borderWidth: 1,
            borderColor: Colors.border, paddingHorizontal: 15, paddingVertical: 15,
            color: Colors.textBright, fontSize: 15, fontWeight: '600',
            marginBottom: titleError ? 6 : 18,
          },
          titleError && { borderColor: Colors.ROSE, borderWidth: 1.5 },
        ]}
        placeholder="Dentist, standup, flight…"
        placeholderTextColor={Colors.subtext}
        value={title}
        onChangeText={(t) => { setTitle(t); if (titleError) setTitleError(false); }}
        autoFocus
        maxLength={200}
        returnKeyType="done"
        accessibilityLabel="Event name"
      />
      {titleError && (
        <Text style={{ color: Colors.ROSE, fontSize: 11, marginBottom: 18 }}>
          An event needs a name
        </Text>
      )}

      <Text style={label}>DAY</Text>
      <View style={{ marginBottom: 18 }}>
        <DayPickerRow weekStart={weekStart} selected={date} onSelect={setDate} />
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 4, marginBottom: isAllDay ? 20 : 12,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>All day</Text>
          <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: 2 }}>
            Frames the day instead of taking a slot in it
          </Text>
        </View>
        <Switch
          value={isAllDay}
          onValueChange={setIsAllDay}
          trackColor={{ false: Colors.inactive, true: Colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      {!isAllDay && (
        <>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: timeError ? 6 : 20 }}>
            <TimeButton
              which="start"
              value={startMinutes}
              active={picking === 'start'}
              onPress={() => setPicking(picking === 'start' ? null : 'start')}
            />
            <TimeButton
              which="end"
              value={endMinutes}
              active={picking === 'end'}
              onPress={() => setPicking(picking === 'end' ? null : 'end')}
            />
          </View>

          {timeError && (
            <Text style={{ color: Colors.ROSE, fontSize: 11, marginBottom: 16 }}>
              {timeError}
            </Text>
          )}

          {picking && (
            <View style={{
              backgroundColor: Colors.raised, borderRadius: 13, marginBottom: 20,
              alignItems: 'center', overflow: 'hidden',
            }}>
              <DateTimePicker
                value={pickerValue}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTimeChange}
                themeVariant={isDark ? 'dark' : 'light'}
                accentColor={Colors.primary}
              />
            </View>
          )}
        </>
      )}

      <TouchableOpacity
        onPress={handleSave}
        disabled={!!timeError}
        accessibilityRole="button"
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15,
          opacity: timeError ? 0.5 : 1,
        }}
      >
        <Ionicons name={event ? 'checkmark' : 'add'} size={16} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
          {event ? 'Save changes' : 'Add event'}
        </Text>
      </TouchableOpacity>

      {event && onDelete && (
        <TouchableOpacity
          onPress={confirmDelete}
          accessibilityRole="button"
          style={{
            marginTop: 12, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
            backgroundColor: Colors.ROSE_DIM, borderWidth: 0.5, borderColor: Colors.ROSE + '40',
          }}
        >
          <Text style={{ color: Colors.ROSE, fontWeight: '700', fontSize: 14 }}>Delete event</Text>
        </TouchableOpacity>
      )}
    </FormSheet>
  );
}
