import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { utcDateStr } from '../../lib/localDate';
import { shiftDateKey } from '../../lib/localParts';

/**
 * `GET /time-report`, against the real route and a real database.
 *
 * `lib/timeReport.test.ts` pins the aggregation maths. This covers what only
 * the route can be wrong about: the range filter, ownership, validation, and
 * that the frozen columns survive the trip through Prisma into the response.
 */

const MIN = 60;

// Sessions logged "now" get today's UTC date, since the test client sends no
// localDate. A window either side of today therefore contains all of them.
const TODAY = utcDateStr(new Date());
const FROM = shiftDateKey(TODAY, -3);
const TO = shiftDateKey(TODAY, 3);

async function createGoal(user: TestUser, title: string, deadline?: string) {
  const res = await authed(user).post('/task-goals').send({ title, deadline });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createTask(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/tasks').send(body);
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(user: TestUser, taskId: string | undefined, minutes: number) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: minutes * MIN,
    plannedDurationSeconds: minutes * MIN,
    taskId,
  });
  expect(res.status).toBe(200);
}

async function getReport(user: TestUser, from = FROM, to = TO) {
  const res = await authed(user).get(`/time-report?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('GET /time-report', () => {
  it('groups real sessions by goal, task and tag', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Chemistry Degree');
    const taskA = await createTask(user, {
      title: 'Lab report', tags: ['Chemistry'], taskGoalId: goalId,
    });
    const taskB = await createTask(user, { title: 'Reading', tags: ['Physics'] });

    await logSession(user, taskA, 40);
    await logSession(user, taskB, 20);

    const report = await getReport(user);

    expect(report.totals.seconds).toBe(60 * MIN);
    expect(report.totals.sessions).toBe(2);

    const goal = report.goals.find((g: { goalId: string }) => g.goalId === goalId);
    expect(goal.seconds).toBe(40 * MIN);
    expect(goal.title).toBe('Chemistry Degree');

    expect(report.tasks.map((t: { title: string }) => t.title)).toEqual(['Lab report', 'Reading']);
    expect(report.tags.map((t: { tag: string }) => t.tag).sort()).toEqual(['Chemistry', 'Physics']);
  });

  it('reports the share of time linked to a goal', async () => {
    const user = await createUser();
    const goalId = await createGoal(user, 'Goal');
    const linked = await createTask(user, { title: 'Linked', taskGoalId: goalId });
    const loose = await createTask(user, { title: 'Loose' });

    await logSession(user, linked, 45);
    await logSession(user, loose, 15);

    const report = await getReport(user);
    expect(report.intent.goalLinkedSeconds).toBe(45 * MIN);
    expect(report.intent.goalLinkedShare).toBeCloseTo(0.75, 5);
  });

  it('agrees with the goal progress rollup on how much time a goal has', async () => {
    // Guards against a second, drifting definition of goal time. Three
    // definitions of "completion rate" got into this app the same way.
    const user = await createUser();
    const goalId = await createGoal(user, 'Ship it');
    const taskA = await createTask(user, { title: 'A', taskGoalId: goalId });
    const taskB = await createTask(user, { title: 'B', taskGoalId: goalId });

    await logSession(user, taskA, 20);
    await logSession(user, taskA, 25);
    await logSession(user, taskB, 15);

    const report = await getReport(user);
    const reportGoal = report.goals.find((g: { goalId: string }) => g.goalId === goalId);

    const goalsRes = await authed(user).get('/task-goals');
    const rollup = goalsRes.body.data.find((g: { id: string }) => g.id === goalId);

    expect(reportGoal.seconds).toBe(rollup.totalFocusSeconds);
    expect(reportGoal.sessions).toBe(rollup.actualSessions);
  });

  it('keeps time on an archived task, under its frozen attribution', async () => {
    // The bug the whole feature exists for. The old read-time path lost this.
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Morning revision', tags: ['Physics'] });
    await logSession(user, taskId, 30);
    await prisma.task.update({ where: { id: taskId }, data: { isArchived: true } });

    const report = await getReport(user);
    expect(report.totals.seconds).toBe(30 * MIN);
    expect(report.tags[0].tag).toBe('Physics');
    expect(report.tasks[0].title).toBe('Morning revision');
  });

  it('flags a goal with an imminent deadline and almost no time as starved', async () => {
    const user = await createUser();
    const starvedId = await createGoal(user, 'Due Soon', shiftDateKey(TODAY, 3));
    const fedId = await createGoal(user, 'Getting Time');
    const starvedTask = await createTask(user, { title: 'Neglected', taskGoalId: starvedId });
    const fedTask = await createTask(user, { title: 'Busy', taskGoalId: fedId });

    await logSession(user, starvedTask, 2);
    await logSession(user, fedTask, 120);

    const report = await getReport(user);
    // Starved sorts first — it is the one thing here worth acting on.
    expect(report.goals[0].goalId).toBe(starvedId);
    expect(report.goals[0].status).toBe('starved');
    expect(report.goals.find((g: { goalId: string }) => g.goalId === fedId).status).toBe('fed');
  });

  it('excludes sessions outside the requested range', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task' });
    await logSession(user, taskId, 30);

    const past = shiftDateKey(TODAY, -30);
    const report = await getReport(user, past, shiftDateKey(past, 5));
    expect(report.totals.seconds).toBe(0);
    expect(report.totals.sessions).toBe(0);
  });

  it('compares against the preceding window of the same length', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task' });
    await logSession(user, taskId, 30);

    // A window starting tomorrow puts today's session in the PREVIOUS window.
    const from = shiftDateKey(TODAY, 1);
    const report = await getReport(user, from, shiftDateKey(from, 2));

    expect(report.totals.seconds).toBe(0);
    expect(report.previous.seconds).toBe(30 * MIN);
  });

  it('never includes another user’s sessions', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const taskId = await createTask(owner, { title: 'Private', tags: ['Secret'] });
    await logSession(owner, taskId, 60);

    const report = await getReport(stranger);
    expect(report.totals.seconds).toBe(0);
    expect(report.tags).toEqual([]);
    expect(report.tasks).toEqual([]);
  });

  it('distinguishes "no work" from "backfill has not run"', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Task' });
    await logSession(user, taskId, 30);
    // Simulate a pre-migration row: stamped columns cleared.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { localDate: null } });

    const report = await getReport(user);
    expect(report.totals.sessions).toBe(0);
    expect(report.unstampedSessions).toBe(1);
  });

  it('rejects an inverted range', async () => {
    const user = await createUser();
    const res = await authed(user).get(`/time-report?from=${TO}&to=${FROM}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed date', async () => {
    const user = await createUser();
    const res = await authed(user).get('/time-report?from=last-tuesday&to=2026-08-31');
    expect(res.status).toBe(400);
  });

  it('rejects a range longer than two years', async () => {
    const user = await createUser();
    const res = await authed(user).get(`/time-report?from=2020-01-01&to=${TO}`);
    expect(res.status).toBe(400);
  });

  it('401s without a token', async () => {
    const user = await createUser();
    const res = await authed({ ...user, accessToken: 'nope' }).get(`/time-report?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(401);
  });
});
