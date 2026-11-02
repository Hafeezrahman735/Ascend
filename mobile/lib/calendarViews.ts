import type { CalendarItem, Task, TaskGoal } from '../types';
import {
  bookedMinutes, calendarItemKey, countsTowardLoad, isNote, itemIsDone, itemTimeRange,
  itemTitle, type TimeRange,
} from './calendarItems';
import { PRIORITY_RANK } from './planningTasks';
import type { DayPlanVsActual } from './planVsActual';

/**
 * Pure logic behind the calendar's Week lanes and Month deadlines.
 *
 * Week lanes: every day is one horizontal track, and all seven share ONE time
 * axis (eng review D2). Times only compare across days if 9am sits at the same
 * spot on every lane, so the axis is 8:00-22:00 widened to the week's earliest
 * timed start and latest timed end, rounded out to whole hours. An external
 * event running past midnight is already clamped to 24:00 by itemTimeRange, so
 * the axis never runs past the end of the day.
 *
 *   axis   8a ─────────── 12p ─────────── 4p ─────────── 8p ──── 10p
 *   lane   ▓▓   ▓▓▓▓░▓▓        ▓▓      ▓▓▓
 *          left = (start - axis.start) / span, width = length / span
 *
 * Blocks overlap freely in a lane and are drawn see-through (D11), so a clash
 * reads as a darker patch; the expanded lane still lists every item.
 */

export const LANE_DEFAULT_START = 8 * 60;
export const LANE_DEFAULT_END = 22 * 60;
const HOUR = 60;
/** Axis labels every four hours: four labels across a default day. */
const TICK_EVERY = 4 * HOUR;

export type LaneAxis = TimeRange;

/** The shared axis for a set of days: the default span, widened to fit every timed item. */
export function weekAxis(dayKeys: string[], itemsByDate: Map<string, CalendarItem[]>): LaneAxis {
  let start = LANE_DEFAULT_START;
  let end = LANE_DEFAULT_END;
  for (const key of dayKeys) {
    for (const item of itemsByDate.get(key) ?? []) {
      const range = itemTimeRange(item);
      if (!range) continue;
      start = Math.min(start, Math.floor(range.start / HOUR) * HOUR);
      end = Math.max(end, Math.ceil(range.end / HOUR) * HOUR);
    }
  }
  return { start, end };
}

/** Where to print an hour label, as a 0-1 fraction of the axis. */
export interface AxisTick { minutes: number; at: number }

export function axisTicks(axis: LaneAxis): AxisTick[] {
  const span = axis.end - axis.start;
  if (span <= 0) return [];
  const ticks: AxisTick[] = [];
  // Strictly inside the right edge: a label there would run off the track.
  for (let m = Math.ceil(axis.start / TICK_EVERY) * TICK_EVERY; m < axis.end; m += TICK_EVERY) {
    ticks.push({ minutes: m, at: (m - axis.start) / span });
  }
  return ticks;
}

export interface LaneSegment {
  key: string;
  type: CalendarItem['type'];
  /** 0-1 from the axis start. */
  left: number;
  /** 0-1 of the axis span. */
  width: number;
}

export interface LaneSummary {
  segments: LaneSegment[];
  bookedMinutes: number;
  /** Commitments with no time on them: drawn nowhere on the track. */
  anytimeCount: number;
  noteCount: number;
}

/** One day's lane: its blocks on the axis, plus what the track cannot show. */
export function laneSummary(items: CalendarItem[], axis: LaneAxis): LaneSummary {
  const span = axis.end - axis.start;
  const segments: LaneSegment[] = [];
  let anytimeCount = 0;
  let noteCount = 0;
  for (const item of items) {
    if (isNote(item)) { noteCount += 1; continue; }
    const range = itemTimeRange(item);
    if (!range) {
      if (countsTowardLoad(item)) anytimeCount += 1;
      continue;
    }
    if (span <= 0) continue;
    const start = Math.max(range.start, axis.start);
    const end = Math.min(range.end, axis.end);
    if (end <= start) continue;
    segments.push({
      key: calendarItemKey(item),
      type: item.type,
      left: (start - axis.start) / span,
      width: (end - start) / span,
    });
  }
  return { segments, bookedMinutes: bookedMinutes(items), anytimeCount, noteCount };
}

// ── Focus per task ───────────────────────────────────────────

export interface TaskFocus {
  seconds: number;
  sessions: number;
  /** The planned block's length, or null when the task had no block that day. */
  plannedMinutes: number | null;
}

