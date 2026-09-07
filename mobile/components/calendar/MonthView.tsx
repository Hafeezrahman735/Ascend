import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import type { CalendarItem, Note } from '../../types';
import { eachDayOfRange, getLocalDateString, parseLocalDate, startOfMonth, endOfMonth } from '../../utils/date';
import {
  itemTitle, itemIsDone, typeColor, itemTimeRange, countsTowardLoad, isNote,
  itemWeight, bookedMinutes as sumBookedMinutes,
  calendarItemKey, formatMinutes, formatSeconds, getCalendarStyles,
} from './shared';

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Month as a workload grid.
 *
 * Cells are shaded by how much of the day is spoken for, not by which item types
 * are present. An earlier version drew one coloured dot per type, which answered
 * "what kind of thing is on the 12th" — a question nobody asks at month zoom.
 * The question at this zoom is "which week am I going to regret", and shading
 * answers it without reading a single word.
 *
 * The shading is by WEIGHT, not by booked minutes. It used to be by minutes, and
 * that made the map count roughly a third of what was on a day: an untimed task
 * and a goal deadline both carry no clock, so both scored zero and fell to a
 * count-based fallback that only knew "three or more". A day holding nothing but
 * a hard deadline rendered as an empty one. itemWeight gives every non-note type
 * a positive number, which is what let the fallback go.
 *
 * The panel below still reports real booked minutes, from a separate sum. Weight
 * is a judgement and must never be printed as if it were measured.
 */

/** Weight thresholds. These are rendering decisions — how many shades of the
 *  primary hue a month should span — so they live here, not beside the weights
 *  in lib/calendarItems.ts. */
const LIGHT_MINUTES = 60;
const SOME_MINUTES = 150;
const HEAVY_MINUTES = 300;

type Load = 'free' | 'light' | 'some' | 'heavy' | 'full';

const LOAD_STEPS: Load[] = ['free', 'light', 'some', 'heavy', 'full'];

function loadForWeight(weight: number): Load {
  if (weight <= 0) return 'free';
  if (weight >= HEAVY_MINUTES) return 'full';
  if (weight >= SOME_MINUTES) return 'heavy';
  if (weight >= LIGHT_MINUTES) return 'some';
  return 'light';
}

/**
 * Load shades the cell; booked is what the panel prints. Deliberately two
 * numbers: a day with one untimed task weighs 30 and has booked nothing, and
 * printing "30m booked" there would be a fabrication.
 *
 * Notes contribute zero weight by itemWeight's own contract — a jotting is not
 * work — so they need no filtering here.
 */
function dayLoad(items: CalendarItem[]): { load: Load; booked: number } {
  let weight = 0;
  for (const item of items) weight += itemWeight(item);
  return { load: loadForWeight(weight), booked: sumBookedMinutes(items) };
}

/**
 * Blends two hex colours, `t` of the way from `a` to `b`.
 *
 * Used for exactly one step of the ramp — the gap between primaryDim and
 * primary — rather than adding a palette token that only this screen would ever
 * read. Both themes are plain 6-digit hex; anything else falls back to `b`
 * instead of rendering an invalid colour.
 */
