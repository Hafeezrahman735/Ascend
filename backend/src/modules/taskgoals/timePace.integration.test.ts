import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { shiftDateKey } from '../../lib/localParts';
import { utcDateStr } from '../../lib/localDate';

/**
 * `timePace` on goal responses: planned focus time against an even schedule
 * (lib/timePace.ts), computed in the caller's zone from the goal's current
 * focus time. Run in UTC so "today" and the goal's start day are fixed.
 */

const MIN = 60;
const TODAY = utcDateStr(new Date());

async function createGoal(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/task-goals?tz=UTC').send({ title: 'Ship it', ...body });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function logOn(user: TestUser, goalId: string, minutes: number) {
  const task = await authed(user).post('/tasks').send({ title: `Work ${minutes}`, taskGoalId: goalId });
  expect(task.status).toBe(200);
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: minutes * MIN,
    plannedDurationSeconds: minutes * MIN,
    taskId: task.body.data.id,
  });
  expect(res.status).toBe(200);
}

async function paceOf(user: TestUser, goalId: string, tz = 'UTC') {
  const res = await authed(user).get(`/task-goals?tz=${encodeURIComponent(tz)}`);
  expect(res.status).toBe(200);
  return res.body.data.find((g: { id: string }) => g.id === goalId).timePace;
}

describe('GET /task-goals — timePace', () => {
  // A 10h plan over 10 days starting today: the even schedule expects 1h today.

  it('is behind with nothing logged, and says how much a day finishes it', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, 9) });

    expect(await paceOf(user, goalId)).toEqual({
      status: 'behind',
      remainingSeconds: 600 * MIN,
      expectedSeconds: 60 * MIN,
      deltaSeconds: -60 * MIN,
      perDayToFinishSeconds: 60 * MIN,
    });
  });

  it('is ahead once more than the schedule plus tolerance is logged', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, 9) });
    await logOn(user, goalId, 120);

    const pace = await paceOf(user, goalId);
    expect(pace.status).toBe('ahead');
    expect(pace.deltaSeconds).toBe(60 * MIN);
    expect(pace.perDayToFinishSeconds).toBeNull();
  });

  it('is reached when the plan is met, and completion stays task-based', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 10, deadline: shiftDateKey(TODAY, 9) });
    await logOn(user, goalId, 30);

    const res = await authed(user).get('/task-goals?tz=UTC');
    const goal = res.body.data.find((g: { id: string }) => g.id === goalId);
    expect(goal.timePace.status).toBe('reached');
    expect(goal.timePace.remainingSeconds).toBe(0);
    expect(goal.isCompleted).toBe(false);
  });

  it('is past_due after the deadline, no_deadline without one, no_plan without a plan', async () => {
    const user = await createUser();
    const pastDue = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, -1) });
    const open = await createGoal(user, { plannedMinutes: 600 });
    const unplanned = await createGoal(user, { deadline: shiftDateKey(TODAY, 9) });

    expect((await paceOf(user, pastDue)).status).toBe('past_due');
    expect((await paceOf(user, open)).status).toBe('no_deadline');
    expect(await paceOf(user, unplanned)).toEqual({
      status: 'no_plan', remainingSeconds: null,
      expectedSeconds: null, deltaSeconds: null, perDayToFinishSeconds: null,
    });
  });

  it('is completed for a finished goal, whatever the time says', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, 9) });

    const res = await authed(user).patch(`/task-goals/${goalId}?tz=UTC`).send({ isCompleted: true });

    expect(res.status).toBe(200);
    expect(res.body.data.timePace.status).toBe('completed');
  });

  it('follows the goal’s current focus time when a task moves away', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, 9) });
    const other = await createGoal(user, {});
    await logOn(user, goalId, 120);
    const goals = await authed(user).get('/task-goals?tz=UTC');
    const taskIds = (await authed(user).get('/tasks')).body.data.map((t: { id: string }) => t.id);
    expect(goals.status).toBe(200);

    await authed(user).post(`/task-goals/${other}/tasks`).send({ link: taskIds });

    expect((await paceOf(user, goalId)).status).toBe('behind');
  });

  it('falls back to UTC for a missing or unknown zone rather than failing', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, { plannedMinutes: 600, deadline: shiftDateKey(TODAY, 9) });

    expect((await paceOf(user, goalId, 'Not/AZone')).status).toBe('behind');
    const res = await authed(user).get('/task-goals');
    expect(res.status).toBe(200);
    expect(res.body.data[0].timePace).toBeDefined();
  });
});
