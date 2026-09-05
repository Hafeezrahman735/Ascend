import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUser, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { backfillGoalCompletion } from './backfillGoalCompletion';
import { eventBus } from '../middleware/eventBus';

/**
 * The backfill has one job the tests must actually prove: it completes goals
 * WITHOUT celebrating them.
 *
 * Collapsing goal progress to tasks moves a population across 100% for the first
 * time. If those goals complete through the normal path they each fire XP, a
 * goal_completed feed event and a notification, drip-fed over days as the user
 * next touches each one — congratulations for work finished weeks ago, and a
 * lump of XP that can cross a rank threshold with nothing on screen to explain
 * it. Asserting "no events emitted" is therefore the point of this file, not a
 * detail of it.
 */

async function makeGoal(
  user: TestUser,
  overrides: { targetSessions?: number; progressMode?: 'tasks' | 'sessions' | 'both'; isCompleted?: boolean } = {},
) {
  const goal = await prisma.taskGoal.create({
    data: {
      userId: user.id,
      title: 'A goal',
      targetSessions: overrides.targetSessions ?? null,
      progressMode: overrides.progressMode ?? 'tasks',
      isCompleted: overrides.isCompleted ?? false,
      ...(overrides.isCompleted ? { completedAt: new Date('2026-01-01T00:00:00Z') } : {}),
    },
  });
  return goal.id;
}

async function makeTask(
  user: TestUser,
  goalId: string | null,
  opts: { isCompleted?: boolean; completedAt?: Date } = {},
) {
  const task = await prisma.task.create({
    data: {
      userId: user.id,
      title: 'A task',
      taskGoalId: goalId,
      isCompleted: opts.isCompleted ?? false,
      completedAt: opts.isCompleted ? (opts.completedAt ?? new Date()) : null,
    },
  });
  return task.id;
}

const goalRow = (id: string) => prisma.taskGoal.findUnique({ where: { id } });

describe('backfillGoalCompletion', () => {
  let emitted: string[];

  beforeEach(() => {
    emitted = [];
    vi.spyOn(eventBus, 'emit').mockImplementation(((event: string, ..._rest: unknown[]) => {
      emitted.push(event);
      return true;
    }) as typeof eventBus.emit);
  });

  it('completes a goal whose tasks are all done but whose session target never was', async () => {
    // THE migration population: under the old 50/50 blend this was
    // (1.0 + 9/10) / 2 = 0.95 and stayed open.
    const user = await createUser();
    const goalId = await makeGoal(user, { targetSessions: 10, progressMode: 'both' });
    await makeTask(user, goalId, { isCompleted: true });
    await makeTask(user, goalId, { isCompleted: true });

    const result = await backfillGoalCompletion({ dryRun: false });

    expect(result.completed).toBe(1);
    expect((await goalRow(goalId))?.isCompleted).toBe(true);
  });

  it('awards no XP, emits no feed event and sends no notification', async () => {
    const user = await createUser();
    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { xp: true } });
    const goalId = await makeGoal(user, { targetSessions: 10, progressMode: 'both' });
    await makeTask(user, goalId, { isCompleted: true });

    await backfillGoalCompletion({ dryRun: false });

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { xp: true } });
    expect(after?.xp).toBe(before?.xp);
    expect(emitted).toEqual([]);
    expect(await prisma.feedEvent.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
    // Guard the guard: the goal really was completed, so the assertions above
    // are not passing because nothing happened at all.
    expect((await goalRow(goalId))?.isCompleted).toBe(true);
  });

  it('dates the completion by the LAST finished task, not by now', async () => {
    // The work finished weeks ago. Stamping it "now" would date every migrated
    // goal to the deploy and make elapsedDays meaningless.
    const user = await createUser();
    const goalId = await makeGoal(user);
    const early = new Date('2026-07-01T10:00:00Z');
    const late = new Date('2026-07-20T10:00:00Z');
    await makeTask(user, goalId, { isCompleted: true, completedAt: early });
    await makeTask(user, goalId, { isCompleted: true, completedAt: late });

    await backfillGoalCompletion({ dryRun: false });

    expect((await goalRow(goalId))?.completedAt?.toISOString()).toBe(late.toISOString());
  });

  it('writes nothing on a dry run, but reports the same count', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    await makeTask(user, goalId, { isCompleted: true });

    const dry = await backfillGoalCompletion({ dryRun: true });

    expect(dry.completed).toBe(1);
    expect((await goalRow(goalId))?.isCompleted).toBe(false);
  });

  it('is a no-op on a second run', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    await makeTask(user, goalId, { isCompleted: true });

    await backfillGoalCompletion({ dryRun: false });
    const completedAt = (await goalRow(goalId))?.completedAt;
    const second = await backfillGoalCompletion({ dryRun: false });

    expect(second.scanned).toBe(0);
    expect(second.completed).toBe(0);
    expect((await goalRow(goalId))?.completedAt).toEqual(completedAt);
  });

  it('leaves a goal with unfinished tasks alone', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    await makeTask(user, goalId, { isCompleted: true });
    await makeTask(user, goalId, { isCompleted: false });

    const result = await backfillGoalCompletion({ dryRun: false });

    expect(result.completed).toBe(0);
    expect(result.stillOpen).toBe(1);
    expect((await goalRow(goalId))?.isCompleted).toBe(false);
  });

  it('leaves a goal with NO linked tasks alone', async () => {
    // 0/0 is 0%, not 100%. An empty goal is not a finished one, and a goal that
    // only ever had a session target lands here — which is exactly why the UI
    // flags "no tasks linked" rather than letting it sit at 0% forever.
    const user = await createUser();
    const goalId = await makeGoal(user, { targetSessions: 20, progressMode: 'sessions' });

    const result = await backfillGoalCompletion({ dryRun: false });

    expect(result.completed).toBe(0);
    expect(result.empty).toBe(1);
    expect((await goalRow(goalId))?.isCompleted).toBe(false);
  });

  it('does not disturb a goal that was already completed', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user, { isCompleted: true });
    await makeTask(user, goalId, { isCompleted: true });

    const result = await backfillGoalCompletion({ dryRun: false });

    expect(result.scanned).toBe(0);
    expect((await goalRow(goalId))?.completedAt?.toISOString())
      .toBe(new Date('2026-01-01T00:00:00Z').toISOString());
  });

  it('never counts one user’s tasks toward another user’s goal', async () => {
    const [mine, stranger] = [await createUser(), await createUser()];
    const goalId = await makeGoal(mine);
    // A task carrying the goal id but owned by someone else.
    await prisma.task.create({
      data: { userId: stranger.id, title: 'theirs', taskGoalId: goalId, isCompleted: true },
    });

    const result = await backfillGoalCompletion({ dryRun: false });

    expect(result.empty).toBe(1);
    expect((await goalRow(goalId))?.isCompleted).toBe(false);
  });
});
