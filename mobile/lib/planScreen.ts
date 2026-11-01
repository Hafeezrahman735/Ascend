import type { CalendarItem, Task } from '../types';
import { bookedMinutes, calendarItemKey, countsTowardLoad, itemIsDone, itemTimeRange, type TimeRange } from './calendarItems';
import type { WeekTask } from './planningTasks';

/**
 * What the Calendar tab's Plan screen shows, as pure functions over the week's
 * calendar items. React-native-free so vitest can reach it; PlanningView only
 * renders what these return.
 *
 * "Booked" means every item with a time, events included, exactly as
 * `bookedMinutes` counts it, so the header band and the day bars can never
 * disagree. The screen shows booked hours only: there is no work-day length
 * setting, so it never claims hours are "free".
 */

// ── Week summary (header band) ───────────────────────────────

export interface WeekBreakdown {
  total: number;
  tasks: number;
  recurring: number;
  /** Local, Google and Apple events together. */
  events: number;
}

/** Booked minutes for the week, split by kind. The parts always sum to `total`. */
export function weekBreakdown(items: CalendarItem[]): WeekBreakdown {
  const out: WeekBreakdown = { total: 0, tasks: 0, recurring: 0, events: 0 };
  for (const item of items) {
    const range = itemTimeRange(item);
    if (!range) continue;
    const minutes = range.end - range.start;
    out.total += minutes;
    if (item.type === 'task') out.tasks += minutes;
    else if (item.type === 'habit_instance') out.recurring += minutes;
    else out.events += minutes;
  }
  return out;
}

// ── Today card ───────────────────────────────────────────────

function isTaskItem(item: CalendarItem): boolean {
  return item.type === 'task' || item.type === 'habit_instance';
}

/** Open timed task or recurring-day items on one day, ordered by start. */
function openTimedWork(dayItems: CalendarItem[]): { item: CalendarItem; range: TimeRange }[] {
  const out: { item: CalendarItem; range: TimeRange }[] = [];
  for (const item of dayItems) {
    if (!isTaskItem(item) || itemIsDone(item)) continue;
    const range = itemTimeRange(item);
    if (range) out.push({ item, range });
  }
  return out.sort((a, b) => a.range.start - b.range.start);
}

export type NextUp =
  | { kind: 'timed'; item: CalendarItem; range: TimeRange; title: string; taskId: string }
  | { kind: 'fallback'; task: Task }
  | null;

/**
 * The task the Today card offers to start.
 *
 * Clock first: today's first open timed task or recurring day that has not
 * ended yet. With nothing timed left, the same task Today's Focus button picks
 * (`fallback`, the first of `topTasks`), so the two tabs agree whenever the
 * clock has nothing to say. Null when there is nothing open at all.
 */
export function nextUp(todayItems: CalendarItem[], nowMinutes: number, fallback: Task | null): NextUp {
  const timed = openTimedWork(todayItems).find(({ range }) => range.end > nowMinutes);
  if (timed) {
    const task = timed.item.data as Task;
    return { kind: 'timed', item: timed.item, range: timed.range, title: task.title, taskId: task.id };
  }
  return fallback ? { kind: 'fallback', task: fallback } : null;
}

/**
 * The "Also today" list: this week's late one-off tasks first, then today's
 * other open tasks in the order weekTasksToWorkOn gives them (timed by start,
 * then untimed). Never repeats the Next up task.
 */
export function alsoToday(weekTasks: WeekTask[], next: NextUp): WeekTask[] {
  const skipKey = next?.kind === 'timed' ? calendarItemKey(next.item) : null;
  const skipId = next?.kind === 'fallback' ? next.task.id : null;
  const keep = (t: WeekTask) => t.key !== skipKey && t.task.id !== skipId;
  const late = weekTasks.filter((t) => t.isOverdue && keep(t));
  const today = weekTasks.filter((t) => t.isToday && keep(t));
  return [...late, ...today];
}

// ── Week rows ────────────────────────────────────────────────

export interface WeekRow {
  key: string;
  booked: number;
  /** Items that count toward a day's load (everything but notes). */
  loadCount: number;
  /** Every item on the day, notes included; a row with none cannot expand. */
  items: CalendarItem[];
  /** 0-1, scaled to the busiest row shown, so the bars compare days. */
  barFraction: number;
}

/** Where the anchored week sits relative to today. */
export function weekPosition(dayKeys: string[], todayKey: string): 'past' | 'current' | 'future' {
  if (dayKeys.length === 0) return 'current';
  if (dayKeys[dayKeys.length - 1] < todayKey) return 'past';
  if (dayKeys[0] > todayKey) return 'future';
  return 'current';
}

/**
 * The day rows under the Today card. On this week, the days after today (the
 * Today card covers today); on any other week, all seven.
 */
export function weekRows(
  dayKeys: string[],
  itemsByDate: Map<string, CalendarItem[]>,
  todayKey: string,
): WeekRow[] {
  const isCurrent = weekPosition(dayKeys, todayKey) === 'current';
  const keys = isCurrent ? dayKeys.filter((k) => k > todayKey) : dayKeys;
  const rows = keys.map((key) => {
    const items = itemsByDate.get(key) ?? [];
    return {
      key,
      booked: bookedMinutes(items),
      loadCount: items.filter(countsTowardLoad).length,
      items,
      barFraction: 0,
    };
  });
  const busiest = Math.max(0, ...rows.map((r) => r.booked));
  for (const row of rows) row.barFraction = busiest > 0 ? row.booked / busiest : 0;
  return rows;
}

// ── Find a slot ──────────────────────────────────────────────

/** An unscheduled task with no estimate is placed as if it took this long. */
export const DEFAULT_SLOT_MINUTES = 30;
/** Today's suggestions start at the next quarter hour, never in the past. */
const SLOT_STEP_MINUTES = 15;

export interface Slot {
  date: string;
  startMinutes: number;
  endMinutes: number;
}

/** A day's timed bookings with overlaps folded together, in order. */
function mergedBookings(items: CalendarItem[]): TimeRange[] {
  const ranges = items
    .map(itemTimeRange)
    .filter((r): r is TimeRange => r !== null)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * The first gap long enough for a task, searching only BETWEEN a day's
 * bookings (founder decision D4): before the first and after the last are never
 * offered, so a day with fewer than two bookings has no slot. Searches from
 * today (gaps after now, rounded up to the quarter hour) to the end of the
 * given days. Null when nothing fits; the screen then hides the button.
 */
export function findSlot(
  dayKeys: string[],
  itemsByDate: Map<string, CalendarItem[]>,
  estimateMinutes: number | null | undefined,
  todayKey: string,
  nowMinutes: number,
): Slot | null {
  const length = estimateMinutes && estimateMinutes > 0 ? estimateMinutes : DEFAULT_SLOT_MINUTES;
  const earliestToday = Math.ceil(nowMinutes / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;

  for (const date of dayKeys) {
    if (date < todayKey) continue;
    const blocks = mergedBookings(itemsByDate.get(date) ?? []);
    for (let i = 0; i + 1 < blocks.length; i++) {
      const gapEnd = blocks[i + 1].start;
      const gapStart = date === todayKey ? Math.max(blocks[i].end, earliestToday) : blocks[i].end;
      if (gapEnd - gapStart >= length) {
        return { date, startMinutes: gapStart, endMinutes: gapStart + length };
      }
    }
  }
  return null;
}
