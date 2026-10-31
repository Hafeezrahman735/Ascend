import type { CalendarItem, Task, TimelineSession } from '../types';
import type { SessionCompletion } from '../services/sessionOutbox';
import { itemTimeRange } from './calendarItems';

/**
 * Plan against actual for one day: which planned blocks got focus, and which
 * focus went to something that was not planned.
 *
 * Pure, so the calendar and Today share one definition. Each screen adapts its
 * own plan into PlannedBlocks (the calendar from GET /calendar items, Today
 * from the task store) and its own sessions into TimelineSessions, then calls
 * planVsActual. See docs/designs/plan-vs-actual-calendar.md.
 *
 * "Planned" means a task or a recurring task's day with a time range, never an
 * event: a meeting is not planned work, so it is neither a block here nor
 * counted in the planned total (unlike `countsTowardLoad`, which counts it).
 */

export interface PlannedBlock {
  taskId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
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
  totals: { plannedMinutes: number; focusedSeconds: number; unplannedSeconds: number };
}

const SECONDS_PER_MINUTE = 60;

function blockMinutes(block: PlannedBlock): number {
  return Math.max(0, block.endMinutes - block.startMinutes);
}

/** The calendar's plan: timed tasks and recurring days from GET /calendar. */
export function plannedBlocksFromCalendar(items: CalendarItem[]): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  for (const item of items) {
    if (item.type !== 'task' && item.type !== 'habit_instance') continue;
    const range = itemTimeRange(item);
    if (!range) continue;
    const task = item.data as Pick<Task, 'id' | 'title'>;
    blocks.push({
      taskId: task.id,
      date: item.date,
      title: task.title,
      startMinutes: range.start,
      endMinutes: range.end,
      kind: item.type === 'habit_instance' ? 'habit' : 'task',
    });
  }
  return blocks;
}

/**
 * Today's plan from the task store. A one-off task counts on its due day, the
 * same rule GET /calendar uses; a recurring task is taken as due on `date`, so
 * the caller passes only the recurring tasks that are on today.
 */
export function plannedBlocksFromTasks(
  tasks: Pick<Task, 'id' | 'title' | 'dueDate' | 'startMinutes' | 'endMinutes' | 'isRecurring'>[],
  date: string,
): PlannedBlock[] {
  const blocks: PlannedBlock[] = [];
  for (const task of tasks) {
    if (task.startMinutes == null || task.endMinutes == null) continue;
    if (!task.isRecurring && task.dueDate?.slice(0, 10) !== date) continue;
    blocks.push({
      taskId: task.id,
      date,
      title: task.title,
      startMinutes: task.startMinutes,
      endMinutes: task.endMinutes,
      kind: task.isRecurring ? 'habit' : 'task',
    });
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
 * One day's comparison. A session fills the planned block of the same task on
 * the same day, whatever time it ran; a task with two blocks that day fills the
 * first. Everything else that day is unplanned.
 */
export function planVsActual(date: string, blocks: PlannedBlock[], sessions: TimelineSession[]): DayPlanVsActual {
  const dayBlocks = blocks
    .filter((b) => b.date === date)
    .sort((a, b) => a.startMinutes - b.startMinutes);
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
      focusedSeconds,
      unplannedSeconds: unplanned.reduce((sum, s) => sum + s.durationSeconds, 0),
    },
  };
}
