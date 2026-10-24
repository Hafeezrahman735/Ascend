import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * TaskGoal.plannedMinutes — focus time the user plans to spend on a goal.
 *
 * Set by the user, never derived. It feeds the planned-vs-actual time view
 * only: a goal's completion and progress stay task-based and must not move
 * when a plan is set, changed or reached.
 */

async function createGoal(user: TestUser, body: Record<string, unknown>) {
  return authed(user).post('/task-goals').send({ title: 'Ship it', ...body });
}

async function getGoal(user: TestUser, goalId: string) {
  const res = await authed(user).get('/task-goals');
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId);
}

describe('POST /task-goals — plannedMinutes', () => {
  it('stores a plan and returns it', async () => {
    const user = await createUser();
    const res = await createGoal(user, { plannedMinutes: 600 });

    expect(res.status).toBe(201);
    expect(res.body.data.plannedMinutes).toBe(600);
    expect((await prisma.taskGoal.findUniqueOrThrow({ where: { id: res.body.data.id } })).plannedMinutes).toBe(600);
  });

  it('defaults to no plan, so existing clients keep working', async () => {
    const user = await createUser();
    const res = await createGoal(user, {});

    expect(res.status).toBe(201);
    expect(res.body.data.plannedMinutes).toBeNull();
  });

  it('rejects zero, negative, fractional and over-limit plans', async () => {
    const user = await createUser();
    for (const bad of [0, -30, 12.5, 100_001, '600']) {
      const res = await createGoal(user, { plannedMinutes: bad });
      expect(res.status).toBe(400);
    }
    expect(await prisma.taskGoal.count({ where: { userId: user.id } })).toBe(0);
  });

  it('accepts the bounds exactly', async () => {
    const user = await createUser();
    expect((await createGoal(user, { plannedMinutes: 1 })).status).toBe(201);
    expect((await createGoal(user, { plannedMinutes: 100_000 })).status).toBe(201);
  });
});

describe('PATCH /task-goals/:id — plannedMinutes', () => {
  it('sets, changes and clears a plan', async () => {
    const user = await createUser();
    const goalId = (await createGoal(user, {})).body.data.id as string;

    const set = await authed(user).patch(`/task-goals/${goalId}`).send({ plannedMinutes: 480 });
    expect(set.status).toBe(200);
    expect(set.body.data.plannedMinutes).toBe(480);

    const cleared = await authed(user).patch(`/task-goals/${goalId}`).send({ plannedMinutes: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.plannedMinutes).toBeNull();
  });

  it('leaves the plan alone when the field is not sent', async () => {
    const user = await createUser();
    const goalId = (await createGoal(user, { plannedMinutes: 300 })).body.data.id as string;

    await authed(user).patch(`/task-goals/${goalId}`).send({ title: 'Renamed' });

    expect((await getGoal(user, goalId)).plannedMinutes).toBe(300);
  });

  it('rejects an invalid plan without changing anything', async () => {
    const user = await createUser();
    const goalId = (await createGoal(user, { plannedMinutes: 300 })).body.data.id as string;

    const res = await authed(user).patch(`/task-goals/${goalId}`).send({ plannedMinutes: 0 });

    expect(res.status).toBe(400);
    expect((await getGoal(user, goalId)).plannedMinutes).toBe(300);
  });

  it('never changes completion or task progress', async () => {
    // A plan is a time budget. Completion is about tasks, and stays so.
    const user = await createUser();
    const goalId = (await createGoal(user, {})).body.data.id as string;
    const task = await authed(user).post('/tasks').send({ title: 'Only task', taskGoalId: goalId });
    expect(task.status).toBe(200);
    await authed(user).post('/timer/complete').send({
      completedAt: Date.now(),
      actualElapsedSeconds: 30 * 60,
      plannedDurationSeconds: 30 * 60,
      taskId: task.body.data.id,
    });

    // A plan already "reached" by the 30 minutes logged.
    const res = await authed(user).patch(`/task-goals/${goalId}`).send({ plannedMinutes: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.isCompleted).toBe(false);
    expect(res.body.data.overallProgress).toBe(0);
    expect(res.body.data.linkedTaskCount).toBe(1);
  });

  it('404s on someone else’s goal and leaves it unchanged', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const goalId = (await createGoal(owner, { plannedMinutes: 300 })).body.data.id as string;

    const res = await authed(intruder).patch(`/task-goals/${goalId}`).send({ plannedMinutes: 5 });

    expect(res.status).toBe(404);
    expect((await prisma.taskGoal.findUniqueOrThrow({ where: { id: goalId } })).plannedMinutes).toBe(300);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).patch('/task-goals/anything').send({ plannedMinutes: 60 });
    expect(res.status).toBe(401);
  });
});