/**
 * One task's focus on one day, from that day's plan-vs-actual. The single
 * source for the task sheet's "Focused" row and the Week lane's "52m/1h30", so
 * the two can never disagree. A task has at most one planned block a day (one
 * start/end per task, one occurrence per recurring day), and focus on a task
 * with no block is the unplanned sessions for it.
 */
export function taskFocusOnDay(plan: DayPlanVsActual, taskId: string): TaskFocus | null {
  const fill = plan.fills.find((f) => f.block.taskId === taskId);
  if (fill) {
    return {
      seconds: fill.focusedSeconds,
      sessions: fill.sessions.length,
      plannedMinutes: fill.block.endMinutes - fill.block.startMinutes,
    };
  }
  const sessions = plan.unplanned.filter((s) => s.taskId === taskId);
  if (sessions.length === 0) return null;
  return {
    seconds: sessions.reduce((sum, s) => sum + s.durationSeconds, 0),
    sessions: sessions.length,
    plannedMinutes: null,
  };
}

// ── Important deadlines (Month) ──────────────────────────────

const IMPORTANT_PRIORITIES: ReadonlySet<Task['priority']> = new Set(['high', 'urgent']);

/**
 * Worth a line under the month: a goal deadline, or a one-off task marked high
 * or urgent. Recurring tasks reach the calendar as habit_instance and are left
 * out — a weekly high-priority habit would fill the list with the same title.
 */
export function isImportantDeadline(item: CalendarItem): boolean {
  if (itemIsDone(item)) return false;
  if (item.type === 'goal_deadline') return true;
  if (item.type !== 'task') return false;
  const task = item.data as Task;
  return !task.isRecurring && !task.isOccurrence && IMPORTANT_PRIORITIES.has(task.priority);
}

export interface Deadline {
  item: CalendarItem;
  /** Due before today and still open. */
  isLate: boolean;
}

function priorityRank(item: CalendarItem): number {
  // Goals rank with urgent work: a goal deadline is the commitment the tasks serve.
  if (item.type !== 'task') return PRIORITY_RANK.urgent;
  return PRIORITY_RANK[(item.data as Task).priority];
}

function compareDeadlines(a: CalendarItem, b: CalendarItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const byPriority = priorityRank(a) - priorityRank(b);
  if (byPriority !== 0) return byPriority;
  const byTitle = itemTitle(a).localeCompare(itemTitle(b));
  if (byTitle !== 0) return byTitle;
  return calendarItemKey(a) < calendarItemKey(b) ? -1 : 1;
}

/**
 * The month's Important deadlines, oldest first. `overdue` carries open items
 * due before the loaded range (Month fetches one month only, so those are not
 * in `monthItems`); an item present in both is listed once.
 */
export function importantDeadlines(
  monthItems: CalendarItem[],
  todayKey: string,
  overdue: CalendarItem[] = [],
): Deadline[] {
  const seen = new Set<string>();
  const picked: CalendarItem[] = [];
  for (const item of [...overdue, ...monthItems]) {
    if (!isImportantDeadline(item)) continue;
    const key = calendarItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }
  return picked.sort(compareDeadlines).map((item) => ({ item, isLate: item.date < todayKey }));
}

/**
 * 'YYYY-MM-DD' from either a task's dueDate (a Prisma DateTime, arriving as a
 * full ISO string at UTC midnight — the server keys it with toDateKey's UTC
 * parts) or a goal's deadline (already a bare calendar day).
 */
function dateKeyOf(iso: string): string {
  return iso.substring(0, 10);
}

/**
 * Open important items due before `beforeKey`, built from the task and goal
 * stores (which hold every open item, not just the loaded month), shaped as the
 * calendar items the server would have sent for those days.
 */
export function overdueDeadlineItems(tasks: Task[], goals: TaskGoal[], beforeKey: string): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const task of tasks) {
    if (task.isArchived || !task.dueDate) continue;
    const date = dateKeyOf(task.dueDate);
    if (date >= beforeKey) continue;
    const item: CalendarItem = { type: 'task', date, data: task };
    if (isImportantDeadline(item)) out.push(item);
  }
  for (const goal of goals) {
    if (goal.isArchived || !goal.deadline) continue;
    const date = dateKeyOf(goal.deadline);
    if (date >= beforeKey) continue;
    const item: CalendarItem = { type: 'goal_deadline', date, data: goal };
    if (isImportantDeadline(item)) out.push(item);
  }
  return out;
}
