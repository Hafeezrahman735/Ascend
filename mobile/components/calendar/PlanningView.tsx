import { useMemo, type ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import { useTaskStore } from '../../stores/taskStore';
import type { CalendarItem, Note, Task } from '../../types';
import { addDays, getLocalDateString, parseLocalDate } from '../../utils/date';
import { getCalendarStyles, formatMinutes, itemTimeRange, calendarItemKey, typeColor } from './shared';
import { unscheduledTasks, weekTasksToWorkOn } from '../../lib/planningTasks';
import { topTasks } from '../../lib/taskBoard';
import { getDueChip } from '../../lib/taskMetrics';
import {
  alsoToday, findSlot, nextUp, weekBreakdown, weekPosition, weekRows, type Slot, type WeekRow,
} from '../../lib/planScreen';
import AddRow, { type AddKind } from './AddRow';
import { DayRowList, dayName, hoursLabel, type PlanHighlight } from './DayRows';

export type { PlanHighlight } from './DayRows';

/**
 * The Plan screen, the Calendar tab's landing view (design G).
 *
 * Top to bottom: the week's booked hours as a header band, the add buttons,
 * the Today card (Next up and Start focus), Also today, the rest of the week
 * as rows you tap to expand, and Unscheduled with Find a slot. Every number and
 * pick comes from lib/planScreen.ts; this file only lays them out.
 *
 * Booked hours only: there is no work-day length, so nothing here says "free".
 * The Stats mode that used to share this tab is gone; its numbers live in the
 * Time tab.
 */

/** Rows the Also today list shows before "+N more". */
const MAX_ALSO_TODAY = 5;
function SectionHeader({ label, count, trailing }: { label: string; count?: number; trailing?: string }) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
      <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }, count ? { color: Colors.textBright } : null]}>
        {label}{count !== undefined ? ` · ${count}` : ''}
      </Text>
      {trailing && <Text style={{ color: Colors.subtext, fontSize: 11 }}>{trailing}</Text>}
    </View>
  );
}

function Card({ children, Colors }: { children: ReactNode; Colors: ThemeColors }) {
  return (
    <View style={{
      backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1,
      borderColor: Colors.border,
      paddingHorizontal: 14, paddingVertical: 4, marginBottom: 20,
    }}>
      {children}
    </View>
  );
}

/** A colored stripe, the calendar's existing row marker (DR5). */
function Stripe({ color }: { color: string }) {
  return <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: color, minHeight: 16 }} />;
}

// ── Header band (DR4) ─────────────────────────────────────────

