import { z } from 'zod';

/**
 * Work blocks: when the user plans to work on a one-off task, separate from
 * its due date (docs/designs/task-due-and-work-blocks.md).
 *
 * A task's blocks are always written as one whole list with the task (POST and
 * PATCH /tasks replace them in a transaction), so these rules check the list,
 * not one block at a time.
 */

/** At most this many blocks per task. Bounds GET /tasks, which returns them all. */
export const MAX_BLOCKS_PER_TASK = 100;

/** Minutes from local midnight. 0 = 00:00, 1439 = 23:59. */
const timeOfDay = z.number().int().min(0).max(1439);

/** True for a 'YYYY-MM-DD' string that names a real calendar day. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const workBlockInput = z.object({
  date: z.string().refine(isCalendarDate, 'A work block needs a real YYYY-MM-DD date'),
  startMinutes: timeOfDay.optional().nullable(),
  endMinutes: timeOfDay.optional().nullable(),
});

export const workBlockList = z.array(workBlockInput);

export type WorkBlockInput = z.infer<typeof workBlockInput>;

export interface NormalizedBlock {
  date: string;
  startMinutes: number | null;
  endMinutes: number | null;
}

/**
 * The time-pair rules shared by a recurring task's own time and every work
 * block: both ends or neither (a timeline block needs a height), and the end
 * after the start. Returns an error message, or null when valid.
 */
export function validateTimePair(
  startMinutes: number | null | undefined,
  endMinutes: number | null | undefined,
): string | null {
  const start = startMinutes ?? null;
  const end = endMinutes ?? null;
  if (start === null && end === null) return null;
  if (start === null || end === null) return 'A scheduled time needs both a start and an end';
  if (end <= start) return 'End time must be after start time';
  return null;
}

/** Earliest first: by day, then start, with the untimed block of a day last. */
export function compareBlocks(a: NormalizedBlock, b: NormalizedBlock): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.startMinutes ?? Number.MAX_SAFE_INTEGER) - (b.startMinutes ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Validates a whole list and returns it normalized and sorted, or an error.
 *
 * Two blocks of one task with the same day and start would collide on the
 * table's unique key (a 500), and two untimed blocks on one day say nothing
 * the first did not, so both are rejected here with a reason instead.
 */
export function normalizeBlocks(
  blocks: WorkBlockInput[],
): { blocks: NormalizedBlock[] } | { error: string } {
  if (blocks.length > MAX_BLOCKS_PER_TASK) {
    return { error: `A task can have at most ${MAX_BLOCKS_PER_TASK} work blocks` };
  }
  const seen = new Set<string>();
  const out: NormalizedBlock[] = [];
  for (const b of blocks) {
    const pairError = validateTimePair(b.startMinutes, b.endMinutes);
    if (pairError) return { error: pairError };
    const block = { date: b.date, startMinutes: b.startMinutes ?? null, endMinutes: b.endMinutes ?? null };
    const key = `${block.date}@${block.startMinutes ?? 'any'}`;
    if (seen.has(key)) {
      return {
        error: block.startMinutes === null
          ? 'Only one any-time work block per day'
          : 'Two work blocks start at the same time on the same day',
      };
    }
    seen.add(key);
    out.push(block);
  }
  return { blocks: out.sort(compareBlocks) };
}

/** The time a task takes when it becomes a habit: its earliest timed block's. */
export function firstTimedBlock(blocks: NormalizedBlock[]): NormalizedBlock | null {
  return [...blocks].sort(compareBlocks).find((b) => b.startMinutes !== null) ?? null;
}

/** How blocks are read back: the same order the list is validated in. */
export const BLOCK_ORDER = [{ date: 'asc' as const }, { startMinutes: { sort: 'asc' as const, nulls: 'last' as const } }];
