import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * `GET /tasks/:id` analytics, against the real route and a real database.
 *
 * The unit suite in `lib/taskAnalytics.test.ts` pins the arithmetic. This file
 * covers what only the route can be wrong about: the `type: 'focus'` filter,
 * the `?tz=` query parameter, ownership, and the fact that the numbers survive
 * the trip through Prisma at all.
 */

const MIN = 60;

async function createTask(user: TestUser, title: string, estimatedMinutes?: number) {
  const res = await authed(user).post('/tasks').send({ title, estimatedMinutes });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

/**
 * A real session through the real timer route. Bounded by the route's own
 * rules: it credits at most the planned length, and refuses anything backdated
 * more than 24 hours — which is why the multi-day fixtures below are inserted
 * directly instead.
 */
async function logSession(user: TestUser, taskId: string, minutes: number, plannedMinutes = minutes) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: minutes * MIN,
    plannedDurationSeconds: plannedMinutes * MIN,
    taskId,
  });
  expect(res.status).toBe(200);
}

/** A session row at an arbitrary instant or type, for cases the route forbids. */
async function insertSession(
  user: TestUser,
  taskId: string,
  opts: { at: Date; minutes: number; type?: string; plannedMinutes?: number },
) {
  await prisma.session.create({
    data: {
      userId: user.id,
      taskId,
      type: opts.type ?? 'focus',
      durationSeconds: opts.minutes * MIN,
      plannedDurationSeconds: (opts.plannedMinutes ?? opts.minutes) * MIN,
      completedAt: opts.at,
    },
  });
}

async function getAnalytics(user: TestUser, taskId: string, tz?: string) {
  const url = tz ? `/tasks/${taskId}?tz=${encodeURIComponent(tz)}` : `/tasks/${taskId}`;
  const res = await authed(user).get(url);
  expect(res.status).toBe(200);
  return res.body.data.analytics;
}

describe('GET /tasks/:id analytics', () => {
  it('totals real sessions logged through the timer', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Thermodynamics problem set', 60);

    await logSession(user, taskId, 25);
    await logSession(user, taskId, 20);

    const a = await getAnalytics(user, taskId);

    expect(a.sessionCount).toBe(2);
    expect(a.totalTimeAllTime).toBe(45 * MIN);
    expect(a.avgSessionLength).toBe(Math.round((45 * MIN) / 2));
    expect(a.daysWorked).toBe(1);
    expect(a.lastSessionAt).not.toBeNull();
  });

  it('does not report a task that ran over its estimate as more than 100% accurate', async () => {
    const user = await createUser();
    // 10-minute estimate, 40 minutes actually spent — a 4x overrun.
    const taskId = await createTask(user, 'Underestimated task', 10);
    await logSession(user, taskId, 20);
    await logSession(user, taskId, 20);

    const a = await getAnalytics(user, taskId);

    // The field used to be actual/estimate*100 and would have returned 400 here.
    expect(a.estimateUsedPct).toBe(400);
    expect(a.estimationAccuracy).toBe(0);
    expect(a.estimationAccuracy).toBeLessThanOrEqual(100);
    expect(a.estimateDeltaSeconds).toBe(30 * MIN);
  });

  it('leaves the estimate figures null when the task has no estimate', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'No estimate');
    await logSession(user, taskId, 25);

    const a = await getAnalytics(user, taskId);
    expect(a.estimationAccuracy).toBeNull();
    expect(a.estimateUsedPct).toBeNull();
    expect(a.estimateDeltaSeconds).toBeNull();
  });

  it('buckets the peak hour in the requested timezone', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Timezone task');
    await logSession(user, taskId, 25);

    const utc = await getAnalytics(user, taskId, 'UTC');
    const tokyo = await getAnalytics(user, taskId, 'Asia/Tokyo');

    // Tokyo is UTC+9 with no DST, so the same instant is always nine hours on.
    expect(tokyo.mostProductiveHour.hour).toBe((utc.mostProductiveHour.hour + 9) % 24);
  });

  it('falls back to UTC instead of failing when the timezone is garbage', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Bad tz');
    await logSession(user, taskId, 25);

    const bogus = await getAnalytics(user, taskId, 'Mars/Olympus_Mons');
    const utc = await getAnalytics(user, taskId, 'UTC');

    expect(bogus.mostProductiveHour.hour).toBe(utc.mostProductiveHour.hour);
  });

  it('excludes sessions that are not focus time', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Task with a break logged against it');

    await logSession(user, taskId, 25);
    // The timer only ever writes 'focus' today, so this row is what a future
    // break-tracking change would produce. It must not count as focus time.
    await insertSession(user, taskId, { at: new Date(), minutes: 10, type: 'break' });

    const a = await getAnalytics(user, taskId);
    expect(a.sessionCount).toBe(1);
    expect(a.totalTimeAllTime).toBe(25 * MIN);
  });

  it('counts distinct days worked rather than sessions', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Spread over days');

    const day = 86_400_000;
    const now = Date.now();
    // Two sessions today and one three days ago: three sessions, two days.
    await insertSession(user, taskId, { at: new Date(now), minutes: 25 });
    await insertSession(user, taskId, { at: new Date(now - 60_000), minutes: 25 });
    await insertSession(user, taskId, { at: new Date(now - 3 * day), minutes: 25 });

    const a = await getAnalytics(user, taskId, 'UTC');
    expect(a.sessionCount).toBe(3);
    expect(a.daysWorked).toBe(2);
    expect(a.consistency).toBeGreaterThan(0);
    expect(a.consistency).toBeLessThanOrEqual(1);
  });

  it('reports zeroes rather than nulls or NaN for a task never worked', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Never started');

    const a = await getAnalytics(user, taskId);
    expect(a.sessionCount).toBe(0);
    expect(a.totalTimeAllTime).toBe(0);
    expect(a.avgSessionLength).toBe(0);
    expect(a.fullSessionRate).toBe(0);
    expect(a.mostProductiveHour).toBeNull();
    expect(a.lastSessionAt).toBeNull();
    expect(a.consistency).toBeNull();
    expect(a.timePerDayLast7).toHaveLength(7);
  });

  it('keeps completionRate as an alias so older app builds still render a number', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Alias check');
    await logSession(user, taskId, 25);

    const a = await getAnalytics(user, taskId);
    expect(a.completionRate).toBe(a.fullSessionRate);
  });

  it('404s on another user’s task rather than serving its analytics', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const taskId = await createTask(owner, 'Private task', 60);
    await logSession(owner, taskId, 25);

    const res = await authed(stranger).get(`/tasks/${taskId}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('401s without a token', async () => {
    const owner = await createUser();
    const taskId = await createTask(owner, 'Private task');

    const res = await authed({ ...owner, accessToken: 'not-a-token' }).get(`/tasks/${taskId}`);
    expect(res.status).toBe(401);
  });
});
