import { describe, it, expect, vi } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { dayNameFromLocalDate } from '../../lib/localDate';

/**
 * Goals linked to recurring tasks.
 *
 * A recurring task counts as ONE item, done when its most recent due day on or
 * before the user's today was ticked off (product decision, 2026-10-21). Its
 * done days live in the completion log, so a goal reads the same thing the
 * task list and the streak do.
 */

function utcDayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = utcDayOffset(0);
const YESTERDAY = utcDayOffset(-1);

async function createGoal(user: TestUser, title = 'Ship portfolio') {
  const res = await authed(user).post('/task-goals').send({ title });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createTask(user: TestUser, title: string, taskGoalId?: string) {
  const res = await authed(user).post('/tasks').send({ title, taskGoalId });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

/** A recurring task running for ten days, every day unless told otherwise. */
async function createHabit(user: TestUser, taskGoalId?: string, recurringDays: string[] = []) {
  const task = await prisma.task.create({
    data: {
      userId: user.id,
      title: 'Code 1h',
      isRecurring: true,
      recurringDays,
      taskGoalId,
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    },
  });
  return task.id;
}

async function tick(user: TestUser, taskId: string) {
  const res = await authed(user).put(`/tasks/${taskId}/completions/${TODAY}`).send({ localDate: TODAY });
  expect(res.status).toBe(200);
}

const logDay = (user: TestUser, taskId: string, date: string) =>
  prisma.recurringCompletion.create({ data: { userId: user.id, taskId, date } });

async function complete(user: TestUser, taskId: string) {
  const res = await authed(user).patch(`/tasks/${taskId}`).send({ isCompleted: true });
  expect(res.status).toBe(200);
}

async function getGoal(user: TestUser, goalId: string, localDate = TODAY) {
  const res = await authed(user).get(`/task-goals?localDate=${localDate}`);
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId);
}

/** Feed events land through a fire-and-forget listener; wait for them. */
async function settleFeed(user: TestUser, count: number) {
  await vi.waitFor(async () => {
    expect(await prisma.feedEvent.count({ where: { userId: user.id } })).toBe(count);
  });
}

describe('GET /task-goals — a linked recurring task counts once', () => {
  it('counts it as one item', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    await createHabit(user, goalId);

    const goal = await getGoal(user, goalId);
    expect(goal.linkedTaskCount).toBe(1);
    expect(goal.completedTaskCount).toBe(0);
  });

  it('reaches 100% and auto-completes once tasks are done and the habit is ticked today', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const taskId = await createTask(user, 'Write case study', goalId);
    const habitId = await createHabit(user, goalId);

    await complete(user, taskId);
    expect((await getGoal(user, goalId)).overallProgress).toBe(0.5);

    await tick(user, habitId);

    const goal = await getGoal(user, goalId);
    expect(goal.completedTaskCount).toBe(2);
    expect(goal.overallProgress).toBe(1);
    expect(goal.isCompleted).toBe(true);
    // task_completed twice, goal_completed once.
    await settleFeed(user, 3);
  });

  it('judges by the NEWEST due day: kept yesterday but not yet today is open', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user, goalId);
    await logDay(user, habitId, YESTERDAY);

    expect((await getGoal(user, goalId)).completedTaskCount).toBe(0);
  });

  it('holds steady on a day the habit is not scheduled, using its latest day', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user, goalId, [dayNameFromLocalDate(YESTERDAY)]);
    await logDay(user, habitId, YESTERDAY);

    expect((await getGoal(user, goalId)).completedTaskCount).toBe(1);
  });

  it('counts a ticked day even after the schedule stops including it', async () => {
    // Narrowing a schedule must never lose a completed day.
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user, goalId, [dayNameFromLocalDate(utcDayOffset(-3))]);
    await logDay(user, habitId, YESTERDAY);

    expect((await getGoal(user, goalId)).completedTaskCount).toBe(1);
  });

  it("uses the client's today, not the server's", async () => {
    // Kept yesterday only. For a user whose local day is still yesterday, that
    // is their latest due day, and done; for one already on today, it is open.
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user, goalId);
    await logDay(user, habitId, YESTERDAY);

    expect((await getGoal(user, goalId, YESTERDAY)).completedTaskCount).toBe(1);
    expect((await getGoal(user, goalId, TODAY)).completedTaskCount).toBe(0);
  });

  it('stops counting a deleted habit', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user, goalId);

    const res = await authed(user).delete(`/tasks/${habitId}`);
    expect(res.status).toBe(200);

    expect((await getGoal(user, goalId)).linkedTaskCount).toBe(0);
  });
});

describe('linking a recurring task to a goal', () => {
  it('POST /task-goals/:id/tasks links it', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const habitId = await createHabit(user);

    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [habitId] });

    expect(res.status).toBe(200);
    expect(res.body.data.linkedTaskCount).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: habitId } })).taskGoalId).toBe(goalId);
  });

  it('refuses to link someone else’s habit, writing nothing', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const goalId = await createGoal(intruder);
    const habitId = await createHabit(owner);

    const res = await authed(intruder).post(`/task-goals/${goalId}/tasks`).send({ link: [habitId] });

    expect(res.status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: habitId } })).taskGoalId).toBeNull();
  });
});
