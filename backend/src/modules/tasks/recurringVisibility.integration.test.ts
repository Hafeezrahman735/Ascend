import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { dayNameFromLocalDate } from '../../lib/localDate';

/**
 * Recurring tasks must not vanish.
 *
 * Two routes let a habit silently drop out of the app:
 *
 *  - spawn-recurring selected templates with `NOT: { lastSpawnedDate: today }`,
 *    which in SQL never matches a NULL column. A template only gets that column
 *    stamped when an instance is spawned, so a habit created on a day it is not
 *    scheduled for — or a one-off task later switched to recurring — never
 *    spawned an instance, ever.
 *  - DELETE on a template archived the template alone. Its live instance was
 *    left behind with no parent the spawner still looks at, so it was never
 *    archived and lingered in the list indefinitely.
 */

/**
 * UTC date N days from now. The routes accept a client localDate only within a
 * day of the server's UTC date, so the tests stay inside that window by
 * anchoring on UTC rather than the machine's local calendar.
 */
function utcDayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = utcDayOffset(0);
const TOMORROW = utcDayOffset(1);

async function createHabit(user: TestUser, recurringDays: string[]) {
  const res = await authed(user)
    .post('/tasks')
    .send({ title: 'Stretch', isRecurring: true, recurringDays, localDate: TODAY });
  expect(res.status).toBe(200);
  return res.body.data as { id: string };
}

const liveInstances = (templateId: string) =>
  prisma.task.findMany({ where: { parentTaskId: templateId, isArchived: false } });

describe('POST /tasks/spawn-recurring — templates never spawned before', () => {
  it('spawns a habit created on a day it was not scheduled', async () => {
    // THE regression: scheduled for tomorrow only, created today, so POST
    // /tasks spawns nothing and leaves lastSpawnedDate null.
    const user = await createUser();
    const habit = await createHabit(user, [dayNameFromLocalDate(TOMORROW)]);
    expect(await liveInstances(habit.id)).toHaveLength(0);

    const res = await authed(user).post('/tasks/spawn-recurring').send({ localDate: TOMORROW });

    expect(res.status).toBe(200);
    expect(res.body.data.spawned).toBe(1);
    const instances = await liveInstances(habit.id);
    expect(instances).toHaveLength(1);
    expect(instances[0].dueDate?.toISOString().slice(0, 10)).toBe(TOMORROW);
  });

  it('spawns a one-off task that was switched to recurring', async () => {
    const user = await createUser();
    const created = await authed(user).post('/tasks').send({ title: 'Journal' });
    const taskId = created.body.data.id as string;

    const patched = await authed(user)
      .patch(`/tasks/${taskId}`)
      .send({ isRecurring: true, recurringDays: [], dueDate: null });
    expect(patched.status).toBe(200);

    await authed(user).post('/tasks/spawn-recurring').send({ localDate: TODAY });

    const list = await authed(user).get('/tasks');
    const titles = (list.body.data as { title: string; parentTaskId: string | null }[])
      .filter((t) => t.parentTaskId === taskId)
      .map((t) => t.title);
    expect(titles).toEqual(['Journal']);
  });

  it('still does not spawn on a day the habit is not scheduled', async () => {
    const user = await createUser();
    const habit = await createHabit(user, [dayNameFromLocalDate(TOMORROW)]);

    const res = await authed(user).post('/tasks/spawn-recurring').send({ localDate: TODAY });

    expect(res.body.data.spawned).toBe(0);
    expect(await liveInstances(habit.id)).toHaveLength(0);
  });

  it('is idempotent once the null template has spawned', async () => {
    const user = await createUser();
    const habit = await createHabit(user, [dayNameFromLocalDate(TOMORROW)]);

    await authed(user).post('/tasks/spawn-recurring').send({ localDate: TOMORROW });
    const second = await authed(user).post('/tasks/spawn-recurring').send({ localDate: TOMORROW });

    expect(second.body.data.spawned).toBe(0);
    expect(await liveInstances(habit.id)).toHaveLength(1);
  });
});

describe('DELETE /tasks/:id — deleting a recurring task', () => {
  it('archives the template and its live instance', async () => {
    const user = await createUser();
    const habit = await createHabit(user, []); // every day, so today spawns
    expect(await liveInstances(habit.id)).toHaveLength(1);

    const res = await authed(user).delete(`/tasks/${habit.id}`);

    expect(res.status).toBe(200);
    expect(await liveInstances(habit.id)).toHaveLength(0);
    const template = await prisma.task.findUnique({ where: { id: habit.id } });
    expect(template?.isArchived).toBe(true);

    const list = await authed(user).get('/tasks');
    expect(list.body.data).toEqual([]);
    const recurring = await authed(user).get(`/tasks/recurring?localDate=${TODAY}`);
    expect(recurring.body.data).toEqual([]);
  });

  it('keeps focus time already logged on past instances', async () => {
    // Deleting a habit ends it going forward. The hours spent on it happened.
    const user = await createUser();
    const habit = await createHabit(user, []);
    const [instance] = await liveInstances(habit.id);
    await prisma.session.create({
      data: {
        userId: user.id,
        taskId: instance.id,
        type: 'focus',
        durationSeconds: 1500,
        plannedDurationSeconds: 1500,
        completedAt: new Date(),
      },
    });

    await authed(user).delete(`/tasks/${habit.id}`);

    expect(await prisma.session.count({ where: { taskId: instance.id } })).toBe(1);
  });

  it("returns 404 for another user's template and leaves it untouched", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const habit = await createHabit(owner, []);

    const res = await authed(intruder).delete(`/tasks/${habit.id}`);

    expect(res.status).toBe(404);
    expect(await liveInstances(habit.id)).toHaveLength(1);
    const template = await prisma.task.findUnique({ where: { id: habit.id } });
    expect(template?.isArchived).toBe(false);
  });
});
