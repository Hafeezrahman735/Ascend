import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Session attribution, written by the real `POST /timer/complete` against a
 * real database.
 *
 * `lib/sessionAttribution.test.ts` pins the mapping. This file covers what only
 * the route can get wrong: that the stamp reaches the row at all, that the goal
 * is resolved and ownership-scoped, and — the reason this feature exists — that
 * attribution survives the task being archived.
 */

const MIN = 60;

async function createGoal(user: TestUser, title: string) {
  const res = await authed(user).post('/task-goals').send({ title });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createTask(
  user: TestUser,
  body: Record<string, unknown>,
) {
  const res = await authed(user).post('/tasks').send(body);
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(
  user: TestUser,
  body: Record<string, unknown> = {},
) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: 25 * MIN,
    plannedDurationSeconds: 25 * MIN,
    ...body,
  });
  expect(res.status).toBe(200);
  return res.body.data.sessionId as string;
}

function readSession(sessionId: string) {
  return prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
}

describe('POST /timer/complete attribution', () => {
  it('stamps the task title, tags and priority onto the session', async () => {
    const user = await createUser();
    const taskId = await createTask(user, {
      title: 'Thermodynamics problem set',
      tags: ['Physics', 'Exam'],
      priority: 'high',
    });

    const session = await readSession(await logSession(user, { taskId }));

    expect(session.taskTitleSnapshot).toBe('Thermodynamics problem set');
    expect(session.primaryTag).toBe('Physics');
    expect(session.tags).toEqual(['Physics', 'Exam']);
    expect(session.priority).toBe('high');
    expect(session.wasRecurring).toBe(false);
  });

  it('stamps the goal id and title for a task linked to a goal', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Chemistry Degree');
    const taskId = await createTask(user, { title: 'Lab report', taskGoalId: goalId });

    const session = await readSession(await logSession(user, { taskId }));

    expect(session.taskGoalId).toBe(goalId);
    expect(session.goalTitleSnapshot).toBe('Chemistry Degree');
  });

  it('keeps attribution after the task is archived', async () => {
    // The whole reason this feature exists. Recurring habits archive
    // yesterday's instance every day, and the old read-time lookup went
    // through GET /tasks (isArchived: false) — so a habit's history silently
    // became "Untagged" overnight. A frozen stamp cannot be lost this way.
    const user = await createUser();
    const goalId = await createGoal(user, 'Daily Practice');
    const taskId = await createTask(user, {
      title: 'Morning revision',
      tags: ['Physics'],
      taskGoalId: goalId,
    });

    const sessionId = await logSession(user, { taskId });
    await prisma.task.update({ where: { id: taskId }, data: { isArchived: true } });

    const session = await readSession(sessionId);
    expect(session.primaryTag).toBe('Physics');
    expect(session.taskTitleSnapshot).toBe('Morning revision');
    expect(session.taskGoalId).toBe(goalId);
    expect(session.goalTitleSnapshot).toBe('Daily Practice');
  });

  it('keeps the goal title after the goal itself is deleted', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Abandoned Goal');
    const taskId = await createTask(user, { title: 'Some work', taskGoalId: goalId });
    const sessionId = await logSession(user, { taskId });

    await authed(user).delete(`/task-goals/${goalId}`);

    // No foreign key on taskGoalId, deliberately: a deleted goal must not take
    // its own history with it.
    const session = await readSession(sessionId);
    expect(session.goalTitleSnapshot).toBe('Abandoned Goal');
  });

  it('records a free-form session with no task as genuinely unattributed', async () => {
    const user = await createUser();
    const session = await readSession(await logSession(user, { taskLabel: 'Reading' }));

    expect(session.taskId).toBeNull();
    expect(session.taskTitleSnapshot).toBeNull();
    expect(session.primaryTag).toBeNull();
    expect(session.tags).toEqual([]);
    expect(session.taskGoalId).toBeNull();
    // Still placed in time — it happened, it just was not about a task.
    expect(session.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(session.localWeekday).toBeGreaterThanOrEqual(0);
  });

  it('resolves the hour in the zone the client sends', async () => {
    const user = await createUser();
    const completedAt = Date.now();
    const taskId = await createTask(user, { title: 'Timezone task' });

    const session = await readSession(
      await logSession(user, { taskId, completedAt, tz: 'Asia/Tokyo' }),
    );

    const expectedHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23',
      }).format(new Date(completedAt)),
    );
    expect(session.localHour).toBe(expectedHour);
  });

  it('flags the hour as approximate when the client sends no zone', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'No tz' });
    const session = await readSession(await logSession(user, { taskId }));

    expect(session.localDateApprox).toBe(true);
    expect(session.localHour).not.toBeNull();
  });

  it('does not fail the session when the zone is garbage', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Bad tz' });
    // Losing focus time over a malformed header would be far worse than
    // recording an approximate hour.
    const session = await readSession(
      await logSession(user, { taskId, tz: 'Mars/Olympus_Mons' }),
    );
    expect(session.localHour).toBeGreaterThanOrEqual(0);
    expect(session.localHour).toBeLessThanOrEqual(23);
  });

  it('never attributes a session to another user’s task', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const taskId = await createTask(owner, { title: 'Private', tags: ['Secret'] });

    // The route drops an unowned taskId rather than rejecting, so the focus
    // time survives — but none of the owner's attribution may leak onto it.
    const session = await readSession(await logSession(stranger, { taskId }));

    expect(session.taskId).toBeNull();
    expect(session.primaryTag).toBeNull();
    expect(session.taskTitleSnapshot).toBeNull();
    expect(session.durationSeconds).toBe(25 * MIN);
  });

  it('marks a habit instance as recurring', async () => {
    const user = await createUser();
    const templateId = await createTask(user, {
      title: 'Daily revision',
      isRecurring: true,
      recurringDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    });

    const spawn = await authed(user).post('/tasks/spawn-recurring').send({});
    expect(spawn.status).toBe(200);

    const instance = await prisma.task.findFirst({
      where: { userId: user.id, parentTaskId: templateId },
      select: { id: true },
    });
    expect(instance).not.toBeNull();

    const session = await readSession(await logSession(user, { taskId: instance!.id }));
    expect(session.wasRecurring).toBe(true);
  });
});
