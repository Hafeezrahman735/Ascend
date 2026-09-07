import { useMemo, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { useTaskStore } from '../../stores/taskStore';
import type { CalendarEvent, CalendarItem, CalendarStats, Note } from '../../types';
import { addDays, getLocalDateString, parseLocalDate } from '../../utils/date';
import {
  getCalendarStyles, bookedMinutes, formatMinutes, formatSeconds,
  countsTowardLoad, isPastEvent, calendarItemKey,
} from './shared';
import { weekTasksToWorkOn, estimatedMinutesRemaining } from '../../lib/planningTasks';
import StatsView from './StatsView';

/**
 * The Planning tab — first in the row, because deciding what to work on comes
 * before looking at any particular day.
 *
 * Two modes behind one toggle. Planning is forward-looking: what has no home
 * yet, what is already booked, and which day could take the rest. Stats is
 * backward-looking: what actually happened. They answer opposite questions about
 * the same week, which is why they share a tab rather than competing for two.
 */

type Mode = 'plan' | 'stats';

/** Rows a section shows before it collapses into a "+N more" line. */
const MAX_SECTION_ROWS = 5;

/**
 * The week's task list gets a longer leash than the other sections. It is the
 * one people came to read, and truncating a real week's work at five rows sends
 * them to the Tasks tab to see the rest, which is the whole point of the section
 * defeated.
 */
const MAX_WEEK_TASK_ROWS = 8;

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const Colors = useTheme();
  const options: { key: Mode; label: string }[] = [
    { key: 'plan', label: 'Plan' },
    { key: 'stats', label: 'Stats' },
  ];

  return (
    <View style={{
      flexDirection: 'row', gap: 3, padding: 3, alignSelf: 'flex-start',
      backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
      borderRadius: 10, marginHorizontal: 16, marginBottom: 14,
    }}>
      {options.map((option) => {
        const selected = mode === option.key;
        return (
          <TouchableOpacity
            key={option.key}
            onPress={() => onChange(option.key)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              paddingVertical: 7, paddingHorizontal: 16, borderRadius: 8,
              backgroundColor: selected ? Colors.primary : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 12, fontWeight: '700', letterSpacing: 0.5,
              color: selected ? '#fff' : Colors.subtext,
            }}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * A section label with an optional "+ Add" chip on the right.
 *
 * The count is emphasised by WEIGHT and brightness rather than hue. It used to
 * turn AMBER when non-empty, which is #D4820A in the light theme — about 3.0:1
 * on white at 10px, below the contrast floor for small text.
 */
function SectionHeader({
  label, count, onAdd, addLabel, trailing,
}: {
  label: string;
  count?: number;
  onAdd?: () => void;
  addLabel?: string;
  /** Quiet right-aligned detail, e.g. the week's estimated workload. */
  trailing?: string;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const emphasised = count !== undefined && count > 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <Text style={[
        styles.sectionLabel,
        { marginBottom: 0, flex: 1 },
        emphasised && { color: Colors.textBright },
      ]}>
        {label}{count !== undefined ? ` · ${count}` : ''}
      </Text>
      {trailing && (
        <Text style={{ color: Colors.subtext, fontSize: 10, marginRight: onAdd ? 8 : 0 }}>
          {trailing}
        </Text>
      )}
      {onAdd && (
        <TouchableOpacity
          onPress={onAdd}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={addLabel ?? `Add ${label.toLowerCase()}`}
          style={styles.addChip}
        >
          <Ionicons name="add" size={13} color={Colors.primarySoft} />
          <Text style={styles.addChipText}>Add</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const Colors = useTheme();
  return (
    <View style={{
      backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1,
      borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 4,
      marginBottom: 20,
    }}>
      {children}
    </View>
  );
}

function EmptyBox({ icon, text }: {
  icon: keyof typeof Ionicons.glyphMap; text: string;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  return (
    <View style={[styles.emptyBox, { marginBottom: 20 }]}>
      <Ionicons name={icon} size={24} color={Colors.subtext} />
      <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13, textAlign: 'center' }}>
        {text}
      </Text>
    </View>
  );
}

/** 'Mon' — the day badge each week-scoped row carries, since rows span the week. */
function dayBadge(dateKey: string): string {
  return parseLocalDate(dateKey).toLocaleDateString(undefined, { weekday: 'short' });
}

export default function PlanningView({
  stats,
  weekStart,
  itemsByDate,
  onDayPress,
  onAddEvent,
  onEditEvent,
  onAddNote,
  onEditNote,
}: {
  stats: CalendarStats | null;
  /** First day of the week this tab is showing. */
  weekStart: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  onDayPress: (dateKey: string) => void;
  onAddEvent: () => void;
  onEditEvent: (event: CalendarEvent) => void;
  onAddNote: () => void;
  onEditNote: (note: Note) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const [mode, setMode] = useState<Mode>('plan');

  const tasks = useTaskStore((s) => s.tasks);

  // Work with no home yet. A task with no due date appears on no day in the
  // calendar at all, so this list is the only place it is visible here.
  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.isCompleted && !t.isArchived && !t.dueDate),
    [tasks],
  );

  const days = useMemo(() => {
    const today = getLocalDateString();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const key = getLocalDateString(date);
      const items = itemsByDate.get(key) ?? [];
      return {
        key,
        date,
        isToday: key === today,
        isPast: key < today,
        booked: bookedMinutes(items),
        count: items.filter(countsTowardLoad).length,
      };
    });
  }, [weekStart, itemsByDate]);

  // Everything the week holds, flattened in day order — the sections below read
  // the week, not a single day, because that is the scope this tab operates at.
  const weekItems = useMemo(
    () => days.flatMap((day) => itemsByDate.get(day.key) ?? []),
    [days, itemsByDate],
  );

  const events = useMemo(() => weekItems.filter((i) => i.type === 'event'), [weekItems]);
  const notes = useMemo(() => weekItems.filter((i) => i.type === 'note'), [weekItems]);

  // The week's actual work. Derived from weekItems — the same array the day
  // strip counts — so the list and the per-day numbers above it can never
  // disagree about what the week holds.
  const todayKey = getLocalDateString();
  const weekTasks = useMemo(() => weekTasksToWorkOn(weekItems, todayKey), [weekItems, todayKey]);

  // Recurring occurrences before today are dropped on purpose, so a week that
  // has already finished holds no habits at all. Correct, but it renders as an
  // unexplained empty section unless the copy says why — see the empty state.
  const isPastWeek = days.length > 0 && days[days.length - 1].key < todayKey;
  const weekTaskMinutes = useMemo(() => estimatedMinutesRemaining(weekTasks), [weekTasks]);

  // Read per render rather than memoised: whether an event has passed changes
  // with the clock, not with the data, so pinning it to a dependency would leave
  // this afternoon looking live all evening.
  const now = new Date();

  if (mode === 'stats') {
    return (
      <View>
        <ModeToggle mode={mode} onChange={setMode} />
        <StatsView stats={stats} />
      </View>
    );
  }

  return (
    <View>
      <ModeToggle mode={mode} onChange={setMode} />

      <View style={{ paddingHorizontal: 16 }}>
        {/* ── This week's work ─────────────────────────────────────────────
            The section that answers "what do I actually have to do this week".
            It leads because that is the question you open Planning to ask; the
            events and notes below are context around it, not the work itself. */}
        {/* formatSeconds, not formatMinutes, for the estimate: this is a
            DURATION. formatMinutes renders minutes-from-midnight as a clock time
            and clamps at 23:59, so a 30-hour week would have read "11:59 PM". */}
        <SectionHeader
          label="THIS WEEK"
          count={weekTasks.length}
          trailing={weekTaskMinutes > 0 ? `${formatSeconds(weekTaskMinutes * 60)} estimated` : undefined}
        />

        {weekTasks.length === 0 ? (
          <EmptyBox
            icon="checkmark-done-outline"
            text={isPastWeek
              ? 'That week is done. Missed habits are not carried forward.'
              : 'No tasks due this week. Nothing waiting on you.'}
          />
        ) : (
          <Card>
            {weekTasks.slice(0, MAX_WEEK_TASK_ROWS).map((t) => (
              <View key={t.key} style={styles.itemRow}>
                <View style={{
                  width: 3, alignSelf: 'stretch', borderRadius: 2,
                  backgroundColor: t.isOverdue ? Colors.ROSE : t.isToday ? Colors.AMBER : Colors.primary,
                }} />
                <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>
                  {t.title}
                </Text>
                {t.isRecurring && (
                  <Ionicons name="repeat" size={12} color={Colors.subtext} />
                )}
                <Text style={{
                  fontSize: 10,
                  color: t.isOverdue ? Colors.ROSE : t.isToday ? Colors.AMBER : Colors.subtext,
                  fontWeight: t.isOverdue || t.isToday ? '700' : '400',
                }}>
                  {t.isOverdue ? 'Late' : t.isToday ? 'Today' : dayBadge(t.dateKey)}
                  {t.startMinutes != null ? ` · ${formatMinutes(t.startMinutes)}` : ''}
                  {t.startMinutes == null && t.estimatedMinutes ? ` · ${t.estimatedMinutes}m` : ''}
                </Text>
              </View>
            ))}
            {weekTasks.length > MAX_WEEK_TASK_ROWS && (
              <Text style={{ color: Colors.subtext, fontSize: 11, paddingVertical: 7 }}>
                +{weekTasks.length - MAX_WEEK_TASK_ROWS} more this week
              </Text>
            )}
          </Card>
        )}

        {/* ── Unscheduled ──────────────────────────────────────────────────
            Tasks with no due date — work that appears on no day in the calendar,
            so this stays its only home here. Rendered only when there is some:
            a permanently empty box was most of what this tab used to show. */}
        {unscheduled.length > 0 && (
          <>
            <SectionHeader label="UNSCHEDULED" count={unscheduled.length} />
            <Card>
              {unscheduled.slice(0, MAX_SECTION_ROWS).map((task) => (
                <View key={task.id} style={styles.itemRow}>
                  <View style={{
                    width: 3, alignSelf: 'stretch', borderRadius: 2,
                    backgroundColor: task.estimatedMinutes ? Colors.primary : Colors.subtext,
                  }} />
                  <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>
                    {task.title}
                  </Text>
                  {task.estimatedMinutes ? (
                    <Text style={{ color: Colors.subtext, fontSize: 10 }}>
                      {task.estimatedMinutes}m
                    </Text>
                  ) : null}
                </View>
              ))}
              {unscheduled.length > MAX_SECTION_ROWS && (
                <Text style={{ color: Colors.subtext, fontSize: 11, paddingVertical: 7 }}>
                  +{unscheduled.length - MAX_SECTION_ROWS} more
                </Text>
              )}
            </Card>
          </>
        )}

        {/* ── Events ──────────────────────────────────────────────────────
            The entry point and the edit path in one section. Nothing else in
            the calendar can open an event: a timed one exists only as a block
            on the day grid, and this list is the guaranteed-reachable way in. */}
        <SectionHeader
          label="EVENTS"
          count={events.length}
          onAdd={onAddEvent}
          addLabel="Add an event"
        />

        {events.length === 0 ? (
          <EmptyBox icon="calendar-outline" text="Nothing booked this week." />
        ) : (
          <Card>
            {events.slice(0, MAX_SECTION_ROWS).map((item) => {
              const event = item.data as CalendarEvent;
              const past = isPastEvent(item, now);
              return (
                <TouchableOpacity
                  key={calendarItemKey(item)}
                  onPress={() => onEditEvent(event)}
                  style={[styles.itemRow, { opacity: past ? 0.55 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Event: ${event.title}, ${parseLocalDate(event.date).toLocaleDateString(undefined, { weekday: 'long' })}${
                    event.startMinutes != null ? `, ${formatMinutes(event.startMinutes)}` : ', all day'
                  }${past ? ', past' : ''}`}
                >
                  <View style={{
                    width: 3, alignSelf: 'stretch', borderRadius: 2,
                    backgroundColor: Colors.AMBER,
                  }} />
                  <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={{ color: Colors.subtext, fontSize: 10 }}>
                    {dayBadge(event.date)}
                    {event.startMinutes != null ? ` · ${formatMinutes(event.startMinutes)}` : ' · all day'}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {events.length > MAX_SECTION_ROWS && (
              <Text style={{ color: Colors.subtext, fontSize: 11, paddingVertical: 7 }}>
                +{events.length - MAX_SECTION_ROWS} more this week
              </Text>
            )}
          </Card>
        )}

        {/* ── Notes & to-dos ──────────────────────────────────────────── */}
        <SectionHeader
          label="NOTES & TO-DOS"
          count={notes.length}
          onAdd={onAddNote}
          addLabel="Add a note"
        />

        {notes.length === 0 ? (
          <EmptyBox icon="document-text-outline" text="Nothing noted this week." />
        ) : (
          <Card>
            {notes.slice(0, MAX_SECTION_ROWS).map((item) => {
              const note = item.data as Note;
              return (
                <TouchableOpacity
                  key={calendarItemKey(item)}
                  onPress={() => onEditNote(note)}
                  style={styles.itemRow}
                  accessibilityRole="button"
                  accessibilityLabel={`${note.isTodo ? 'To-do' : 'Note'}: ${note.content}${note.isCompleted ? ', done' : ''}`}
                >
                  <Ionicons
                    name={note.isTodo ? (note.isCompleted ? 'checkbox' : 'square-outline') : 'document-text-outline'}
                    size={15}
                    color={note.isCompleted ? Colors.accent : Colors.subtext}
                  />
                  <Text
                    style={{
                      flex: 1, fontSize: 13,
                      color: note.isCompleted ? Colors.subtext : Colors.text,
                      textDecorationLine: note.isCompleted ? 'line-through' : 'none',
                    }}
                    numberOfLines={1}
                  >
                    {note.content}
                  </Text>
                  {note.date && (
                    <Text style={{ color: Colors.subtext, fontSize: 10 }}>{dayBadge(note.date)}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            {notes.length > MAX_SECTION_ROWS && (
              <Text style={{ color: Colors.subtext, fontSize: 11, paddingVertical: 7 }}>
                +{notes.length - MAX_SECTION_ROWS} more this week
              </Text>
            )}
          </Card>
        )}

        {/* ── Where it could go ───────────────────────────────────────── */}
        <SectionHeader label="THIS WEEK" />

        <View style={{ flexDirection: 'row', gap: 5, marginBottom: 6 }}>
          {days.map((day) => (
            <TouchableOpacity
              key={day.key}
              onPress={() => onDayPress(day.key)}
              accessibilityRole="button"
              accessibilityLabel={`${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${day.count} scheduled, ${Math.round(day.booked / 60 * 10) / 10} hours booked`}
              style={{
                flex: 1, alignItems: 'center', borderRadius: 11, paddingVertical: 10,
                backgroundColor: day.isToday ? Colors.primaryDim : Colors.raised,
                borderWidth: 1,
                borderColor: day.isToday ? Colors.primary : 'transparent',
                opacity: day.isPast ? 0.5 : 1,
              }}
            >
              <Text style={{
                fontSize: 9, fontWeight: '700',
                color: day.isToday ? Colors.primarySoft : Colors.subtext,
              }}>
                {day.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Text>
              <Text style={{
                fontSize: 13, fontWeight: '700', marginTop: 2,
                color: day.isToday ? Colors.primarySoft : Colors.textBright,
              }}>
                {day.date.getDate()}
              </Text>
              <Text style={{
                fontSize: 9, marginTop: 3,
                color: day.booked > 0 ? Colors.primarySoft : Colors.subtext,
              }}>
                {day.booked > 0 ? formatSeconds(day.booked * 60) : '—'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* "Booked", not "planned" and not "free". Events count toward this
            total alongside tasks — an hour at the dentist is gone whatever the
            reason — and "booked" is the honest word for that, where "planned"
            would claim the time was chosen. "Free" would need a working-day
            budget nobody has set, making the most prominent number a guess. */}
        <Text style={{ color: Colors.subtext, fontSize: 11, marginBottom: 24 }}>
          Hours already booked on each day. Tap a day to open it.
        </Text>
      </View>
    </View>
  );
}
