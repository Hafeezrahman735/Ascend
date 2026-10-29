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

/**
 * A daily copy as spawn-recurring wrote it. Raw SQL, because parent_task_id is
 * retired from the Prisma client (@ignore) and only the database still has it.
 * Times are written as UTC wall-clock strings, as Prisma stores them; a Date
 * parameter would be shifted into the session's time zone.
 */
async function makeCopy(
  user: TestUser,
  parentTaskId: string,
  day: string,
  isCompleted: boolean,
  { taskGoalId = null as string | null, isArchived = false } = {},
) {
  const [row] = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO tasks (id, user_id, title, parent_task_id, due_date, is_completed, completed_at,
                       task_goal_id, is_archived, updated_at)
    VALUES (gen_random_uuid()::text, ${user.id}::uuid, 'Read', ${parentTaskId},
            ${`${day} 00:00:00`}::timestamp, ${isCompleted},
            ${isCompleted ? `${day} 18:00:00` : null}::timestamp, ${taskGoalId}, ${isArchived}, now())
    RETURNING id`;
  return row;
}

const copyCount = async () =>
  (await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM tasks WHERE parent_task_id IS NOT NULL`)[0].n;

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

    expect(result).toEqual({ copies: 3, goalLinksMoved: 0, completionsAdded: 1, sessionsRepointed: 1, sessionsDetached: 1 });
    expect(await copyCount()).toBe(3);
    expect(await prisma.recurringCompletion.count({ where: { taskId: habit.id } })).toBe(0);
  });

  it('keeps completed days and session time, then deletes every copy', async () => {
    const { habit, worked, orphanSession } = await seed();

    const result = await runRecurringCutover({ dryRun: false });

    expect(result).toEqual({ copies: 3, goalLinksMoved: 0, completionsAdded: 1, sessionsRepointed: 1, sessionsDetached: 1 });
    expect(await copyCount()).toBe(0);

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
    expect(second).toEqual({ copies: 0, goalLinksMoved: 0, completionsAdded: 0, sessionsRepointed: 0, sessionsDetached: 0 });
  });

  it("gives a habit linked only through its live copy that copy's goal", async () => {
    // What the app wrote before habits were linked as a unit: only today's
    // copy carried the goal. Deleting the copy would drop the habit off it.
    const user = await createUser();
    const habit = await makeHabit(user);
    const goal = await prisma.taskGoal.create({ data: { userId: user.id, title: 'Fitness' } });
    await makeCopy(user, habit.id, TUE, false, { taskGoalId: goal.id });

    const dry = await runRecurringCutover({ dryRun: true });
    expect(dry.goalLinksMoved).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: habit.id } })).taskGoalId).toBeNull();

    await runRecurringCutover({ dryRun: false });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: habit.id } })).taskGoalId).toBe(goal.id);
  });

  it('ignores an archived goal, an archived copy and a habit that has its own goal', async () => {
    const user = await createUser();
    const archivedGoal = await prisma.taskGoal.create({ data: { userId: user.id, title: 'Old', isArchived: true } });
    const live = await prisma.taskGoal.create({ data: { userId: user.id, title: 'Live' } });
    const own = await prisma.taskGoal.create({ data: { userId: user.id, title: 'Own' } });

    const stale = await makeHabit(user);
    await makeCopy(user, stale.id, TUE, false, { taskGoalId: archivedGoal.id });
    const pastOnly = await makeHabit(user);
    await makeCopy(user, pastOnly.id, MON, true, { taskGoalId: live.id, isArchived: true });
    const linked = await prisma.task.create({
      data: { userId: user.id, title: 'Read', isRecurring: true, taskGoalId: own.id },
    });
    await makeCopy(user, linked.id, TUE, false, { taskGoalId: live.id });

    const result = await runRecurringCutover({ dryRun: false });

    expect(result.goalLinksMoved).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: linked.id } })).taskGoalId).toBe(own.id);
  });
});
