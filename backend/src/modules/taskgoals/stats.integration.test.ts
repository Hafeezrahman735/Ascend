import { describe, it, expect } from 'vitest';
import { createUser, authed } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Goal time stats.
 *
 * Goal PROGRESS stays task-denominated — how many linked tasks are done. Time
 * and session count are reported beside it, because once focus blocks could
 * differ in length a session count stopped being a usable measure of effort.
 *
 * The archived-task case below is the one that matters most: it was already
 * wrong before this feature, and the new stat would have made it loud.
 */

const MIN = 60;

async function createGoal(user: Awaited<ReturnType<typeof createUser>>, title: string) {
  const res = await authed(user).post('/task-goals').send({ title });
  expect(res.status).toBe(201); // goal creation returns Created, unlike /tasks
  return res.body.data.id as string;
}

async function createTask(
  user: Awaited<ReturnType<typeof createUser>>,
  title: string,
  taskGoalId?: string,
) {
  const res = await authed(user).post('/tasks').send({ title, taskGoalId });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(
  user: Awaited<ReturnType<typeof createUser>>,
  taskId: string,
  minutes: number,
) {
  const seconds = minutes * MIN;
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: seconds,
    plannedDurationSeconds: seconds,
    taskId,
  });
  expect(res.status).toBe(200);
}

/**
 * There is no GET /task-goals/:id — the list endpoint is the only read path,
 * and it is what the client actually calls. Fetching through it keeps these
 * tests on the real route rather than one added for their convenience.
 */
async function getGoal(user: Awaited<ReturnType<typeof createUser>>, goalId: string) {
  const res = await authed(user).get('/task-goals');
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId);
}

describe('GET /task-goals/:id — focus time', () => {
  it('sums sessions of DIFFERENT lengths', async () => {
    // 20 + 25 + 15 = 60 minutes across 3 sessions. A count alone would say "3",
    // which is the same number a goal of three 5-minute sessions would report.
    const user = await createUser();
    const goalId = await createGoal(user, 'Ship it');
    const taskA = await createTask(user, 'Task A', goalId);
    const taskB = await createTask(user, 'Task B', goalId);

    await logSession(user, taskA, 20);
    await logSession(user, taskA, 25);
    await logSession(user, taskB, 15);

    const goal = await getGoal(user, goalId);
    expect(goal.totalFocusSeconds).toBe(60 * MIN);
    expect(goal.actualSessions).toBe(3);
    expect(goal.linkedTaskCount).toBe(2);
  });

  it('reports zero, not null, for a goal with no sessions', async () => {
    // Prisma types _sum as nullable, so an empty group must not leak through.
    const user = await createUser();
    const goalId = await createGoal(user, 'Untouched');
    await createTask(user, 'Not started', goalId);

    const goal = await getGoal(user, goalId);
    expect(goal.totalFocusSeconds).toBe(0);
    expect(goal.actualSessions).toBe(0);
  });

  it('still counts time spent on a task that was later ARCHIVED', async () => {
    // The recurring-habit bug. spawn-recurring archives yesterday's instance
    // every day, and each instance carries the template's taskGoalId — so
    // filtering archived tasks out of the session query hid every session older
    // than today, and a goal linked to a habit reported near-zero forever.
    // Time already spent does not become un-spent when its row is archived.
    const user = await createUser();
    const goalId = await createGoal(user, 'Daily habit');
    const taskId = await createTask(user, 'Yesterday instance', goalId);

    await logSession(user, taskId, 30);
    await prisma.task.update({ where: { id: taskId }, data: { isArchived: true } });

    const goal = await getGoal(user, goalId);
    expect(goal.totalFocusSeconds).toBe(30 * MIN);
    expect(goal.actualSessions).toBe(1);
    // The task count DOES exclude archived rows — an archived instance should
    // not inflate how much work the goal contains.
    expect(goal.linkedTaskCount).toBe(0);
  });

  it('never counts another user’s time', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const goalId = await createGoal(owner, 'Mine');
    const ownTask = await createTask(owner, 'Mine', goalId);
    await logSession(owner, ownTask, 10);

    // The stranger's own task, pointed at the same goal id.
    const strangerTask = await createTask(stranger, 'Theirs');
    await prisma.task.update({ where: { id: strangerTask }, data: { taskGoalId: goalId } });
    await logSession(stranger, strangerTask, 45);

    const goal = await getGoal(owner, goalId);
    expect(goal.totalFocusSeconds).toBe(10 * MIN);
    expect(goal.actualSessions).toBe(1);
  });

  it('does not surface a goal to anyone but its owner', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const goalId = await createGoal(owner, 'Private');

    expect(await getGoal(stranger, goalId)).toBeUndefined();
    expect(await getGoal(owner, goalId)).toBeDefined();
  });
});

describe('GET /task-goals/:id — elapsed days', () => {
  it('is zero for a goal created today, never negative', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Fresh');

    const goal = await getGoal(user, goalId);
    expect(goal.elapsedDays).toBe(0);
  });

  it('clamps at zero even when completedAt predates creation', async () => {
    // completedAt arrives from the client and is not validated for ordering, so
    // a bad device clock could otherwise render a negative age.
    const user = await createUser();
    const goalId = await createGoal(user, 'Time traveller');

    await prisma.taskGoal.update({
      where: { id: goalId },
      data: { isCompleted: true, completedAt: new Date(Date.now() - 10 * 86_400_000) },
    });

    const goal = await getGoal(user, goalId);
    expect(goal.elapsedDays).toBe(0);
  });
});

describe('goal progress is unchanged by the time stat', () => {
  it('still measures completed tasks, not minutes', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Two tasks');
    const taskA = await createTask(user, 'A', goalId);
    await createTask(user, 'B', goalId);

    // Hours of focus on A, but B is not done — progress must stay at one half.
    await logSession(user, taskA, 120);
    await authed(user).patch(`/tasks/${taskA}`).send({ isCompleted: true });

    const goal = await getGoal(user, goalId);
    expect(goal.totalFocusSeconds).toBe(120 * MIN);
    expect(goal.overallProgress).toBeCloseTo(0.5, 5);
    expect(goal.isCompleted).toBe(false);
  });
});
