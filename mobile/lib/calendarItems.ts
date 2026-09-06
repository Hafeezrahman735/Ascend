import type { Ionicons } from '@expo/vector-icons';
import type {
  CalendarEvent,
  CalendarItem,
  CalendarItemType,
  GoogleCalendarEvent,
  Note,
  Task,
  TaskGoal,
} from '../types';

/**
 * The calendar item taxonomy, and the time maths that goes with it.
 *
 * Split out of components/calendar/shared.tsx so it can be unit-tested: that
 * file pulls in react-native and @expo/vector-icons, which the Node test runner
 * cannot load. Nothing here imports a value from either — the Ionicons import is
 * type-only and erases at build time.
 *
 * shared.tsx re-exports everything below, so call sites import from whichever is
 * closer to hand.
 */

export const TYPE_META: Record<
  CalendarItemType,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  event:           { icon: 'calendar-number-outline', label: 'Events' },
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

/**
 * Day view group order — what frames the day, then what you must do in it, then
 * what you noted about it.
 *
 * Events lead because an all-day event ("Public holiday", "On leave") is the
 * context everything else sits inside, not another line item competing with it.
 *
 * This array is load-bearing in a way that is easy to miss: DayView iterates it
 * and looks each type up, so a CalendarItemType absent from it renders NOWHERE —
 * fetched, stored, counted, and invisible. calendarTaxonomyIsComplete() below
 * exists to make that failure loud instead of silent.
 */
export const DAY_GROUP_ORDER: CalendarItemType[] = [
  'event', 'habit_instance', 'task', 'goal_deadline',
  'external_google', 'external_apple', 'note',
];

/**
 * True when every declared item type has both a meta entry and a place in the
 * day order. Asserted by the unit test; a new type that forgets either one is a
 * silently invisible item at best and a TYPE_META[type].icon crash at worst.
 */
export function calendarTaxonomyIsComplete(): boolean {
  const metaKeys = Object.keys(TYPE_META) as CalendarItemType[];
  return metaKeys.length === DAY_GROUP_ORDER.length
    && metaKeys.every((key) => DAY_GROUP_ORDER.includes(key));
}

/** The date form every calendar item is keyed and bucketed by. */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(DAY_GROUP_ORDER);

/**
 * Whether a value from outside the app can safely be rendered as a calendar item.
 *
 * Two sources reach the views without ever having been checked: the persisted
 * range cache, which is `JSON.parse` of whatever an older build wrote to disk,
 * and the device calendar bridge. Every view then reads through `item.data` with
 * an unchecked cast — `(item.data as Task).title` — and indexes `TYPE_META` by
 * `item.type`. So a truncated cache entry, or an item type this build does not
 * know, is not a missing row: it is a red screen on the Calendar tab, and one
 * that survives a restart because the bad value is on disk.
 *
 * Dropping the item is the right failure. The next fetch replaces it, and a
 * calendar missing one row still works; a calendar that throws does not.
 */
export function isRenderableCalendarItem(value: unknown): value is CalendarItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { type?: unknown; date?: unknown; data?: unknown };
  return (
    typeof item.type === 'string'
    && KNOWN_TYPES.has(item.type)
    && typeof item.date === 'string'
    && DATE_KEY_PATTERN.test(item.date)
    && typeof item.data === 'object'
    && item.data !== null
  );
}

/**
 * A stable identity for an item, for React keys and for equality checks.
 *
 * CalendarItem carries no id of its own — the id lives inside `data`, shaped
 * differently per type. Index keys were harmless while the calendar was
 * read-only; the moment a row can be deleted mid-list, React reuses component
 * state across the shift and the wrong row shows the wrong content.
 */
export function calendarItemKey(item: CalendarItem): string {
  const id = (item.data as { id?: string } | null)?.id;
  return `${item.type}:${item.date}:${id ?? 'anon'}`;
}

/**
 * Whether an item is a claim on the day, as opposed to something jotted about
 * it — the question the heat map and the "hours booked" figures ask.
 *
 * NOT a visibility test, and the old name (`isScheduledItem`) invited exactly
 * that misreading. Week and Month both filtered their DISPLAY lists through it,
 * so notes silently vanished from two of the three views: a plain note was
 * unreachable anywhere outside Day view, and a day holding nothing but notes
 * rendered as an empty column and an unshaded cell. Deciding what to show is
 * `items.length`; this decides what to COUNT.
 */
export function countsTowardLoad(item: CalendarItem): boolean {
  return item.type !== 'note';
}

/** A note or to-do — the inverse of the above, for views that group them out. */
export function isNote(item: CalendarItem): boolean {
  return item.type === 'note';
}

export function itemTitle(item: CalendarItem): string {
  switch (item.type) {
    case 'task':
    case 'habit_instance':
      return (item.data as Task).title;
    case 'goal_deadline':
      return (item.data as TaskGoal).title;
    case 'event':
      return (item.data as CalendarEvent).title;
    case 'note':
      return (item.data as Note).content;
    case 'external_google':
    case 'external_apple':
      return (item.data as GoogleCalendarEvent).title;
    default:
      return '';
  }
}

