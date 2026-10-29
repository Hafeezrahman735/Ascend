import { describe, it, expect, vi } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { dayNameFromLocalDate } from '../../lib/localDate';

/**
 * Recurring tasks as one row plus a completion log, seen through the read
 * routes (recurring-tasks T4).
 *
 * There are no daily copies any more. GET /tasks shows a recurring task as
 * today's row — its own id, today's done state and today's focus — on the days
 * it is due, and the streaks are calculated from the log, so they cannot drift
 * from what was actually ticked off.
 */

function utcDayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = utcDayOffset(0);
const YESTERDAY = utcDayOffset(-1);
const TOMORROW = utcDayOffset(1);

/** A habit created `daysAgo` days back, every day unless told otherwise. */
async function makeHabit(user: TestUser, { daysAgo = 10, recurringDays = [] as string[] } = {}) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Stretch',
      isRecurring: true,
      recurringDays,
      estimatedMinutes: 30,
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    },
  });
}

async function logDays(user: TestUser, taskId: string, offsets: number[]) {
  await prisma.recurringCompletion.createMany({
    data: offsets.map((o) => ({ userId: user.id, taskId, date: utcDayOffset(o) })),
  });
}

async function focus(user: TestUser, taskId: string, localDate: string, minutes: number) {
  await prisma.session.create({
    data: {
      userId: user.id, taskId, type: 'focus', durationSeconds: minutes * 60,
      completedAt: new Date(`${localDate}T12:00:00.000Z`), localDate,
    },
  });
}

async function list(user: TestUser) {
  const res = await authed(user).get(`/tasks?localDate=${TODAY}`);
  expect(res.status).toBe(200);
  return res.body.data as Array<Record<string, unknown>>;
}

describe('GET /tasks — today rows', () => {
  it("shows a due recurring task as today's row, with today's state and focus", async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await logDays(user, habit.id, [-2, -1, 0]);
    await focus(user, habit.id, TODAY, 20);
    await focus(user, habit.id, YESTERDAY, 40);

    const [row] = await list(user);

    expect(row).toMatchObject({
      id: habit.id,
      isRecurring: true,
      isOccurrence: true,
      occurrenceDate: TODAY,
      dueDate: `${TODAY}T00:00:00.000Z`,
      repeatsUntil: null,
      isCompleted: true,
      // Today's figures, so the row's progress bar means today.
      sessionsOnTask: 1,
      totalTimeOnTask: 20 * 60,
      currentStreak: 3,
      totalCompletions: 3,
      totalFocusSeconds: 60 * 60,
    });
  });

  it('shows it open until it is ticked off, without breaking the streak', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await logDays(user, habit.id, [-2, -1]);

    const [row] = await list(user);

    expect(row.isCompleted).toBe(false);
    expect(row.currentStreak).toBe(2);
  });

  it('leaves it out on a day it is not scheduled', async () => {
    const user = await createUser();
    await makeHabit(user, { recurringDays: [dayNameFromLocalDate(TOMORROW)] });

    expect(await list(user)).toEqual([]);
  });

  it('lists a one-off task switched to recurring straight away', async () => {
    // Under the copy model this needed a spawn, and one never came for a task
    // switched on an unscheduled day. There is nothing to spawn now.
    const user = await createUser();
    const created = await authed(user).post('/tasks').send({ title: 'Journal' });
    const res = await authed(user).patch(`/tasks/${created.body.data.id}`).send({ isRecurring: true, recurringDays: [] });
    expect(res.status).toBe(200);

    const rows = await list(user);
    expect(rows.map((r) => [r.id, r.isOccurrence])).toEqual([[created.body.data.id, true]]);
  });
});

describe('GET /tasks/recurring and GET /tasks/:id — streaks from the log', () => {
  it('breaks the streak on a missed due day and keeps the longest', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await logDays(user, habit.id, [-6, -5, -4, -2, -1]); // -3 missed

    const recurring = await authed(user).get(`/tasks/recurring?localDate=${TODAY}`);
    expect(recurring.status).toBe(200);
    expect(recurring.body.data[0]).toMatchObject({
      id: habit.id,
      scheduledToday: true,
      completedToday: false,
      currentStreak: 2,
      longestStreak: 3,
      totalCompletions: 5,
    });

    const detail = await authed(user).get(`/tasks/${habit.id}?localDate=${TODAY}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ currentStreak: 2, longestStreak: 3, totalCompletions: 5 });
  });

  it('skips days the task is not scheduled on', async () => {
    const user = await createUser();
    // Due only on the weekdays of yesterday and three days ago.
    const days = [dayNameFromLocalDate(YESTERDAY), dayNameFromLocalDate(utcDayOffset(-3))];
    const habit = await makeHabit(user, { recurringDays: days, daysAgo: 4 });
    await logDays(user, habit.id, [-3, -1]);

    const res = await authed(user).get(`/tasks/recurring?localDate=${TODAY}`);

    expect(res.body.data[0].currentStreak).toBe(2);
  });
});

describe('PATCH /tasks/:id — a recurring task', () => {
  it('rejects ticking it off directly, which would bypass the log', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    const res = await authed(user).patch(`/tasks/${habit.id}`).send({ isCompleted: true });

    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xp).toBe(0);
  });

  it('accepts an edit that re-sends the unchanged isCompleted', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    const res = await authed(user).patch(`/tasks/${habit.id}`).send({ title: 'Stretch well', isCompleted: false });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Stretch well');
  });
});

describe('DELETE /tasks/:id — a recurring task', () => {
  it('removes it from both lists and keeps its log and focus time', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await logDays(user, habit.id, [-1]);
    await focus(user, habit.id, YESTERDAY, 25);

    const res = await authed(user).delete(`/tasks/${habit.id}`);

    expect(res.status).toBe(200);
    expect(await list(user)).toEqual([]);
    const recurring = await authed(user).get(`/tasks/recurring?localDate=${TODAY}`);
    expect(recurring.body.data).toEqual([]);
    expect(await prisma.recurringCompletion.count({ where: { taskId: habit.id } })).toBe(1);
    expect(await prisma.session.count({ where: { taskId: habit.id } })).toBe(1);
  });
});

describe('PUT completion, then GET /tasks', () => {
  it("shows the tick on today's row", async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    await authed(user).put(`/tasks/${habit.id}/completions/${TODAY}`).send({ localDate: TODAY });

    const [row] = await list(user);
    expect(row.isCompleted).toBe(true);
    expect(row.completedAt).not.toBeNull();
    await vi.waitFor(async () => {
      expect(await prisma.feedEvent.count({ where: { userId: user.id } })).toBe(1);
    });
  });
});
