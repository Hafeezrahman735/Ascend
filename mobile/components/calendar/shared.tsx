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

export type CalendarViewMode = 'day' | 'week' | 'month' | 'stats';

export const VIEW_MODES: { key: CalendarViewMode; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'stats', label: 'Stats' },
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
