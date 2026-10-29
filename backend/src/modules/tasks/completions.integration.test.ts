import { describe, it, expect, vi } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { taskCompletionXP } from '../../lib/xp';
import { dayNameFromLocalDate } from '../../lib/localDate';

/**
 * PUT / DELETE /tasks/:id/completions/:date — ticking off a recurring task.
 *
 * The completion log replaces the daily copies (recurring-tasks T2). What has
 * to hold, against a real database:
 *
 *  - a day pays XP once and revokes it once, however often it is repeated or
 *    however many devices send it at the same moment;
 *  - "not yours", "not recurring", "deleted" and "unknown" all look the same;
 *  - only a scheduled day, today or yesterday, inside the task's life, counts;
 *  - while copies exist, the day's copy follows the log, so goal progress
 *    (still read from the copies) moves with it.
 */

function utcDayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = utcDayOffset(0);
const YESTERDAY = utcDayOffset(-1);
const XP = taskCompletionXP('medium');

/** A habit running for a month, every day unless told otherwise. */
async function makeHabit(
  user: TestUser,
  overrides: { recurringDays?: string[]; endsOn?: string; createdAt?: Date; taskGoalId?: string } = {},
) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Read for 20 minutes',
      priority: 'medium',
      isRecurring: true,
      recurringDays: overrides.recurringDays ?? [],
      dueDate: overrides.endsOn ? new Date(`${overrides.endsOn}T00:00:00.000Z`) : null,
      createdAt: overrides.createdAt ?? new Date(Date.now() - 30 * 86_400_000),
      taskGoalId: overrides.taskGoalId,
    },
  });
}

const put = (user: TestUser, taskId: string, date: string) =>
  authed(user).put(`/tasks/${taskId}/completions/${date}`).send({ localDate: TODAY });

const del = (user: TestUser, taskId: string, date: string) =>
  authed(user).delete(`/tasks/${taskId}/completions/${date}`).send({ localDate: TODAY });

async function userStats(user: TestUser) {
  return prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { xp: true, tasksCompleted: true },
  });
}

const logRows = (taskId: string) => prisma.recurringCompletion.count({ where: { taskId } });

/**
 * The activity log is written by a fire-and-forget listener; waiting for it
 * keeps that write from racing the next test's table clear.
 */
async function waitForFeed(user: TestUser, eventType: string, count: number) {
  await vi.waitFor(async () => {
    expect(await prisma.feedEvent.count({ where: { userId: user.id, eventType } })).toBe(count);
  });
}

describe('PUT /tasks/:id/completions/:date', () => {
  it('logs the day and pays XP once, and a repeat changes nothing', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    const first = await put(user, habit.id, TODAY);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ taskId: habit.id, date: TODAY, done: true, changed: true });
    expect(first.body.reward.xpEarned).toBe(XP);

    const repeat = await put(user, habit.id, TODAY);
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.changed).toBe(false);
    expect(repeat.body.reward).toBeNull();

    expect(await logRows(habit.id)).toBe(1);
    expect(await userStats(user)).toEqual({ xp: XP, tasksCompleted: 1 });
    await waitForFeed(user, 'task_completed', 1);
  });

  it('accepts yesterday, the one day of back-dating allowed', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    const res = await put(user, habit.id, YESTERDAY);

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    await waitForFeed(user, 'task_completed', 1);
  });

  it('pays once when two devices tick the same day at the same moment', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    const results = await Promise.all([put(user, habit.id, TODAY), put(user, habit.id, TODAY)]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.filter((r) => r.body.data.changed)).toHaveLength(1);
    expect(await logRows(habit.id)).toBe(1);
    expect(await userStats(user)).toEqual({ xp: XP, tasksCompleted: 1 });
    await waitForFeed(user, 'task_completed', 1);
  });

  it("marks the day's copy done, so an older build shows the tick", async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    const copy = await prisma.task.create({
      data: { userId: user.id, title: habit.title, parentTaskId: habit.id, dueDate: new Date(TODAY) },
    });

    await put(user, habit.id, TODAY);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: copy.id } })).isCompleted).toBe(true);

    await del(user, habit.id, TODAY);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: copy.id } })).isCompleted).toBe(false);
    await waitForFeed(user, 'task_completed', 1);
  });

  it('moves goal progress', async () => {
    const user = await createUser();
    const goal = await authed(user).post('/task-goals').send({ title: 'Read more' });
    expect(goal.status).toBe(201);
    const habit = await makeHabit(user, { taskGoalId: goal.body.data.id });
    // Goal progress still reads the newest copy until the read paths move (T4).
    await prisma.task.create({
      data: {
        userId: user.id, title: habit.title, parentTaskId: habit.id,
        dueDate: new Date(TODAY), taskGoalId: goal.body.data.id,
      },
    });

    await put(user, habit.id, TODAY);

    const stored = await prisma.taskGoal.findUniqueOrThrow({ where: { id: goal.body.data.id } });
    expect(stored.isCompleted).toBe(true);
    await waitForFeed(user, 'goal_completed', 1);
  });
});

