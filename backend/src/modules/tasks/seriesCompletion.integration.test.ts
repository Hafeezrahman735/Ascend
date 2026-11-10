import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Completing a recurring series, and the missed-day figures
 * (docs/designs/tasks-recurring-blocks-sessions.md, test cases R1, R6, R6b,
 * R6c, R9), against a real database.
 *
 * A series can be completed only once no scheduled day is left. Completing it
 * pays nothing (each day was paid when ticked), closes it to ticks, and can be
 * undone. Every request sends the client's local day, as the app does.
 */

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Local date N days from today, 'YYYY-MM-DD'. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayNameOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return DAY_NAMES[d.getDay()];
}

const today = () => dayOffset(0);
const q = () => `localDate=${encodeURIComponent(today())}`;

async function makeHabit(
  user: TestUser,
  opts: { endsOn?: string | null; recurringDays?: string[]; createdOn?: string } = {},
) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Read for 20 minutes',
      priority: 'medium',
      isRecurring: true,
      recurringDays: opts.recurringDays ?? [],
      dueDate: opts.endsOn ? new Date(`${opts.endsOn}T00:00:00.000Z`) : null,
      createdAt: opts.createdOn
        ? new Date(`${opts.createdOn}T12:00:00.000Z`)
        : new Date(Date.now() - 30 * 86_400_000),
    },
  });
}

const patch = (user: TestUser, id: string, body: object) =>
  authed(user).patch(`/tasks/${id}?${q()}`).send(body);

async function userStats(user: TestUser) {
  return prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { xp: true, tasksCompleted: true } });
}

async function recurringRow(user: TestUser, id: string) {
  const res = await authed(user).get(`/tasks/recurring?${q()}`);
  expect(res.status).toBe(200);
  return res.body.data.find((t: { id: string }) => t.id === id);
}

describe('PATCH /tasks/:id — completing a recurring series', () => {
  it('R6: completes an ended series without paying XP, and reopens it', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, { endsOn: dayOffset(-3) });
    const before = await userStats(user);

    const done = await patch(user, habit.id, { isCompleted: true });
    expect(done.status).toBe(200);
    expect(done.body.data.isCompleted).toBe(true);
    expect(done.body.data.completedAt).not.toBeNull();
    expect(done.body.reward).toBeNull();
    expect(await userStats(user)).toEqual(before);

    const row = await recurringRow(user, habit.id);
    expect(row).toMatchObject({ isCompleted: true, seriesFinished: true, yesterdayOpen: false });

    const reopened = await patch(user, habit.id, { isCompleted: false });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.isCompleted).toBe(false);
    expect(reopened.body.data.completedAt).toBeNull();
    expect(await userStats(user)).toEqual(before);
  });

  it('R6b: completes a series whose end comes before its next scheduled day', async () => {
    const user = await createUser();
    // Scheduled only three days from now, but ending in two.
    const habit = await makeHabit(user, { recurringDays: [dayNameOffset(3)], endsOn: dayOffset(2) });

    const res = await patch(user, habit.id, { isCompleted: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isCompleted).toBe(true);
  });

  it('R6c: refuses to complete a series that still has scheduled days', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, { endsOn: null });

    const res = await patch(user, habit.id, { isCompleted: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('End the series first');
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: habit.id } });
    expect(stored.isCompleted).toBe(false);
  });

  it("returns 404 for another user's series", async () => {
    const owner = await createUser();
    const other = await createUser();
    const habit = await makeHabit(owner, { endsOn: dayOffset(-3) });

    const res = await patch(other, habit.id, { isCompleted: true });

    expect(res.status).toBe(404);
  });
});

describe('PUT /tasks/:id/completions/:date — a completed or ended series', () => {
  it('refuses ticks on a completed series until it is reopened', async () => {
    const user = await createUser();
    // Ended today, so today could still be ticked if the series were open.
    const habit = await makeHabit(user, { endsOn: dayOffset(-1) });
    await patch(user, habit.id, { isCompleted: true });

    const blocked = await authed(user).put(`/tasks/${habit.id}/completions/${dayOffset(-1)}`).send({ localDate: today() });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('This series is completed');

    await patch(user, habit.id, { isCompleted: false });
    const allowed = await authed(user).put(`/tasks/${habit.id}/completions/${dayOffset(-1)}`).send({ localDate: today() });
    expect(allowed.status).toBe(200);
  });

  it('refuses a tick on a day after the series ends', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, { endsOn: dayOffset(-2) });

    const res = await authed(user).put(`/tasks/${habit.id}/completions/${dayOffset(-1)}`).send({ localDate: today() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Date is after the task stops repeating');
  });
});

describe('GET /tasks/recurring — missed days', () => {
  it('R1/R9: counts from the creation day to the day before yesterday', async () => {
    const user = await createUser();
    // Daily, created five days ago. Done five and three days ago; yesterday is open.
    const habit = await makeHabit(user, { createdOn: dayOffset(-5) });
    await prisma.recurringCompletion.createMany({
      data: [dayOffset(-5), dayOffset(-3)].map((date) => ({ userId: user.id, taskId: habit.id, date })),
    });

    const row = await recurringRow(user, habit.id);

    // Window: -5 .. -2 = 4 scheduled days, 2 done.
    expect(row).toMatchObject({
      scheduledDays: 4,
      doneOnSchedule: 2,
      missedDays: 2,
      totalCompletions: 2,
      yesterdayOpen: true,
      seriesFinished: false,
    });
  });

  it('leaves a completed series off the day list', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, { endsOn: dayOffset(-3) });
    await patch(user, habit.id, { isCompleted: true });

    const res = await authed(user).get(`/tasks?${q()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some((t: { id: string }) => t.id === habit.id)).toBe(false);
  });
});
