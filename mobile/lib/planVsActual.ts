import type { CalendarItem, Task, TimelineSession } from '../types';
import type { SessionCompletion } from '../services/sessionOutbox';
import { itemTimeRange } from './calendarItems';
import { formatDuration } from './taskMetrics';

/**
 * Plan against actual for one day: which planned blocks got focus, and which
 * focus went to something that was not planned.
 *
 * Pure, so the calendar and Today share one definition. Each screen adapts its
 * own plan into PlannedBlocks (the calendar from GET /calendar items, Today
 * from the task store) and its own sessions into TimelineSessions, then calls
 * planVsActual. See docs/designs/plan-vs-actual-calendar.md.
 *
 * "Planned" means a one-off task's work block (timed or "any time") or a
 * recurring task's day with a time range, never an event: a meeting is not
 * planned work, so it is neither a block here nor counted in the planned total
 * (unlike `countsTowardLoad`, which counts it). An any-time block claims that
 * day's sessions on its task, so they are not "unplanned", but adds no
 * planned minutes (docs/designs/task-due-and-work-blocks.md, D12).
 */

export interface PlannedBlock {
  taskId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  title: string;
  /** Both null for an any-time work block: planned for the day, no clock. */
  startMinutes: number | null;
  endMinutes: number | null;
  kind: 'task' | 'habit';
}

export interface BlockFill {
  block: PlannedBlock;
  focusedSeconds: number;
  sessions: TimelineSession[];
  /** 0-1: focused time over the block's length, capped at 1. */
  share: number;
  /** Focus beyond the block's length; shown as "+15m". */
  overSeconds: number;
}

export interface DayPlanVsActual {
  fills: BlockFill[];
  /** Sessions with no planned block that day, each drawn at its real time. */
  unplanned: TimelineSession[];
  totals: {
    plannedMinutes: number;
    /** Any-time work blocks that day: planned, but with no minutes to count. */
    anyTimeBlocks: number;
    focusedSeconds: number;
    unplannedSeconds: number;
  };
}

const SECONDS_PER_MINUTE = 60;

/** A block's planned minutes, or null for an any-time block (no clock). */
export function plannedBlockMinutes(block: PlannedBlock): number | null {
  if (block.startMinutes == null || block.endMinutes == null) return null;
  return Math.max(0, block.endMinutes - block.startMinutes);
}

function blockMinutes(block: PlannedBlock): number {
  return plannedBlockMinutes(block) ?? 0;
}

/** Timed blocks by start, then any-time ones: the order a task's fill is chosen in. */
function compareBlocks(a: PlannedBlock, b: PlannedBlock): number {
  return (a.startMinutes ?? Number.MAX_SAFE_INTEGER) - (b.startMinutes ?? Number.MAX_SAFE_INTEGER);
}

/** The calendar's plan: work blocks and timed recurring days from GET /calendar. */
export function plannedBlocksFromCalendar(items: CalendarItem[]): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  for (const item of items) {
    if (item.type !== 'work_block' && item.type !== 'habit_instance') continue;
    const range = itemTimeRange(item);
    // A habit day counts only with a time (unchanged); a work block always does.
    if (!range && item.type === 'habit_instance') continue;
    const task = item.data as Pick<Task, 'id' | 'title'>;
    blocks.push({
      taskId: task.id,
      date: item.date,
      title: task.title,
      startMinutes: range?.start ?? null,
      endMinutes: range?.end ?? null,
      kind: item.type === 'habit_instance' ? 'habit' : 'task',
    });
  }
  return blocks;
}

/**
 * Today's plan from the task store: a one-off task's work blocks on `date`,
 * and a recurring task's time slot. A recurring task is taken as on `date`, so
 * the caller passes only the recurring tasks that are on today. A one-off
 * task's own times are ignored: an older build's cache may still carry them.
 */
export function plannedBlocksFromTasks(
  tasks: Pick<Task, 'id' | 'title' | 'startMinutes' | 'endMinutes' | 'isRecurring' | 'blocks'>[],
  date: string,
): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  for (const task of tasks) {
    if (task.isRecurring) {
      if (task.startMinutes == null || task.endMinutes == null) continue;
      blocks.push({
        taskId: task.id, date, title: task.title,
        startMinutes: task.startMinutes, endMinutes: task.endMinutes, kind: 'habit',
      });
      continue;
    }
    for (const block of task.blocks ?? []) {
      if (block.date !== date) continue;
      blocks.push({
        taskId: task.id, date, title: task.title,
        startMinutes: block.startMinutes, endMinutes: block.endMinutes, kind: 'task',
      });
    }
  }
  return blocks;
}

