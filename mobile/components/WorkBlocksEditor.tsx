import { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { WorkBlock } from '../types';
import { useTheme, useIsDark } from '../hooks/useTheme';
import { MONO } from './SheetPrimitives';
import { getLocalDateString, parseLocalDate } from '../utils/date';
import { formatDuration } from '../lib/taskMetrics';
import { nextFreeBlockDay, sortWorkBlocks, timedBlockMinutes, workBlockError } from '../lib/taskForm';

/**
 * The task form's WORK BLOCKS list: when you plan to work on a one-off task,
 * separate from its due date (docs/designs/task-due-and-work-blocks.md, D21).
 *
 *   + Add work block → a row on the next day without one, its date picker open
 *   day chip         → that row's date picker
 *   Any time / times → that row's time pickers (start, then end)
 *   ✕                → removes the row
 *
 * One picker is open at a time. Rows stay sorted by day then start, so an
 * edit is re-sorted when its picker closes, not under the user's finger.
 */

type Field = 'date' | 'start' | 'end';

/** The minutes the time picker opens on: the value, else 9am. */
function minutesToDate(minutes: number | null): Date {
  const m = minutes ?? 9 * 60;
  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
}

function formatClock(minutes: number): string {
  return minutesToDate(minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function WorkBlocksEditor({ blocks, onChange, estimatedMinutes }: {
  blocks: WorkBlock[];
  onChange: (blocks: WorkBlock[]) => void;
  /** A new start gets an end this far after it (an hour when not set). */
  estimatedMinutes: number;
}) {
  const Colors = useTheme();
  const isDark = useIsDark();
  const [open, setOpen] = useState<{ index: number; field: Field } | null>(null);

  const monoLabel = { fontSize: 10, fontWeight: '700' as const, letterSpacing: 1, color: Colors.subtext, marginBottom: 9, fontFamily: MONO };
  const total = timedBlockMinutes(blocks);
  // The first rule broken, shown under the header with its row outlined (D22).
  const error = workBlockError(blocks);

  const update = (index: number, patch: Partial<WorkBlock>) => {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };
  const close = () => {
    setOpen(null);
    onChange(sortWorkBlocks(blocks));
  };

  const add = () => {
    const date = nextFreeBlockDay(blocks, getLocalDateString());
    onChange([...blocks, { date, startMinutes: null, endMinutes: null }]);
    setOpen({ index: blocks.length, field: 'date' });
  };
  const remove = (index: number) => {
    setOpen(null);
    onChange(blocks.filter((_, i) => i !== index));
  };

  const handleDate = (event: DateTimePickerEvent, date?: Date) => {
    const target = open;
    setOpen(null);
    if (!target || event.type === 'dismissed' || !date) return;
    onChange(sortWorkBlocks(blocks.map((b, i) => (i === target.index ? { ...b, date: dateKeyOf(date) } : b))));
  };

  const handleTime = (_event: DateTimePickerEvent, date?: Date) => {
    const target = open;
    if (Platform.OS === 'android') setOpen(null);
    if (!target || !date) return;
    const picked = date.getHours() * 60 + date.getMinutes();
    if (target.field === 'end') { update(target.index, { endMinutes: picked }); return; }
    const current = blocks[target.index];
    // First time only: derive an end so one tap already makes a valid block.
    update(target.index, {
      startMinutes: picked,
      endMinutes: current.endMinutes ?? Math.min(1439, picked + (estimatedMinutes > 0 ? estimatedMinutes : 60)),
    });
  };

  const chip = (on: boolean) => ({
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, borderRadius: 10,
    paddingHorizontal: 11, paddingVertical: 9, minHeight: 36,
    backgroundColor: on ? Colors.primaryDim : Colors.raised,
  });
  const chipText = (on: boolean) => ({ fontSize: 12.5, fontWeight: '600' as const, color: on ? Colors.primarySoft : Colors.subtext });

  const openBlock = open ? blocks[open.index] : null;

  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={monoLabel}>{total > 0 ? `WORK BLOCKS · ${formatDuration(total * 60).toUpperCase()}` : 'WORK BLOCKS'}</Text>
      {error && <Text style={{ color: Colors.ROSE, fontSize: 11.5, marginBottom: 8 }}>{error.message}</Text>}

      {blocks.length === 0 && (
        <Text style={{ color: Colors.subtext, fontSize: 12, marginBottom: 4 }}>No work blocks yet</Text>
      )}

      {blocks.map((b, index) => {
        const day = parseLocalDate(b.date);
        const dayShort = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
        const dayLong = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
        const timed = b.startMinutes != null;
        const bad = error?.index === index;
        return (
          <View key={`${index}:${b.date}`}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap',
              borderRadius: 12, padding: bad ? 3 : 0, borderWidth: bad ? 1.5 : 0, borderColor: Colors.ROSE,
            }}>
              <TouchableOpacity
                onPress={() => setOpen({ index, field: 'date' })}
                accessibilityRole="button"
                accessibilityLabel={`Work block day, ${dayLong}, change`}
                style={chip(true)}
              >
                <Ionicons name="calendar-outline" size={13} color={Colors.primarySoft} />
                <Text style={chipText(true)}>{dayShort}</Text>
              </TouchableOpacity>
              {timed ? (
                <>
                  <TouchableOpacity
                    onPress={() => setOpen({ index, field: 'start' })}
                    accessibilityRole="button"
                    accessibilityLabel={`Start time, ${formatClock(b.startMinutes as number)}`}
                    style={chip(true)}
                  >
                    <Text style={chipText(true)}>{formatClock(b.startMinutes as number)}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: Colors.subtext }}>–</Text>
                  <TouchableOpacity
                    onPress={() => setOpen({ index, field: 'end' })}
                    accessibilityRole="button"
                    accessibilityLabel={b.endMinutes == null ? 'Set end time' : `End time, ${formatClock(b.endMinutes)}`}
                    style={chip(b.endMinutes != null)}
                  >
                    <Text style={chipText(b.endMinutes != null)}>{b.endMinutes == null ? 'End' : formatClock(b.endMinutes)}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  onPress={() => setOpen({ index, field: 'start' })}
                  accessibilityRole="button"
                  accessibilityLabel="Any time. Set a start time"
                  style={chip(false)}
                >
                  <Ionicons name="time-outline" size={13} color={Colors.subtext} />
                  <Text style={chipText(false)}>Any time</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => remove(index)}
                accessibilityRole="button"
                accessibilityLabel={`Remove work block, ${dayLong}`}
                style={{ marginLeft: 'auto', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={16} color={Colors.subtext} />
              </TouchableOpacity>
            </View>

            {open?.index === index && openBlock && (
              <View style={{ backgroundColor: Colors.raised, borderRadius: 13, marginBottom: 10, alignItems: 'center', overflow: 'hidden' }}>
                {open.field === 'date' ? (
                  <DateTimePicker
                    value={parseLocalDate(openBlock.date)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={handleDate}
                    themeVariant={isDark ? 'dark' : 'light'}
                    accentColor={Colors.primary}
                  />
                ) : (
                  <>
                    <DateTimePicker
                      value={minutesToDate(open.field === 'start' ? openBlock.startMinutes : openBlock.endMinutes)}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleTime}
                      themeVariant={isDark ? 'dark' : 'light'}
                      accentColor={Colors.primary}
                    />
                    <View style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
                      {openBlock.startMinutes != null && (
                        <TouchableOpacity
                          onPress={() => { update(index, { startMinutes: null, endMinutes: null }); setOpen(null); }}
                          accessibilityRole="button"
                          style={{ flex: 1, paddingVertical: 12, alignItems: 'center' }}
                        >
                          <Text style={{ color: Colors.subtext, fontSize: 13, fontWeight: '600' }}>Any time</Text>
                        </TouchableOpacity>
                      )}
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity
                          onPress={close}
                          accessibilityRole="button"
                          style={{ flex: 1, paddingVertical: 12, alignItems: 'center' }}
                        >
                          <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '700' }}>Done</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={add}
        accessibilityRole="button"
        accessibilityLabel="Add work block"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 }}
      >
        <Ionicons name="add" size={15} color={Colors.primarySoft} />
        <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '600' }}>Add work block</Text>
      </TouchableOpacity>
    </View>
  );
}