describe('DELETE /tasks/:id/completions/:date', () => {
  it('removes the day and revokes exactly what was paid, and a repeat changes nothing', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await put(user, habit.id, TODAY);

    const first = await del(user, habit.id, TODAY);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ taskId: habit.id, date: TODAY, done: false, changed: true });
    expect(first.body.reward.xpEarned).toBe(-XP);

    const repeat = await del(user, habit.id, TODAY);
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.changed).toBe(false);

    expect(await logRows(habit.id)).toBe(0);
    expect(await userStats(user)).toEqual({ xp: 0, tasksCompleted: 0 });
    await waitForFeed(user, 'task_completed', 1);
  });
});

describe('completion routes — 404', () => {
  it("answers 404 for another user's task", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const habit = await makeHabit(owner);

    expect((await put(intruder, habit.id, TODAY)).status).toBe(404);
    expect((await del(intruder, habit.id, TODAY)).status).toBe(404);
    expect(await logRows(habit.id)).toBe(0);
  });

  it('answers 404 for a task that is not recurring', async () => {
    const user = await createUser();
    const task = await prisma.task.create({ data: { userId: user.id, title: 'One-off' } });

    expect((await put(user, task.id, TODAY)).status).toBe(404);
  });

  it('answers 404 for a deleted (archived) recurring task', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);
    await prisma.task.update({ where: { id: habit.id }, data: { isArchived: true } });

    expect((await put(user, habit.id, TODAY)).status).toBe(404);
  });

  it('answers 404 for an unknown id', async () => {
    const user = await createUser();

    expect((await put(user, 'no-such-task', TODAY)).status).toBe(404);
  });
});

describe('completion routes — 400', () => {
  async function expect400(user: TestUser, taskId: string, date: string) {
    const res = await put(user, taskId, date);
    expect(res.status).toBe(400);
    expect(await logRows(taskId)).toBe(0);
    expect(await userStats(user)).toEqual({ xp: 0, tasksCompleted: 0 });
  }

  it('rejects a malformed or impossible date', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    await expect400(user, habit.id, 'yesterday');
    await expect400(user, habit.id, '2026-02-30');
  });

  it('rejects a day the task is not scheduled on', async () => {
    const user = await createUser();
    const otherDay = dayNameFromLocalDate(YESTERDAY);
    const habit = await makeHabit(user, { recurringDays: [otherDay] });

    await expect400(user, habit.id, TODAY);
  });

  it('rejects a future date', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    await expect400(user, habit.id, utcDayOffset(1));
  });

  it('rejects a date more than one day ago', async () => {
    const user = await createUser();
    const habit = await makeHabit(user);

    await expect400(user, habit.id, utcDayOffset(-2));
  });

  it('rejects a date after the task stops repeating', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, { endsOn: YESTERDAY });

    await expect400(user, habit.id, TODAY);
  });

  it('rejects a date before the task was created', async () => {
    const user = await createUser();
    // Created late today UTC: no zone on earth was still on yesterday then.
    const habit = await makeHabit(user, { createdAt: new Date(`${TODAY}T20:00:00.000Z`) });

    await expect400(user, habit.id, YESTERDAY);
  });
});