function HeaderBand({ items }: { items: CalendarItem[] }) {
  const Colors = useTheme();
  const b = useMemo(() => weekBreakdown(items), [items]);
  if (b.total === 0) {
    return (
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Text style={{ color: Colors.textBright, fontSize: 17, fontWeight: '700' }}>Nothing booked this week</Text>
      </View>
    );
  }
  const parts = [
    { key: 'tasks', label: 'Tasks', minutes: b.tasks, color: Colors.primary },
    { key: 'events', label: 'Events', minutes: b.events, color: Colors.AMBER },
    { key: 'recurring', label: 'Recurring', minutes: b.recurring, color: Colors.accent },
  ].filter((p) => p.minutes > 0);
  return (
    <View
      style={{ paddingHorizontal: 16, paddingBottom: 12 }}
      accessible
      accessibilityLabel={`${hoursLabel(b.total)} booked this week: ${parts.map((p) => `${p.label} ${hoursLabel(p.minutes)}`).join(', ')}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ color: Colors.textBright, fontSize: 22, fontWeight: '800' }}>{hoursLabel(b.total)}</Text>
        <Text style={{ color: Colors.subtext, fontSize: 12 }}>booked this week</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        {parts.map((p) => (
          <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: p.color }} />
            <Text style={{ color: Colors.subtext, fontSize: 11 }}>{p.label} {hoursLabel(p.minutes)}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8, backgroundColor: Colors.inactive }}>
        {parts.map((p) => (
          <View key={p.key} style={{ flex: p.minutes, backgroundColor: p.color }} />
        ))}
      </View>
    </View>
  );
}

// ── Today card ────────────────────────────────────────────────

/** Today's timed blocks as a strip; a tap opens today in Day view. */
function DayBar({ items, onPress }: { items: CalendarItem[]; onPress: () => void }) {
  const Colors = useTheme();
  const blocks = items
    .map((item) => ({ item, range: itemTimeRange(item) }))
    .filter((b): b is { item: CalendarItem; range: { start: number; end: number } } => b.range !== null);
  // The strip spans 8 AM to 6 PM, widened to fit anything earlier or later.
  const from = Math.min(8 * 60, ...blocks.map((b) => b.range.start));
  const to = Math.max(18 * 60, ...blocks.map((b) => b.range.end));
  const span = to - from;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open today in Day view"
      style={{ paddingVertical: 8 }}
    >
      <View style={{ height: 8, borderRadius: 4, backgroundColor: Colors.inactive, overflow: 'hidden' }}>
        {blocks.map(({ item, range }) => (
          <View
            key={calendarItemKey(item)}
            style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${((range.start - from) / span) * 100}%`,
              width: `${((range.end - range.start) / span) * 100}%`,
              backgroundColor: typeColor(item.type, Colors),
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
        <Text style={{ fontSize: 9, color: Colors.subtext }}>{formatMinutes(from)}</Text>
        <Text style={{ fontSize: 9, color: Colors.subtext }}>{formatMinutes(Math.min(to, 1439))}</Text>
      </View>
    </TouchableOpacity>
  );
}

function TodayCard({ todayKey, todayItems, nowMinutes, fallback, onOpenDay, onStartFocus, onAddTask }: {
  todayKey: string;
  todayItems: CalendarItem[];
  nowMinutes: number;
  fallback: Task | null;
  onOpenDay: (date: string) => void;
  onStartFocus: (taskId: string) => void;
  onAddTask: () => void;
}) {
  const Colors = useTheme();
  const next = nextUp(todayItems, nowMinutes, fallback);
  const booked = todayItems.reduce((sum, item) => {
    const r = itemTimeRange(item);
    return r ? sum + (r.end - r.start) : sum;
  }, 0);
  const heading = parseLocalDate(todayKey)
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
    .toUpperCase();

  return (
    <View style={{
      backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.primary,
      padding: 14, marginBottom: 20,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        {/* DR7: amber text, the founder's choice after the visual board. Bold
            and 11pt to soften its low light-theme contrast. */}
        <Text style={{ color: Colors.AMBER, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 }}>TODAY · {heading}</Text>
        {booked > 0 && <Text style={{ color: Colors.text, fontSize: 11 }}>{hoursLabel(booked)} booked</Text>}
      </View>

      {next === null ? (
        <>
          <Text style={{ color: Colors.textBright, fontSize: 15, fontWeight: '700', marginTop: 10 }}>Nothing planned today</Text>
          <TouchableOpacity
            onPress={onAddTask}
            accessibilityRole="button"
            accessibilityLabel="Add a task"
            style={{ marginTop: 12, minHeight: 44, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Task</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <DayBar items={todayItems} onPress={() => onOpenDay(todayKey)} />
          <Text style={{ color: Colors.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginTop: 6 }}>NEXT UP</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 }}>
            <Stripe color={next.kind === 'timed' ? typeColor(next.item.type, Colors) : Colors.primary} />
            <Text style={{ flex: 1, color: Colors.textBright, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
              {next.kind === 'timed' ? next.title : next.task.title}
            </Text>
            {next.kind === 'timed' && (
              <Text style={{ color: Colors.subtext, fontSize: 11 }}>
                {formatMinutes(next.range.start)} · {hoursLabel(next.range.end - next.range.start)}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => onStartFocus(next.kind === 'timed' ? next.taskId : next.task.id)}
            accessibilityRole="button"
            accessibilityLabel={`Start focus on ${next.kind === 'timed' ? next.title : next.task.title}`}
            style={{ marginTop: 6, minHeight: 44, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
          >
            <Ionicons name="play" size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Start focus</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ── Week rows (DR8, DR9) ──────────────────────────────────────

/**
 * Keyed by the week in its parent, so expansion state starts fresh (all
 * collapsed, DR9) on every week. The rows themselves are DayRowList, shared
 * with Week view; this supplies Plan's strip: day, hours, load bar, count.
 */
function WeekRowsSection({ rows, title, highlight, onItemPress, onToggleNote, onOpenDay }: {
  rows: WeekRow[];
  title: string;
  highlight: PlanHighlight | null;
  onItemPress: (item: CalendarItem) => void;
  onToggleNote: (note: Note) => void;
  onOpenDay: (date: string) => void;
}) {
  const Colors = useTheme();
  const total = rows.reduce((sum, r) => sum + r.booked, 0);

  if (rows.length === 0) {
    return (
      <>
        <SectionHeader label={title} />
        <Text style={{ color: Colors.subtext, fontSize: 12.5, marginBottom: 20 }}>Nothing left this week.</Text>
      </>
    );
  }
  const countLabel = (row: WeekRow) => {
    const count = row.items.length;
    return count === 0 ? 'Nothing' : `${count} item${count === 1 ? '' : 's'}`;
  };
  return (
    <>
      <SectionHeader label={title} trailing={total > 0 ? `${hoursLabel(total)} booked` : undefined} />
      <Card Colors={Colors}>
        <DayRowList
          rows={rows}
          highlight={highlight}
          onItemPress={onItemPress}
          onToggleNote={onToggleNote}
          onOpenDay={onOpenDay}
          expandedIndent={64}
          a11ySummary={(row) => `${dayName(row.key, 'long')}, ${row.booked > 0 ? `${hoursLabel(row.booked)} booked` : 'nothing booked'}, ${countLabel(row)}`}
          renderSummary={(row) => (
            <>
              <View style={{ width: 54 }}>
                <Text style={{ color: Colors.textBright, fontSize: 12.5, fontWeight: '700' }}>{dayName(row.key)}</Text>
                <Text style={{ color: Colors.subtext, fontSize: 10 }}>{row.booked > 0 ? hoursLabel(row.booked) : '—'}</Text>
              </View>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.inactive, overflow: 'hidden' }}>
                <View style={{ width: `${row.barFraction * 100}%`, height: '100%', backgroundColor: Colors.primary }} />
              </View>
              <Text style={{ color: Colors.subtext, fontSize: 11, minWidth: 52, textAlign: 'right' }}>{countLabel(row)}</Text>
            </>
          )}
        />
      </Card>
    </>
  );
}

// ── Screen ────────────────────────────────────────────────────

export default function PlanningView({
  weekStart,
  itemsByDate,
  highlight,
  onAdd,
  onOpenDay,
  onItemPress,
  onToggleNote,
  onOpenTask,
  onStartFocus,
  onFindSlot,
}: {
  /** First day of the anchored week. */
  weekStart: Date;
  itemsByDate: Map<string, CalendarItem[]>;
  /** A task just saved from this screen, to open its day and tint its row. */
  highlight: PlanHighlight | null;
  onAdd: (kind: AddKind) => void;
  onOpenDay: (date: string) => void;
  /** An item in a day row or Also today: opens its event, note or task sheet. */
  onItemPress: (item: CalendarItem) => void;
  /** Ticks a to-do note from its checkbox (D10). */
  onToggleNote: (note: Note) => void;
  /** An unscheduled task: opens its task details sheet. */
  onOpenTask: (task: Task) => void;
  onStartFocus: (taskId: string) => void;
  onFindSlot: (task: Task, slot: Slot) => void;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const tasks = useTaskStore((s) => s.tasks);

  // Read per render, never captured: the tab stays mounted, so a value read
  // once would go stale overnight or as the afternoon passes.
  const now = new Date();
  const todayKey = getLocalDateString(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const dayKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => getLocalDateString(addDays(weekStart, i))),
    [weekStart],
  );
  const weekKey = dayKeys[0];
  const position = weekPosition(dayKeys, todayKey);
  const weekItems = useMemo(
    () => dayKeys.flatMap((k) => itemsByDate.get(k) ?? []),
    [dayKeys, itemsByDate],
  );
  const todayItems = itemsByDate.get(todayKey) ?? [];

  const fallback = topTasks(tasks, now, 1)[0] ?? null;
  const next = nextUp(todayItems, nowMinutes, fallback);
  const also = position === 'current' ? alsoToday(weekTasksToWorkOn(weekItems, todayKey, tasks), next) : [];
  const rows = weekRows(dayKeys, itemsByDate, todayKey);

  // Work with nothing planned ahead: no work block from today to the end of
  // this week (D4, D13). A due date is not a plan, so a dated task with no
  // block is here too, showing when it is due; so is one whose only block
  // this week has passed.
  const unscheduled = unscheduledTasks(tasks, todayKey, dayKeys[dayKeys.length - 1]);

  return (
    <View>
      <HeaderBand items={weekItems} />

      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <AddRow onAdd={onAdd} />
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        {position === 'current' && (
          <TodayCard
            todayKey={todayKey}
            todayItems={todayItems}
            nowMinutes={nowMinutes}
            fallback={fallback}
            onOpenDay={onOpenDay}
            onStartFocus={onStartFocus}
            onAddTask={() => onAdd('task')}
          />
        )}

        {also.length > 0 && (
          <>
            <SectionHeader label="ALSO TODAY" count={also.length} />
            <Card Colors={Colors}>
              {also.slice(0, MAX_ALSO_TODAY).map((t) => (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => onItemPress(t.item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.isRecurring ? 'Recurring task' : 'Task'}: ${t.title}${t.isOverdue ? `, late, due ${dayName(t.dateKey, 'long')}` : t.startMinutes != null ? `, ${formatMinutes(t.startMinutes)}` : ''}`}
                  style={[styles.itemRow, { minHeight: 44 }]}
                >
                  <Stripe color={t.isOverdue ? Colors.ROSE : t.isRecurring ? Colors.accent : Colors.primary} />
                  <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>{t.title}</Text>
                  {t.isRecurring && <Ionicons name="repeat" size={12} color={Colors.subtext} />}
                  <Text style={{
                    fontSize: 11,
                    color: t.isOverdue ? Colors.ROSE : Colors.subtext,
                    fontWeight: t.isOverdue ? '700' : '400',
                  }}>
                    {t.isOverdue
                      ? `Late · ${parseLocalDate(t.dateKey).toLocaleDateString(undefined, { weekday: 'short' })}`
                      : t.startMinutes != null ? formatMinutes(t.startMinutes)
                        : t.estimatedMinutes ? `${t.estimatedMinutes}m` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              {also.length > MAX_ALSO_TODAY && (
                <Text style={{ color: Colors.subtext, fontSize: 11, paddingVertical: 8 }}>
                  +{also.length - MAX_ALSO_TODAY} more today
                </Text>
              )}
            </Card>
          </>
        )}

        <WeekRowsSection
          key={weekKey}
          rows={rows}
          title={position === 'current' ? 'REST OF THE WEEK' : 'THIS WEEK'}
          highlight={highlight}
          onItemPress={onItemPress}
          onToggleNote={onToggleNote}
          onOpenDay={onOpenDay}
        />

        {unscheduled.length > 0 && (
          <>
            <SectionHeader
              label="UNSCHEDULED"
              count={unscheduled.length}
              trailing={(() => {
                const est = unscheduled.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
                return est > 0 ? hoursLabel(est) : undefined;
              })()}
            />
            <Card Colors={Colors}>
              {unscheduled.map((task) => {
                // D12: the button shows only when a gap between bookings fits.
                const slot = position === 'past'
                  ? null
                  : findSlot(dayKeys, itemsByDate, task.estimatedMinutes, todayKey, nowMinutes);
                const estimate = task.estimatedMinutes ? `${task.estimatedMinutes}m` : null;
                const due = getDueChip(task, Colors, now);
                return (
                  <View key={task.id} style={[styles.itemRow, { minHeight: 44 }]}>
                    <TouchableOpacity
                      onPress={() => onOpenTask(task)}
                      accessibilityRole="button"
                      accessibilityLabel={`Unscheduled task: ${task.title}${due ? `, ${due.a11yLabel}` : ''}${estimate ? `, ${estimate} estimated` : ''}`}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}
                    >
                      <Stripe color={Colors.primarySoft} />
                      <Text style={{ flex: 1, color: Colors.text, fontSize: 13 }} numberOfLines={1}>{task.title}</Text>
                      {due ? (
                        <View style={{ backgroundColor: due.bg, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: due.fg, fontSize: 10.5, fontWeight: '600' }}>{due.label}</Text>
                        </View>
                      ) : (
                        <Text style={{ color: Colors.subtext, fontSize: 11 }}>{estimate ?? '—'}</Text>
                      )}
                    </TouchableOpacity>
                    {slot && (
                      <TouchableOpacity
                        onPress={() => onFindSlot(task, slot)}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Find a slot for ${task.title}${estimate ? `, ${estimate}` : ''}`}
                        style={styles.addChip}
                      >
                        <Text style={styles.addChipText}>Find a slot</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </Card>
          </>
        )}
      </View>
    </View>
  );
}