/** Minutes after local midnight on this phone. */
function deviceLocalMinutes(epochMs: number): number {
  const d = new Date(epochMs);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The server's sessions plus the ones still waiting in the outbox, so a session
 * finished offline shows at once. A queued session the server already has
 * (same clientSessionId) is dropped, so nothing is counted twice.
 *
 * Queued sessions are placed with the phone's clock, which is the zone they
 * were recorded in; the server re-places them once delivered.
 */
export function mergeQueuedSessions(
  server: TimelineSession[],
  queued: SessionCompletion[],
  toLocalMinutes: (epochMs: number) => number = deviceLocalMinutes,
): TimelineSession[] {
  const delivered = new Set(server.map((s) => s.clientSessionId).filter((id): id is string => !!id));
  const pending = queued
    .filter((q) => !delivered.has(q.clientSessionId))
    .map((q): TimelineSession => {
      const endLocalMinutes = toLocalMinutes(q.completedAt);
      return {
        id: `queued:${q.clientSessionId}`,
        clientSessionId: q.clientSessionId,
        durationSeconds: q.actualElapsedSeconds,
        localDate: q.localDate,
        taskId: q.taskId,
        taskTitle: q.taskLabel,
        goalId: null,
        startLocalMinutes: Math.max(0, endLocalMinutes - Math.round(q.actualElapsedSeconds / SECONDS_PER_MINUTE)),
        endLocalMinutes,
        queued: true,
      };
    });
  return [...server, ...pending].sort(
    (a, b) => a.localDate.localeCompare(b.localDate) || a.endLocalMinutes - b.endLocalMinutes,
  );
}

/**
 * Today's sessions from the phone's own session history (the source of Today's
 * Focus today stat), as timeline sessions on `date`. The caller passes only
 * that day's focus records.
 */
export function timelineFromHistory(
  records: { sessionId?: string; completedAt: number; durationSeconds: number; taskId: string | null; taskLabel: string | null }[],
  date: string,
  toLocalMinutes: (epochMs: number) => number = deviceLocalMinutes,
): TimelineSession[] {
  return records.map((r, i) => {
    const endLocalMinutes = toLocalMinutes(r.completedAt);
    return {
      id: r.sessionId ?? `local:${r.completedAt}:${i}`,
      clientSessionId: null,
      durationSeconds: r.durationSeconds,
      localDate: date,
      taskId: r.taskId,
      taskTitle: r.taskLabel,
      goalId: null,
      startLocalMinutes: Math.max(0, endLocalMinutes - Math.round(r.durationSeconds / SECONDS_PER_MINUTE)),
      endLocalMinutes,
    };
  });
}

/**
 * "1h 30m of 3h planned · 38m unplanned", the one-line summary on Today and
 * the Day view. Null when there is neither a plan nor any focus that day.
 */
export function summaryLine(totals: DayPlanVsActual['totals']): string | null {
  const { plannedMinutes, anyTimeBlocks, focusedSeconds, unplannedSeconds } = totals;
  const planned = plannedMinutes > 0 || anyTimeBlocks > 0;
  if (!planned && focusedSeconds === 0) return null;
  const focused = formatDuration(focusedSeconds);
  if (!planned) return `${focused} focused, nothing planned`;
  const parts = [
    plannedMinutes > 0
      ? `${focused} of ${formatDuration(plannedMinutes * SECONDS_PER_MINUTE)} planned`
      : `${focused} focused`,
  ];
  if (anyTimeBlocks > 0) parts.push(`${anyTimeBlocks} planned any time`);
  if (unplannedSeconds > 0) parts.push(`${formatDuration(unplannedSeconds)} unplanned`);
  return parts.join(' · ');
}

/**
 * One day's comparison. A session fills the planned block of the same task on
 * the same day, whatever time it ran; a task with two blocks that day fills the
 * first timed one, else its any-time block. Everything else that day is unplanned.
 */
export function planVsActual(date: string, blocks: PlannedBlock[], sessions: TimelineSession[]): DayPlanVsActual {
  const dayBlocks = blocks
    .filter((b) => b.date === date)
    .sort(compareBlocks);
  const fillByTask = new Map<string, BlockFill>();
  const fills = dayBlocks.map((block) => {
    const fill: BlockFill = { block, focusedSeconds: 0, sessions: [], share: 0, overSeconds: 0 };
    if (!fillByTask.has(block.taskId)) fillByTask.set(block.taskId, fill);
    return fill;
  });

  const unplanned: TimelineSession[] = [];
  let focusedSeconds = 0;
  for (const session of sessions) {
    if (session.localDate !== date) continue;
    focusedSeconds += session.durationSeconds;
    const fill = session.taskId ? fillByTask.get(session.taskId) : undefined;
    if (fill) {
      fill.focusedSeconds += session.durationSeconds;
      fill.sessions.push(session);
    } else {
      unplanned.push(session);
    }
  }

  for (const fill of fills) {
    const plannedSeconds = blockMinutes(fill.block) * SECONDS_PER_MINUTE;
    fill.share = plannedSeconds > 0 ? Math.min(1, fill.focusedSeconds / plannedSeconds) : 0;
    fill.overSeconds = Math.max(0, fill.focusedSeconds - plannedSeconds);
  }

  return {
    fills,
    unplanned,
    totals: {
      plannedMinutes: dayBlocks.reduce((sum, b) => sum + blockMinutes(b), 0),
      anyTimeBlocks: dayBlocks.filter((b) => plannedBlockMinutes(b) === null).length,
      focusedSeconds,
      unplannedSeconds: unplanned.reduce((sum, s) => sum + s.durationSeconds, 0),
    },
  };
}
