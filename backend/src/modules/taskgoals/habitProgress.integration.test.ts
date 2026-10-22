import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Goals linked to habits.
 *
 * A linked habit used to be counted as its template — which is never
 * completed — plus today's instance, so any goal with a habit on it was stuck
 * below 100%. A habit now counts as ONE item, done when its most recent
 * scheduled day was completed (product decision, 2026-10-21).
 *
 * The app also links a habit through whichever row it is showing, usually
 * today's instance. Instances inherit the template's goal when they spawn, so
 * that link used to fall off overnight. The template and live instance now
 * move together.
 */

function utcDayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = utcDayOffset(0);
const YESTERDAY = utcDayOffset(-1);
const TOMORROW = utcDayOffset(1);
const EVERY_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

/** A daily habit, created today, so today's instance is spawned with it. */
async function createHabit(user: TestUser, taskGoalId?: string) {
  const res = await authed(user)
    .post('/tasks')
    .send({ title: 'Code 1h', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY, taskGoalId });
  expect(res.status).toBe(200);
  const templateId = res.body.data.id as string;
  const instance = await prisma.task.findFirstOrThrow({ where: { parentTaskId: templateId, isArchived: false } });
  return { templateId, instanceId: instance.id };
}

async function complete(user: TestUser, taskId: string) {
  const res = await authed(user).patch(`/tasks/${taskId}`).send({ isCompleted: true });
  expect(res.status).toBe(200);
}

async function getGoal(user: TestUser, goalId: string) {
  const res = await authed(user).get('/task-goals');
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId);
}

describe('GET /task-goals — a linked habit counts once', () => {
  it('counts a habit as one item, not its template plus its instance', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    await createHabit(user, goalId);

    const goal = await getGoal(user, goalId);
    expect(goal.linkedTaskCount).toBe(1);
    expect(goal.completedTaskCount).toBe(0);
  });

  it('reaches 100% and auto-completes once tasks are done and the habit is kept today', async () => {
    // The bug: this goal used to read 2/3 at best, forever.
    const user = await createUser();
    const goalId = await createGoal(user);
    const taskId = await createTask(user, 'Write case study', goalId);
    const { instanceId } = await createHabit(user, goalId);

    await complete(user, taskId);
    expect((await getGoal(user, goalId)).overallProgress).toBe(0.5);

    await complete(user, instanceId);

    const goal = await getGoal(user, goalId);
    expect(goal.linkedTaskCount).toBe(2);
    expect(goal.completedTaskCount).toBe(2);
    expect(goal.overallProgress).toBe(1);
    expect(goal.isCompleted).toBe(true);
  });

  it('counts the habit as open while today’s instance is not done', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    // Habit first: completing the only task on a goal is 1/1 and completes it.
    await createHabit(user, goalId);
    await complete(user, await createTask(user, 'Deploy site', goalId));

    const goal = await getGoal(user, goalId);
    expect(goal.completedTaskCount).toBe(1);
    expect(goal.linkedTaskCount).toBe(2);
    expect(goal.isCompleted).toBe(false);
  });

  it('holds steady on a day the habit is not scheduled, using its latest day', async () => {
    // Yesterday's instance, completed and already archived by the spawner,
    // with nothing spawned today.
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId, instanceId } = await createHabit(user, goalId);
    await prisma.task.update({
      where: { id: instanceId },
      data: { dueDate: new Date(`${YESTERDAY}T12:00:00.000Z`), isCompleted: true, isArchived: true },
    });
    await prisma.task.update({ where: { id: templateId }, data: { recurringDays: [] } });

    const goal = await getGoal(user, goalId);
    expect(goal.linkedTaskCount).toBe(1);
    expect(goal.completedTaskCount).toBe(1);
  });

  it('judges by the NEWEST day: kept yesterday but not yet today is open', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId } = await createHabit(user, goalId);
    await prisma.task.create({
      data: {
        userId: user.id,
        title: 'Code 1h',
        parentTaskId: templateId,
        taskGoalId: goalId,
        dueDate: new Date(`${YESTERDAY}T12:00:00.000Z`),
        isCompleted: true,
        isArchived: true,
      },
    });

    expect((await getGoal(user, goalId)).completedTaskCount).toBe(0);
  });

  it('still counts a habit linked only through its instance (data written before this fix)', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId, instanceId } = await createHabit(user);
    await prisma.task.update({ where: { id: instanceId }, data: { taskGoalId: goalId } });

    expect((await getGoal(user, goalId)).linkedTaskCount).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: templateId } })).taskGoalId).toBeNull();
  });

  it('stops counting a deleted habit', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId } = await createHabit(user, goalId);

    const res = await authed(user).delete(`/tasks/${templateId}`);
    expect(res.status).toBe(200);

    expect((await getGoal(user, goalId)).linkedTaskCount).toBe(0);
  });
});

describe('linking a habit links the template and live instance together', () => {
  it('POST /task-goals/:id/tasks with the instance links the template, so tomorrow keeps it', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId, instanceId } = await createHabit(user);

    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [instanceId] });
    expect(res.status).toBe(200);
    expect(res.body.data.linkedTaskCount).toBe(1);

    const template = await prisma.task.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.taskGoalId).toBe(goalId);

    // Tomorrow's instance inherits the goal from the template.
    const spawn = await authed(user).post('/tasks/spawn-recurring').send({ localDate: TOMORROW });
    expect(spawn.status).toBe(200);
    const tomorrows = await prisma.task.findFirstOrThrow({ where: { parentTaskId: templateId, isArchived: false } });
    expect(tomorrows.id).not.toBe(instanceId);
    expect(tomorrows.taskGoalId).toBe(goalId);
  });

  it('unlinking the instance unlinks the habit', async () => {
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId, instanceId } = await createHabit(user, goalId);

    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ unlink: [instanceId] });
    expect(res.status).toBe(200);
    expect(res.body.data.linkedTaskCount).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: templateId } })).taskGoalId).toBeNull();
  });

  it('PATCH /tasks/:id on the instance moves the template too', async () => {
    // What the task edit form sends for a habit.
    const user = await createUser();
    const goalId = await createGoal(user);
    const { templateId, instanceId } = await createHabit(user);

    const res = await authed(user).patch(`/tasks/${instanceId}`).send({ taskGoalId: goalId });
    expect(res.status).toBe(200);

    expect((await prisma.task.findUniqueOrThrow({ where: { id: templateId } })).taskGoalId).toBe(goalId);
  });

  it('POST /task-goals with the instance links the template', async () => {
    const user = await createUser();
    const { templateId, instanceId } = await createHabit(user);

    const res = await authed(user).post('/task-goals').send({ title: 'Get fit', taskIds: [instanceId] });
    expect(res.status).toBe(201);

    const template = await prisma.task.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.taskGoalId).toBe(res.body.data.id);
    expect(res.body.data.linkedTaskCount).toBe(1);
  });

  it('refuses to link someone else’s habit, writing nothing', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const goalId = await createGoal(intruder);
    const { templateId, instanceId } = await createHabit(owner);

    const res = await authed(intruder).post(`/task-goals/${goalId}/tasks`).send({ link: [instanceId] });
    expect(res.status).toBe(404);

    const rows = await prisma.task.findMany({ where: { id: { in: [templateId, instanceId] } } });
    expect(rows.every((r) => r.taskGoalId === null)).toBe(true);
  });
});
