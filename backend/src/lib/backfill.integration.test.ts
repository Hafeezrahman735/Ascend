import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { backfillSessionAttribution } from './backfillAttribution';

/**
 * The backfill, against a real database.
 *
 * This writes to every session row a user has, so it gets tested rather than
 * shipped on the strength of having read it carefully. Each test creates real
 * sessions through the real timer route, strips the attribution to simulate the
 * pre-migration state, then backfills and checks what came back.
 */

const MIN = 60;

/** Undo the stamp, leaving the row as it would have been before this feature. */
async function stripAttribution(userId: string) {
  await prisma.session.updateMany({
    where: { userId },
    data: {
      taskGoalId: null, goalTitleSnapshot: null, taskTitleSnapshot: null,
      primaryTag: null, tags: [], priority: null, wasRecurring: false,
      localDate: null, localHour: null, localWeekday: null, localDateApprox: false,
    },
  });
}

async function createTask(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/tasks').send(body);
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(user: TestUser, taskId?: string) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: 25 * MIN,
    plannedDurationSeconds: 25 * MIN,
    taskId,
  });
  expect(res.status).toBe(200);
  return res.body.data.sessionId as string;
}

describe('backfillSessionAttribution', () => {
  it('recovers attribution for a session whose task was ARCHIVED', async () => {
    // The reason the backfill exists. These are the rows the old read-time
    // path could not resolve, so they are the ones with the most to recover.
    const user = await createUser();
    const goalRes = await authed(user).post('/task-goals').send({ title: 'Daily Practice' });
    const goalId = goalRes.body.data.id as string;
    const taskId = await createTask(user, {
      title: 'Morning revision', tags: ['Physics', 'Revision'], taskGoalId: goalId,
    });
    const sessionId = await logSession(user, taskId);

    await prisma.task.update({ where: { id: taskId }, data: { isArchived: true } });
    await stripAttribution(user.id);

    const result = await backfillSessionAttribution(prisma);

    expect(result.attributed).toBe(1);
    expect(result.taskMissing).toBe(0);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.primaryTag).toBe('Physics');
    expect(session.tags).toEqual(['Physics', 'Revision']);
    expect(session.taskTitleSnapshot).toBe('Morning revision');
    expect(session.taskGoalId).toBe(goalId);
    expect(session.goalTitleSnapshot).toBe('Daily Practice');
  });

  it('flags every backfilled row as approximate', async () => {
    // The user's timezone at the time was never recorded, so the hour is UTC.
    // Saying so is the difference between a measurement and a guess.
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task' });
    const sessionId = await logSession(user, taskId);
    await stripAttribution(user.id);

    await backfillSessionAttribution(prisma);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.localDateApprox).toBe(true);
    expect(session.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(session.localHour).not.toBeNull();
    expect(session.localWeekday).not.toBeNull();
  });

  it('leaves a session with no task unattributed rather than inventing one', async () => {
    const user = await createUser();
    const sessionId = await logSession(user);
    await stripAttribution(user.id);

    const result = await backfillSessionAttribution(prisma);

    expect(result.attributed).toBe(0);
    // Never had a task, so nothing was lost — this must NOT be reported as a
    // task that went missing, which would read as data loss.
    expect(result.noTask).toBe(1);
    expect(result.taskMissing).toBe(0);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.primaryTag).toBeNull();
    expect(session.taskTitleSnapshot).toBeNull();
    // Still placed in time, so it is countable even though it is uncategorised.
    expect(session.localDate).not.toBeNull();
  });

  it('never changes how much time was recorded', async () => {
    // A backfill that alters totals is a data-loss bug, not a migration.
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task', tags: ['Physics'] });
    await logSession(user, taskId);
    await logSession(user, taskId);
    await logSession(user);

    const before = await prisma.session.aggregate({
      where: { userId: user.id }, _sum: { durationSeconds: true }, _count: true,
    });
    await stripAttribution(user.id);
    await backfillSessionAttribution(prisma);
    const after = await prisma.session.aggregate({
      where: { userId: user.id }, _sum: { durationSeconds: true }, _count: true,
    });

    expect(after._sum.durationSeconds).toBe(before._sum.durationSeconds);
    expect(after._count).toBe(before._count);
  });

  it('is idempotent — a second run finds nothing to do', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task', tags: ['Physics'] });
    await logSession(user, taskId);
    await stripAttribution(user.id);

    const first = await backfillSessionAttribution(prisma);
    expect(first.scanned).toBe(1);

    const second = await backfillSessionAttribution(prisma);
    expect(second.total).toBe(0);
    expect(second.scanned).toBe(0);
  });

  it('writes nothing on a dry run but reports what it would do', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task', tags: ['Physics'] });
    const sessionId = await logSession(user, taskId);
    await stripAttribution(user.id);

    const result = await backfillSessionAttribution(prisma, { dryRun: true });

    expect(result.scanned).toBe(1);
    expect(result.attributed).toBe(1);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.localDate).toBeNull();
    expect(session.primaryTag).toBeNull();
  });

  it('does not touch sessions that are already stamped', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Fresh', tags: ['Physics'] });
    const sessionId = await logSession(user, taskId);

    // Written by the live route with a real zone, so NOT approximate. A
    // backfill that reprocessed it would downgrade good data to a guess.
    const before = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const result = await backfillSessionAttribution(prisma);

    expect(result.total).toBe(0);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.localDate).toBe(before.localDate);
    expect(after.localHour).toBe(before.localHour);
  });

  it('marks a spawned habit instance as recurring', async () => {
    const user = await createUser();
    const templateId = await createTask(user, {
      title: 'Daily revision',
      isRecurring: true,
      recurringDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    });
    await authed(user).post('/tasks/spawn-recurring').send({});
    const instance = await prisma.task.findFirstOrThrow({
      where: { userId: user.id, parentTaskId: templateId }, select: { id: true },
    });

    const sessionId = await logSession(user, instance.id);
    await stripAttribution(user.id);

    const result = await backfillSessionAttribution(prisma);
    expect(result.recurring).toBe(1);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.wasRecurring).toBe(true);
  });
});