/**
 * Whether the item is finished.
 *
 * Events are never "done" — you do not complete a dentist appointment, it just
 * happens. Returning false here is the reason they never strike through, and it
 * is deliberate rather than an oversight. Past events are dimmed instead, by
 * isPastEvent below.
 */
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

/** Minutes from local midnight for an instant, in the device's own timezone. */
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
 * Two clocks meet here. Tasks and events carry minutes-from-local-midnight,
 * which are already wall-clock. External calendar events carry real ISO
 * instants, so they are converted through the device's timezone — which is
 * right for them: a meeting at 14:00 UTC genuinely moves when you fly.
 */
export function itemTimeRange(item: CalendarItem): TimeRange | null {
  if (item.type === 'task' || item.type === 'habit_instance') {
    const task = item.data as Task;
    if (task.startMinutes == null || task.endMinutes == null) return null;
    return { start: task.startMinutes, end: task.endMinutes };
  }

  if (item.type === 'event') {
    const event = item.data as CalendarEvent;
    // Both null is the all-day case. The server refuses to store one without the
    // other, so a half-set pair means bad data — treat it as all-day rather than
    // drawing a block with an invented end.
    if (event.startMinutes == null || event.endMinutes == null) return null;
    return { start: event.startMinutes, end: event.endMinutes };
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
 * Whether an event has already happened, given the current day and time.
 *
 * Only events answer this. Everything else on the calendar has a completion
 * state of its own to dim by; an event has none, so without this it would render
 * at full strength forever and a Tuesday two weeks gone would look as live as
 * this afternoon.
 *
 * `now` is passed in rather than read here so the function stays pure.
 */
export function isPastEvent(item: CalendarItem, now: Date): boolean {
  if (item.type !== 'event') return false;
  const event = item.data as CalendarEvent;

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (event.date < todayKey) return true;
  if (event.date > todayKey) return false;

  // Today: an all-day event is never past, and a timed one is past once its end
  // has gone by.
  if (event.endMinutes == null) return false;
  return event.endMinutes <= now.getHours() * 60 + now.getMinutes();
}

/**
 * '9:00 AM' in the user's locale. Built on a fixed calendar date so it stays a
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

/** Minutes of the day already spoken for, from items that carry a time. */
export function bookedMinutes(items: CalendarItem[]): number {
  let total = 0;
  for (const item of items) {
    const range = itemTimeRange(item);
    if (range) total += range.end - range.start;
  }
  return total;
}

/**
 * Weight — how much of a day an item claims, whether or not it carries a clock.
 *
 * This is NOT bookedMinutes and must never be printed as if it were. Booked
 * minutes are measured; weight is a judgement expressed in the same unit so the
 * two can be compared. The month heat map shades by weight and reports booked
 * minutes, and conflating them would put an invented number on screen labelled
 * as a real one.
 *
 * These four constants are the calibration, and they are invented — chosen to
 * make a month of real data use its whole scale, derived from nothing. They are
 * exported so tests name them instead of hardcoding the number, because tuning
 * them is expected. See TODOS.md for the failure to watch for.
 */
export const UNTIMED_TASK_WEIGHT = 30;
export const HABIT_WEIGHT = 30;
export const DEADLINE_WEIGHT = 90;
export const ALL_DAY_EVENT_WEIGHT = 180;

/**
 * INVARIANT: every type except `note` returns a positive number.
 *
 * MonthView deletes its count-based fallback on the strength of this. That
 * fallback existed only because untimed items scored zero; if any non-note type
 * ever weighs nothing again, its day silently renders as free. The unit test
 * pins this for the whole union so a newly added type cannot quietly break it.
 */
export function itemWeight(item: CalendarItem): number {
  if (item.type === 'note') return 0;

  // Recurring tasks are weighted FLAT, ignoring any time they carry. A future
  // occurrence is a projected placeholder with no startMinutes at all (see the
  // calendar route), so weighting by duration would make today's spawned copy
  // heavier than the identical one next Tuesday — and next Tuesday would darken
  // by itself when it spawned. The cost is real and accepted: a two-hour daily
  // habit weighs the same as a five-minute one.
  if (item.type === 'habit_instance') return HABIT_WEIGHT;

  // A deadline never has a time. It is a claim on the day regardless.
  if (item.type === 'goal_deadline') return DEADLINE_WEIGHT;

  const range = itemTimeRange(item);
  const timed = range ? range.end - range.start : 0;
  if (timed > 0) return timed;

  // No usable clock. A zero-length block counts as its untimed self rather than
  // as nothing — that is the invariant above. Anything that is not a task and
  // has no time is an all-day event, which is the largest claim a day can hold.
  return item.type === 'task' ? UNTIMED_TASK_WEIGHT : ALL_DAY_EVENT_WEIGHT;
}
