import { describe, it, expect } from 'vitest';
import { createUser, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { runRecurringCutover } from './recurringCutover';

/**
 * The one-time cutover that deletes recurring tasks' daily copies.
 *
 * It runs once against production with no reconciliation afterwards, so what
 * it keeps has to be right the first time: each completed day becomes a log
 * row, each session moves onto its recurring task, and a dry run writes
 * nothing.
 */

const MON = '2026-10-26';
const TUE = '2026-10-27';

async function makeHabit(user: TestUser) {
  return prisma.task.create({
    data: { userId: user.id, title: 'Read', isRecurring: true, recurringDays: [] },
  });
}

async function makeCopy(user: TestUser, parentTaskId: string, day: string, isCompleted: boolean) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Read',
      parentTaskId,
      dueDate: new Date(`${day}T00:00:00.000Z`),
      isCompleted,
      completedAt: isCompleted ? new Date(`${day}T18:00:00.000Z`) : null,
    },
  });
}

async function makeSession(user: TestUser, taskId: string) {
  return prisma.session.create({
    data: {
      userId: user.id,
      type: 'focus',
      durationSeconds: 1500,
      completedAt: new Date(),
      taskId,
      taskLabel: 'Read',
    },
  });
}

/** A habit with a completed Monday (worked on), an open Tuesday, and an orphan copy. */
async function seed() {
  const user = await createUser();
  const habit = await makeHabit(user);
  const monday = await makeCopy(user, habit.id, MON, true);
  await makeCopy(user, habit.id, TUE, false);
  const worked = await makeSession(user, monday.id);
  // A copy whose recurring task row is gone: parent_task_id has no foreign key.
  const orphan = await makeCopy(user, 'deleted-habit', MON, true);
  const orphanSession = await makeSession(user, orphan.id);
  return { user, habit, worked, orphanSession };
}

describe('runRecurringCutover', () => {
  it('reports what it would do and writes nothing on a dry run', async () => {
    const { habit } = await seed();

    const result = await runRecurringCutover({ dryRun: true });

    expect(result).toEqual({ copies: 3, completionsAdded: 1, sessionsRepointed: 1, sessionsDetached: 1 });
    expect(await prisma.task.count({ where: { parentTaskId: { not: null } } })).toBe(3);
    expect(await prisma.recurringCompletion.count({ where: { taskId: habit.id } })).toBe(0);
  });

  it('keeps completed days and session time, then deletes every copy', async () => {
    const { habit, worked, orphanSession } = await seed();

    const result = await runRecurringCutover({ dryRun: false });

    expect(result).toEqual({ copies: 3, completionsAdded: 1, sessionsRepointed: 1, sessionsDetached: 1 });
    expect(await prisma.task.count({ where: { parentTaskId: { not: null } } })).toBe(0);

    const log = await prisma.recurringCompletion.findMany({ where: { taskId: habit.id } });
    expect(log.map((c) => c.date)).toEqual([MON]);
    expect(log[0].completedAt.toISOString()).toBe(`${MON}T18:00:00.000Z`);

    expect((await prisma.session.findUniqueOrThrow({ where: { id: worked.id } })).taskId).toBe(habit.id);
    const detached = await prisma.session.findUniqueOrThrow({ where: { id: orphanSession.id } });
    expect(detached.taskId).toBeNull();
    expect(detached.taskLabel).toBe('Read');

    // The recurring task itself is untouched.
    expect(await prisma.task.findUnique({ where: { id: habit.id } })).not.toBeNull();
  });

  it('does not duplicate a day the log already has, and a second run is a no-op', async () => {
    const { user, habit } = await seed();
    await prisma.recurringCompletion.create({ data: { userId: user.id, taskId: habit.id, date: MON } });

    const first = await runRecurringCutover({ dryRun: false });
    expect(first.completionsAdded).toBe(0);
    expect(await prisma.recurringCompletion.count({ where: { taskId: habit.id } })).toBe(1);

    const second = await runRecurringCutover({ dryRun: false });
    expect(second).toEqual({ copies: 0, completionsAdded: 0, sessionsRepointed: 0, sessionsDetached: 0 });
  });
});
