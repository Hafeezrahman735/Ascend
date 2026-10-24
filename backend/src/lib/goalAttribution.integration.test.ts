import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { shiftDateKey } from './localParts';
import { utcDateStr } from './localDate';
import { loadCurrentGoals, SESSION_GOAL_EXPR, SESSION_GOAL_JOIN } from './goalAttribution';
import { backfillHabitGoalLinks } from './backfillHabitGoalLinks';

/**
 * Goal time follows a task's CURRENT goal (owner decision, 2026-10-23).
 *
 * Every goal-level number (GET /task-goals totals, the time report's goal
 * rows and goal-linked share) must move when a task is linked, moved or
 * unlinked, while overall totals and the session rows themselves never change.
 */

const MIN = 60;
const TODAY = utcDateStr(new Date());
const RANGE = `from=${shiftDateKey(TODAY, -3)}&to=${shiftDateKey(TODAY, 3)}`;
const EVERY_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function createGoal(user: TestUser, title: string) {
  const res = await authed(user).post('/task-goals').send({ title });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createTask(user: TestUser, title: string, taskGoalId?: string) {
  const res = await authed(user).post('/tasks').send({ title, taskGoalId });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(user: TestUser, taskId: string | null, minutes: number) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: minutes * MIN,
    plannedDurationSeconds: minutes * MIN,
    taskId,
  });
  expect(res.status).toBe(200);
}

async function goalSeconds(user: TestUser, goalId: string): Promise<number> {
  const res = await authed(user).get('/task-goals');
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId)?.totalFocusSeconds ?? 0;
}

