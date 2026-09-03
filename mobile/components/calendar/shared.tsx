import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../hooks/useTheme';
import type { CalendarItem, CalendarItemType } from '../../types';

/**
 * Presentation shared by every calendar view.
 *
 * Item-type styling lives here rather than in each view so a task looks the same
 * in Month, Week and Day without three definitions drifting apart.
 *
 * The item taxonomy and time maths moved to lib/calendarItems.ts so they can be
 * unit-tested under plain Node; they are re-exported below so existing call
 * sites keep importing from one place.
 */

export {
  TYPE_META,
  DAY_GROUP_ORDER,
  calendarTaxonomyIsComplete,
  calendarItemKey,
  countsTowardLoad,
  isNote,
  itemTitle,
  itemIsDone,
  itemTimeRange,
  isPastEvent,
  bookedMinutes,
  formatMinutes,
  formatTimeRange,
  formatSeconds,
  groupItemsByDate,
  MINUTES_IN_DAY,
} from '../../lib/calendarItems';
export type { TimeRange } from '../../lib/calendarItems';

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

export function typeColor(type: CalendarItemType, Colors: ThemeColors): string {
  switch (type) {
    case 'habit_instance': return Colors.trace;
    case 'task':           return Colors.primary;
    case 'goal_deadline':  return Colors.ROSE;
    // Google, Apple and events authored here share a colour on purpose — a
    // dentist appointment is the same category of thing wherever it is stored,
    // and which system holds it is a detail, not a category.
    case 'event':
    case 'external_google':
    case 'external_apple': return Colors.AMBER;
    case 'note':           return Colors.subtext;
    default:               return Colors.subtext;
  }
}

/**
 * How an item's block is drawn on the timeline.
 *
 * Hue alone is not enough to separate a task from an event: in the light theme
 * `primary` (#E05A3A) and `AMBER` (#D4820A) are both warm orange, about 23°
 * apart, and both would render as a 3px rail. So they differ in FORM instead —
 * a task is an outlined container with a coloured rail, an event is a solid
 * painted band. That reads at 26px, in greyscale, and in both palettes.
 */
export function blockStyle(type: CalendarItemType, Colors: ThemeColors) {
  if (type === 'event' || type === 'external_google' || type === 'external_apple') {
    return {
      backgroundColor: Colors.AMBER_DIM,
      borderWidth: 1,
      borderColor: Colors.AMBER + '55',
      borderLeftWidth: 1,
      borderLeftColor: Colors.AMBER + '55',
    };
  }
  return {
    backgroundColor: Colors.surface,
    borderWidth: 0,
    borderColor: 'transparent',
    borderLeftWidth: 3,
    borderLeftColor: typeColor(type, Colors),
  };
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
    /** Section label used by Planning: UNSCHEDULED, EVENTS, THIS WEEK. */
    sectionLabel: {
      color: Colors.subtext, fontSize: 10, fontWeight: '700',
      letterSpacing: 1.2, marginBottom: 10,
    },
    /** The '+ Add' chip beside a section label. */
    addChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
      backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.border,
    },
    addChipText: { color: Colors.primarySoft, fontSize: 11, fontWeight: '700' },
  });
}
