import { describe, it, expect } from 'vitest';
import { createUser, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { runWorkBlockCutover } from './workBlockCutover';

/**
 * The one-time cutover that moves one-off tasks' times onto work blocks.
 *
 * It runs once per environment with no reconciliation afterwards, so it has to
 * be right the first time: a timed task gets one block on its due day and keeps
 * its due date, a habit is untouched, a re-run changes nothing, and a dry run
 * writes nothing. Rows are written with Prisma directly, as older code stored
 * them, because the routes now refuse times on one-off tasks.
 */

const FRI = '2026-11-06';

function timedTask(user: TestUser, overrides: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Proposal',
      dueDate: new Date(`${FRI}T00:00:00.000Z`),
      startMinutes: 9 * 60,
      endMinutes: 11 * 60,
      ...overrides,
    },
  });
}

describe('runWorkBlockCutover', () => {
  it('moves a timed task onto a block on its due day and keeps the due date', async () => {
    const user = await createUser();
    const task = await timedTask(user);

    const result = await runWorkBlockCutover({ dryRun: false });

    expect(result).toEqual({ timedTasks: 1, blocksCreated: 1, timesCleared: 1 });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { blocks: true } });
    expect(after.startMinutes).toBeNull();
    expect(after.endMinutes).toBeNull();
    expect(after.dueDate?.toISOString().slice(0, 10)).toBe(FRI);
    expect(after.blocks.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes })))
      .toEqual([{ date: FRI, startMinutes: 9 * 60, endMinutes: 11 * 60 }]);
  });

  it('clears half a time without making a block, and leaves habits alone', async () => {
    const user = await createUser();
    const half = await timedTask(user, { endMinutes: null });
    const habit = await timedTask(user, { title: 'Gym', isRecurring: true, dueDate: null });

    const result = await runWorkBlockCutover({ dryRun: false });

    expect(result).toEqual({ timedTasks: 0, blocksCreated: 0, timesCleared: 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: half.id } })).startMinutes).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: habit.id } })).startMinutes).toBe(9 * 60);
    expect(await prisma.workBlock.count()).toBe(0);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    const user = await createUser();
    await timedTask(user);
    await runWorkBlockCutover({ dryRun: false });

    expect(await runWorkBlockCutover({ dryRun: false })).toEqual({ timedTasks: 0, blocksCreated: 0, timesCleared: 0 });
    expect(await prisma.workBlock.count()).toBe(1);
  });

  it('skips a block that already exists', async () => {
    const user = await createUser();
    const task = await timedTask(user);
    await prisma.workBlock.create({ data: { userId: user.id, taskId: task.id, date: FRI, startMinutes: 9 * 60, endMinutes: 11 * 60 } });

    expect(await runWorkBlockCutover({ dryRun: false })).toEqual({ timedTasks: 1, blocksCreated: 0, timesCleared: 1 });
    expect(await prisma.workBlock.count()).toBe(1);
  });

  it('dry run counts and writes nothing', async () => {
    const user = await createUser();
    const task = await timedTask(user);

    expect(await runWorkBlockCutover({ dryRun: true })).toEqual({ timedTasks: 1, blocksCreated: 1, timesCleared: 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).startMinutes).toBe(9 * 60);
    expect(await prisma.workBlock.count()).toBe(0);
  });
});