async function report(user: TestUser) {
  const res = await authed(user).get(`/time-report?${RANGE}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

function reportGoalSeconds(r: { goals: { goalId: string; seconds: number }[] }, goalId: string): number {
  return r.goals.find((g) => g.goalId === goalId)?.seconds ?? 0;
}

async function link(user: TestUser, goalId: string, taskId: string) {
  const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [taskId] });
  expect(res.status).toBe(200);
}

describe('goal time follows the task’s current goal', () => {
  it('brings an already-worked task’s past time when it is linked', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Launch');
    const taskId = await createTask(user, 'Worked before linking');
    await logSession(user, taskId, 40);

    expect(await goalSeconds(user, goalId)).toBe(0);
    await link(user, goalId, taskId);

    expect(await goalSeconds(user, goalId)).toBe(40 * MIN);
    expect(reportGoalSeconds(await report(user), goalId)).toBe(40 * MIN);
  });

  it('moves all of a task’s time from goal A to goal B, and the total stays put', async () => {
    const user = await createUser();
    const a = await createGoal(user, 'A');
    const b = await createGoal(user, 'B');
    const taskId = await createTask(user, 'Mover', a);
    await logSession(user, taskId, 30);
    await logSession(user, taskId, 20);
    const before = (await report(user)).totals.seconds;

    await link(user, b, taskId);

    expect(await goalSeconds(user, a)).toBe(0);
    expect(await goalSeconds(user, b)).toBe(50 * MIN);
    const after = await report(user);
    expect(reportGoalSeconds(after, a)).toBe(0);
    expect(reportGoalSeconds(after, b)).toBe(50 * MIN);
    expect(after.totals.seconds).toBe(before);
  });

  it('takes a task’s time off the goal when it is unlinked, keeping it in the total', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Goal');
    const taskId = await createTask(user, 'Leaving', goalId);
    await logSession(user, taskId, 25);

    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ unlink: [taskId] });
    expect(res.status).toBe(200);

    expect(await goalSeconds(user, goalId)).toBe(0);
    const r = await report(user);
    expect(reportGoalSeconds(r, goalId)).toBe(0);
    expect(r.intent.unlinkedSeconds).toBe(25 * MIN);
    expect(r.totals.seconds).toBe(25 * MIN);
  });

  it('moves a habit’s whole history, including archived days with a stale goal', async () => {
    const user = await createUser();
    const a = await createGoal(user, 'A');
    const b = await createGoal(user, 'B');
    const created = await authed(user).post('/tasks')
      .send({ title: 'Daily', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY, taskGoalId: a });
    const templateId = created.body.data.id as string;
    const instance = await prisma.task.findFirstOrThrow({ where: { parentTaskId: templateId, isArchived: false } });
    await logSession(user, instance.id, 30);
    // Yesterday's day: archived, spawned under goal A, and never relinked.
    const archived = await prisma.task.create({
      data: { userId: user.id, title: 'Daily', parentTaskId: templateId, taskGoalId: a, isArchived: true },
    });
    await logSession(user, archived.id, 15);

    await link(user, b, instance.id);

    expect(await goalSeconds(user, a)).toBe(0);
    expect(await goalSeconds(user, b)).toBe(45 * MIN);
    expect(reportGoalSeconds(await report(user), b)).toBe(45 * MIN);
  });

  it('keeps a deleted task’s time on its goal: deleting a task keeps its link', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Goal');
    const taskId = await createTask(user, 'Done and deleted', goalId);
    await logSession(user, taskId, 20);

    expect((await authed(user).delete(`/tasks/${taskId}`)).status).toBe(200);

    expect(await goalSeconds(user, goalId)).toBe(20 * MIN);
    expect(reportGoalSeconds(await report(user), goalId)).toBe(20 * MIN);
  });

  it('turns a deleted goal’s time into not linked, with the total unchanged', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Abandoned');
    const taskId = await createTask(user, 'Its task', goalId);
    await logSession(user, taskId, 35);

    expect((await authed(user).delete(`/task-goals/${goalId}`)).status).toBe(200);

    const r = await report(user);
    expect(r.goals.find((g: { goalId: string }) => g.goalId === goalId)).toBeUndefined();
    expect(r.intent.goalLinkedSeconds).toBe(0);
    expect(r.intent.unlinkedSeconds).toBe(35 * MIN);
    expect(r.totals.seconds).toBe(35 * MIN);
  });

  it('never credits free timer time to a goal', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Goal');
    await logSession(user, null, 30);

    expect(await goalSeconds(user, goalId)).toBe(0);
    expect((await report(user)).intent.unlinkedSeconds).toBe(30 * MIN);
  });

  it('agrees with /task-goals for every goal after a relink', async () => {
    const user = await createUser();
    const a = await createGoal(user, 'A');
    const b = await createGoal(user, 'B');
    const t1 = await createTask(user, 'One', a);
    const t2 = await createTask(user, 'Two', a);
    await logSession(user, t1, 10);
    await logSession(user, t2, 25);
    await link(user, b, t2);

    const r = await report(user);
    for (const goalId of [a, b]) {
      expect(reportGoalSeconds(r, goalId)).toBe(await goalSeconds(user, goalId));
    }
  });

  it('never edits the sessions themselves', async () => {
    const user = await createUser();
    const a = await createGoal(user, 'A');
    const b = await createGoal(user, 'B');
    const taskId = await createTask(user, 'Mover', a);
    await logSession(user, taskId, 30);
    const before = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });

    await link(user, b, taskId);

    const after = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
    // The frozen stamp still says A: it is history, not the current attribution.
    expect(after[0].taskGoalId).toBe(a);
  });
});

describe('the SQL and JS forms of the rule agree', () => {
  it('resolves the same goal for plain tasks, habit instances and free sessions', async () => {
    const user = await createUser();
    const a = await createGoal(user, 'A');
    const b = await createGoal(user, 'B');
    const plain = await createTask(user, 'Plain', a);
    const created = await authed(user).post('/tasks')
      .send({ title: 'Habit', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY, taskGoalId: b });
    const instance = await prisma.task.findFirstOrThrow({ where: { parentTaskId: created.body.data.id, isArchived: false } });
    const stale = await prisma.task.create({
      data: { userId: user.id, title: 'Habit', parentTaskId: created.body.data.id, taskGoalId: a, isArchived: true },
    });
    await logSession(user, plain, 5);
    await logSession(user, instance.id, 5);
    await logSession(user, stale.id, 5);
    await logSession(user, null, 5);

    const sql = await prisma.$queryRaw<{ id: string; task_id: string | null; goal_id: string | null }[]>`
      SELECT s.id, s.task_id, ${SESSION_GOAL_EXPR} AS goal_id
      FROM sessions s ${SESSION_GOAL_JOIN}
      WHERE s.user_id = ${user.id}::uuid`;
    const js = await loadCurrentGoals(user.id, sql.map((r) => r.task_id).filter((t): t is string => !!t));

    expect(sql).toHaveLength(4);
    for (const row of sql) {
      expect(row.goal_id).toBe(row.task_id ? js.get(row.task_id) ?? null : null);
    }
    expect(new Set(sql.map((r) => r.goal_id))).toEqual(new Set([a, b, null]));
    expect(sql.filter((r) => r.goal_id === b)).toHaveLength(2);
  });
});

describe('backfillHabitGoalLinks', () => {
  it('gives an unlinked template the goal of its live instance, and nothing on a dry run', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Fitness');
    const created = await authed(user).post('/tasks')
      .send({ title: 'Run', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY });
    const templateId = created.body.data.id as string;
    // The pre-fix shape: only today's instance carries the goal.
    await prisma.task.updateMany({ where: { parentTaskId: templateId, isArchived: false }, data: { taskGoalId: goalId } });

    const dry = await backfillHabitGoalLinks({ dryRun: true });
    expect(dry).toEqual({ scanned: 1, linked: 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: templateId } })).taskGoalId).toBeNull();

    const real = await backfillHabitGoalLinks({ dryRun: false });
    expect(real.linked).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: templateId } })).taskGoalId).toBe(goalId);
  });

  it('leaves a genuinely unlinked habit alone, and ignores an archived goal', async () => {
    const user = await createUser();
    const archivedGoal = await createGoal(user, 'Old');
    await authed(user).post('/tasks').send({ title: 'Free habit', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY });
    const second = await authed(user).post('/tasks')
      .send({ title: 'Stale', isRecurring: true, recurringDays: EVERY_DAY, localDate: TODAY });
    await prisma.task.updateMany({ where: { parentTaskId: second.body.data.id, isArchived: false }, data: { taskGoalId: archivedGoal } });
    await prisma.taskGoal.update({ where: { id: archivedGoal }, data: { isArchived: true } });

    const result = await backfillHabitGoalLinks({ dryRun: false });

    expect(result).toEqual({ scanned: 2, linked: 0 });
  });
});