function mixHex(a: string, b: string, t: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(a) || !/^#[0-9a-fA-F]{6}$/.test(b)) return b;
  const channel = (i: number) => {
    const from = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const to = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(from + (to - from) * t).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/**
 * Five steps, five distinguishable backgrounds. `free` used to share `raised`
 * with `light`, so a scale with four levels rendered as three and the emptiest
 * days were indistinguishable from the barely-used ones.
 */
function cellColors(load: Load, Colors: ThemeColors): { bg: string; fg: string } {
  switch (load) {
    case 'full':  return { bg: Colors.primary, fg: '#fff' };
    case 'heavy': return { bg: mixHex(Colors.primaryDim, Colors.primary, 0.5), fg: Colors.textBright };
    case 'some':  return { bg: Colors.primaryDim, fg: Colors.textBright };
    case 'light': return { bg: Colors.raised, fg: Colors.text };
    // One step off the page rather than a named token: surface is DARKER than
    // raised in the dark theme but LIGHTER in the light one, so it reads as an
    // empty cell in one and vanishes into the background in the other. Blending
    // from bg toward raised keeps the ramp monotonic in both.
    default:      return { bg: mixHex(Colors.bg, Colors.raised, 0.35), fg: Colors.subtext };
  }
}

/** What the cell reads out. Hours alone stopped being the whole story once
 *  untimed work started counting. */
const LOAD_PHRASE: Record<Load, string> = {
  free: 'nothing scheduled',
  light: 'light day',
  some: 'some load',
  heavy: 'heavy day',
  full: 'full day',
};

function StatTile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  const Colors = useTheme();
  return (
    <View style={{
      flex: 1, backgroundColor: Colors.raised, borderRadius: 10,
      paddingVertical: 9, alignItems: 'center',
    }}>
      <Text style={{
        fontSize: 15, fontWeight: '700',
        color: accent ? Colors.AMBER : Colors.textBright,
      }}>
        {value}
      </Text>
      <Text style={{ fontSize: 9, color: Colors.subtext, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export default function MonthView({
  anchorDate,
  itemsByDate,
  onDayPress,
  onToggleNote,
}: {
  anchorDate: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (date: string) => void;
  onToggleNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const first = useMemo(() => startOfMonth(anchorDate), [anchorDate]);
  const days = useMemo(() => eachDayOfRange(first, endOfMonth(anchorDate)), [first, anchorDate]);
  const leadingBlanks = first.getDay();
  const todayKey = getLocalDateString();

  // The panel below follows the grid. DERIVED, not synced in an effect: paging
  // to another month makes the stored key fall out of `days` and the fallback
  // takes over on the same render, so the panel can never describe a day that
  // is not visible above it.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selectedKey = pickedKey && days.includes(pickedKey)
    ? pickedKey
    : (days.includes(todayKey) ? todayKey : days[0]);

  const selectedItems = itemsByDate.get(selectedKey) ?? [];
  const selectedScheduled = selectedItems.filter(countsTowardLoad);
  // Notes were absent from this panel entirely, which made Month the one
  // view where a note could not be seen at all — not even a to-do.
  const selectedNotes = selectedItems.filter(isNote).map((i) => i.data as Note);
  const { booked: selectedBooked } = dayLoad(selectedItems);
  const taskCount = selectedScheduled.filter(
    (i) => i.type === 'task' || i.type === 'habit_instance',
  ).length;
  // Events, from here or from a linked calendar. Goal deadlines are neither, and
  // land in neither tile on purpose — a deadline is a date, not an appointment.
  const eventCount = selectedScheduled.filter(
    (i) => i.type === 'event' || i.type === 'external_google' || i.type === 'external_apple',
  ).length;

  return (
    <View>
      {/* ── Legend ────────────────────────────────────────────────────────
          All five steps, because a scale that names two of its five levels is
          asking the reader to guess the rest. ──────────────────────────────── */}
      <View style={{
        flexDirection: 'row', gap: 9, justifyContent: 'flex-end',
        alignItems: 'center', paddingHorizontal: 16, marginBottom: 10,
      }}>
        {LOAD_STEPS.map((step) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{
              width: 7, height: 7, borderRadius: 2,
              backgroundColor: cellColors(step, Colors).bg,
              borderWidth: step === 'free' ? 1 : 0, borderColor: Colors.border,
            }} />
            <Text style={{ fontSize: 9.5, color: Colors.subtext }}>{step}</Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {WEEKDAY_INITIALS.map((d, i) => (
            <Text
              key={i}
              style={{ flex: 1, textAlign: 'center', fontSize: 9, color: Colors.subtext }}
            >
              {d}
            </Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
              <View style={{ aspectRatio: 1 }} />
            </View>
          ))}

          {days.map((dateKey) => {
            const dayItems = itemsByDate.get(dateKey) ?? [];
            const { load, booked } = dayLoad(dayItems);
            // Notes deliberately do NOT shade the cell: the heat map answers
            // "how heavy is this day", and a jotting is not weight. They get a
            // dot instead, so a note-only day stops reading as a blank one.
            const noteCount = dayItems.filter(isNote).length;
            const isSelected = dateKey === selectedKey;
            const isToday = dateKey === todayKey;
            const { bg, fg } = cellColors(load, Colors);

            return (
              <View key={dateKey} style={{ width: `${100 / 7}%`, padding: 1.5 }}>
                <TouchableOpacity
                  onPress={() => setPickedKey(dateKey)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${parseLocalDate(dateKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${LOAD_PHRASE[load]}${booked > 0 ? `, ${Math.round(booked / 60 * 10) / 10} hours booked` : ''}${noteCount > 0 ? `, ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}`}
                  style={{
                    aspectRatio: 1, borderRadius: 8,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isSelected ? Colors.primary : bg,
                    borderWidth: isSelected || isToday ? 2 : 0,
                    borderColor: isSelected ? Colors.primarySoft : Colors.primary,
                  }}
                >
                  <Text style={{
                    fontSize: isSelected ? 11 : 10,
                    fontWeight: isSelected || isToday ? '700' : '500',
                    color: isSelected ? '#fff' : isToday ? Colors.primary : fg,
                  }}>
                    {parseLocalDate(dateKey).getDate()}
                  </Text>
                  {noteCount > 0 && (
                    <View style={{
                      width: 4, height: 4, borderRadius: 2, marginTop: 2,
                      backgroundColor: isSelected ? '#fff' : typeColor('note', Colors),
                    }} />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Live panel for the selected day ───────────────────────────── */}
      <View style={{
        margin: 16, padding: 15,
        backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary,
        borderRadius: 16,
      }}>
        <TouchableOpacity
          onPress={() => onDayPress(selectedKey)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Open ${parseLocalDate(selectedKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} in Day view`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 11 }}
        >
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textBright }}>
            {parseLocalDate(selectedKey).toLocaleDateString(undefined, {
              weekday: 'long', month: 'short', day: 'numeric',
            })}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.primarySoft }}>
            {selectedScheduled.length} SCHEDULED{selectedNotes.length > 0 ? ` · ${selectedNotes.length} NOTE${selectedNotes.length === 1 ? '' : 'S'}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={Colors.subtext} />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 11 }}>
          <StatTile value={selectedBooked > 0 ? formatSeconds(selectedBooked * 60) : '—'} label="booked" />
          <StatTile value={String(taskCount)} label={taskCount === 1 ? 'task' : 'tasks'} />
          <StatTile value={String(eventCount)} label={eventCount === 1 ? 'event' : 'events'} accent={eventCount > 0} />
        </View>

        {selectedScheduled.length === 0 && selectedNotes.length === 0 ? (
          <Text style={{ color: Colors.subtext, fontSize: 12.5 }}>Nothing on this day.</Text>
        ) : (
          selectedScheduled.slice(0, 4).map((item, idx) => {
            const range = itemTimeRange(item);
            const done = itemIsDone(item);
            return (
              <View
                key={calendarItemKey(item)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
                  borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: Colors.border,
                }}
              >
                <View style={{
                  width: 3, height: 14, borderRadius: 2,
                  backgroundColor: typeColor(item.type, Colors),
                }} />
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1, fontSize: 12.5,
                    color: done ? Colors.subtext : Colors.text,
                    textDecorationLine: done ? 'line-through' : 'none',
                  }}
                >
                  {itemTitle(item)}
                </Text>
                {range && (
                  <Text style={{ fontSize: 10, color: Colors.subtext }}>
                    {formatMinutes(range.start)}
                  </Text>
                )}
              </View>
            );
          })
        )}

        {selectedScheduled.length > 4 && (
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 6 }}>
            +{selectedScheduled.length - 4} more
          </Text>
        )}

        {/* To-dos stay toggleable, matching Week view. A plain note is not a
            checkbox, so it gets a row rather than a control that does nothing. */}
        {selectedNotes.map((note) => (
          note.isTodo ? (
            <TouchableOpacity
              key={note.id}
              onPress={() => onToggleNote(note)}
              style={styles.todoRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: note.isCompleted }}
            >
              <Ionicons
                name={note.isCompleted ? 'checkbox' : 'square-outline'}
                size={15}
                color={note.isCompleted ? Colors.accent : Colors.subtext}
              />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1, fontSize: 12,
                  color: note.isCompleted ? Colors.subtext : Colors.text,
                  textDecorationLine: note.isCompleted ? 'line-through' : 'none',
                }}
              >
                {note.content}
              </Text>
            </TouchableOpacity>
          ) : (
            <View key={note.id} style={styles.todoRow} accessibilityRole="text">
              <Ionicons name="document-text-outline" size={14} color={Colors.subtext} />
              <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: Colors.text }}>
                {note.content}
              </Text>
            </View>
          )
        ))}
      </View>
    </View>
  );
}
