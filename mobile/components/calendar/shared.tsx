import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../hooks/useTheme';
import type {
  CalendarItem,
  CalendarItemType,
  Note,
  Task,
  TaskGoal,
  GoogleCalendarEvent,
} from '../../types';

/**
 * Presentation shared by every calendar view.
 *
 * Item-type styling lives here rather than in each view so a task looks the same
 * in Month, Week and Day without three definitions drifting apart.
 */

// 'planning' replaced 'stats' as a tab: Stats did not disappear, it became one of
// two modes inside Planning. Planning leads because deciding what to work on
// comes before looking at any particular day.
export type CalendarViewMode = 'planning' | 'day' | 'week' | 'month';

export const VIEW_MODES: { key: CalendarViewMode; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export const TYPE_META: Record<
  CalendarItemType,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  // The wire value stays `habit_instance` (backend contract); only the
  // user-facing label changes. These are recurring tasks, not a separate
  // "habits" feature — nothing in the app creates a "habit".
  habit_instance:  { icon: 'repeat',           label: 'Recurring tasks' },
  task:            { icon: 'checkbox-outline', label: 'Tasks' },
  goal_deadline:   { icon: 'flag',             label: 'Goal deadlines' },
  external_google: { icon: 'logo-google',      label: 'Google Calendar' },
  external_apple:  { icon: 'calendar',         label: 'Device Calendar' },
  note:            { icon: 'document-text',    label: 'Notes & to-dos' },
};

/** Day view group order — what you must do today, before what you noted. */
export const DAY_GROUP_ORDER: CalendarItemType[] = [
  'habit_instance', 'task', 'goal_deadline', 'external_google', 'external_apple', 'note',
];

export function typeColor(type: CalendarItemType, Colors: ThemeColors): string {
  switch (type) {
    case 'habit_instance': return Colors.accent;
    case 'task':           return Colors.primary;
    case 'goal_deadline':  return Colors.ROSE;
    // Google and Apple share a colour on purpose — both read as "from my other
    // calendar", and the source is a detail, not a category.
    case 'external_google':
    case 'external_apple': return Colors.AMBER;
    case 'note':           return Colors.subtext;
    default:               return Colors.subtext;
  }
}

export function itemTitle(item: CalendarItem): string {
  switch (item.type) {
    case 'task':
    case 'habit_instance':
      return (item.data as Task).title;
    case 'goal_deadline':
      return (item.data as TaskGoal).title;
    case 'note':
      return (item.data as Note).content;
    case 'external_google':
    case 'external_apple':
      return (item.data as GoogleCalendarEvent).title;
    default:
      return '';
  }
}

export function itemIsDone(item: CalendarItem): boolean {
  if (item.type === 'task' || item.type === 'habit_instance') return (item.data as Task).isCompleted;
  if (item.type === 'note') return (item.data as Note).isCompleted;
  if (item.type === 'goal_deadline') return (item.data as TaskGoal).isCompleted;
  return false;
}

// ── Time of day ───────────────────────────────────────────────

export const MINUTES_IN_DAY = 1440;

/** A block on the day grid: minutes from local midnight, end exclusive. */
export interface TimeRange { start: number; end: number }

/** Minutes from local midnight for an instant, in the device’s own timezone. */
function localMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * The slot an item occupies on the day grid, or null when it has no time and
 * therefore belongs in the agenda below rather than on the timeline.
 *
 * Two clocks meet here. Tasks carry minutes-from-local-midnight, which are
 * already wall-clock. External calendar events carry real ISO instants, so they
 * are converted through the device’s timezone — which is right for them: a
 * meeting at 14:00 UTC genuinely moves when you fly.
 */
export function itemTimeRange(item: CalendarItem): TimeRange | null {
  if (item.type === 'task' || item.type === 'habit_instance') {
    const task = item.data as Task;
    if (task.startMinutes == null || task.endMinutes == null) return null;
    return { start: task.startMinutes, end: task.endMinutes };
  }

  if (item.type === 'external_google' || item.type === 'external_apple') {
    const event = item.data as GoogleCalendarEvent;
    if (event.isAllDay || !event.startTime) return null;

    const startedAt = new Date(event.startTime);
    const start = localMinutes(startedAt);
    const endedAt = event.endTime ? new Date(event.endTime) : null;

    // An event running past midnight is clamped to the end of this day rather
    // than drawn taller than the grid it sits in.
    let end = endedAt && isSameLocalDay(endedAt, startedAt)
      ? localMinutes(endedAt)
      : MINUTES_IN_DAY;
    // Zero-length and inverted events still need something visible to tap.
    if (end <= start) end = Math.min(start + 30, MINUTES_IN_DAY);
    return { start, end };
  }

  return null;
}

/**
 * '9:00 AM' in the user’s locale. Built on a fixed calendar date so it stays a
 * pure function — formatting must not depend on when it is called.
 */
export function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY - 1, Math.round(minutes)));
  const d = new Date(2000, 0, 1, Math.floor(clamped / 60), clamped % 60);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** '9:00 AM – 10:30 AM', for a row that has room for the whole span. */
export function formatTimeRange(range: TimeRange): string {
  return `${formatMinutes(range.start)} – ${formatMinutes(range.end)}`;
}

export function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Groups items by date once, so no view filters the full list per cell. */
export function groupItemsByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const bucket = map.get(item.date);
    if (bucket) bucket.push(item);
    else map.set(item.date, [item]);
  }
  return map;
}

export const EMPTY_ITEMS: CalendarItem[] = [];

export function getCalendarStyles(Colors: ThemeColors) {
  return StyleSheet.create({
    segment: {
      flexDirection: 'row', margin: 12, padding: 3, borderRadius: 12,
      backgroundColor: Colors.surface, gap: 3,
    },
    segmentItem: { flex: 1, paddingVertical: 7, borderRadius: 9, alignItems: 'center' },
    segmentText: { color: Colors.subtext, fontSize: 13, fontWeight: '600' },
    navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 6, gap: 8 },
    navBtn: { padding: 6, borderRadius: 8, backgroundColor: Colors.surface },
    navLabel: { color: Colors.textBright, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    navToday: { color: Colors.subtext, fontSize: 9, textAlign: 'center' },
    warnBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginHorizontal: 16, marginBottom: 6, padding: 8, borderRadius: 8,
      backgroundColor: Colors.ROSE_DIM,
    },
    warnText: { color: Colors.ROSE, fontSize: 11, flex: 1 },
    monthCell: { height: 62, alignItems: 'center', paddingTop: 6 },
    weekRow: {
      backgroundColor: Colors.surface, borderRadius: 12, padding: 10, marginBottom: 8,
      borderWidth: 1, borderColor: Colors.border,
    },
    weekRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
    todoRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    groupTitle: { color: Colors.textBright, fontSize: 13, fontWeight: '700', flex: 1 },
    noteRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border,
    },
    addRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
    addInput: {
      flex: 1, backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 12,
      paddingVertical: 9, color: Colors.text, fontSize: 13,
      borderWidth: 1, borderColor: Colors.border,
    },
    addBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
    emptyBox: { alignItems: 'center', paddingVertical: 34, backgroundColor: Colors.surface, borderRadius: 12 },
    statCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 12 },
    statHeading: { color: Colors.textBright, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  });
}
