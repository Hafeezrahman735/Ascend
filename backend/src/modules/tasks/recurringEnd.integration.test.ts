import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * A recurring task ends on its due date.
 *
 * Before this, a habit repeated forever. Three layers each decided when it
 * happened and none of them had an upper bound: the spawner checked only the
 * weekday, the calendar projection bounded occurrences by createdAt alone, and
 * a dueDate set on a template was read by nothing at all — so a user could set
 * an end date, watch it save, and watch the habit carry on regardless.
 *
 * A template's dueDate is now the last day it repeats, INCLUSIVE. These tests
 * cover the two routes that change behaviour, against a real database.
 */

/** Local date N days from today, as the spawner's 'YYYY-MM-DD'. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const today = () => dayOffset(0);

/**
 * Both routes resolve "today" from a client-supplied local date and fall back to
 * the server's UTC date. The mobile client always sends one
 * (taskStore.ts:426), so these tests do too — otherwise they compare a local
 * date against a UTC one and fail for hours either side of midnight rather than
 * for anything to do with end dates.
 */
const recurringUrl = () => `/tasks/recurring?localDate=${encodeURIComponent(today())}`;

/** A daily habit (empty recurringDays means every day). */
async function makeHabit(user: TestUser, endsOn: string | null) {
  return prisma.task.create({
    data: {
      userId: user.id,
      title: 'Read for 20 minutes',
      isRecurring: true,
      recurringDays: [],
      dueDate: endsOn ? new Date(`${endsOn}T00:00:00.000Z`) : null,
      // Backdated so the createdAt lower bound never masks what is being tested.
      createdAt: new Date(Date.now() - 30 * 86_400_000),
      // Set on purpose, and not optional. The spawner selects templates with
      // `NOT: { lastSpawnedDate: today }`, and in SQL `NOT (NULL = 'x')` is
      // NULL rather than true — so a template with a null lastSpawnedDate is
      // silently skipped. Real templates never have one: POST /tasks spawns the
      // first instance on create and stamps the column (routes.ts:183). A test
      // that builds the row directly has to do the same or nothing spawns and
      // every assertion expecting zero passes for the wrong reason.
      lastSpawnedDate: dayOffset(-1),
    },
  });
}

const instanceCount = (templateId: string) =>
  prisma.task.count({ where: { parentTaskId: templateId } });

describe('POST /tasks/spawn-recurring — the end date', () => {
  it('still spawns ON the last day', async () => {
    // Inclusive. "Ends today" means today's instance is still owed.
    const user = await createUser();
    const habit = await makeHabit(user, today());

    const res = await authed(user).post('/tasks/spawn-recurring').send({ localDate: today() });

    expect(res.status).toBe(200);
    expect(await instanceCount(habit.id)).toBe(1);
  });

  it('does not spawn after the end date', async () => {
    // THE regression. The spawner used to look only at the weekday, so a habit
    // that ended last week kept producing a fresh instance every single day.
    const user = await createUser();
    const habit = await makeHabit(user, dayOffset(-3));

    const res = await authed(user).post('/tasks/spawn-recurring').send({ localDate: today() });

    expect(res.status).toBe(200);
    expect(await instanceCount(habit.id)).toBe(0);
  });

  it('keeps spawning a habit with no end date', async () => {
    // Every template created before end dates existed carries a null dueDate
    // and must be unaffected.
    const user = await createUser();
    const habit = await makeHabit(user, null);

    await authed(user).post('/tasks/spawn-recurring').send({ localDate: today() });

    expect(await instanceCount(habit.id)).toBe(1);
  });

  it('still spawns before the end date', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, dayOffset(7));

    await authed(user).post('/tasks/spawn-recurring').send({ localDate: today() });

    expect(await instanceCount(habit.id)).toBe(1);
  });

  it('leaves instances already earned before the end alone', async () => {
    // Work that happened does not vanish because the habit later stopped. The
    // instance is archived by the usual not-today rule, never deleted.
    const user = await createUser();
    const habit = await makeHabit(user, dayOffset(-3));
    const earned = await prisma.task.create({
      data: {
        userId: user.id,
        title: 'Read for 20 minutes',
        parentTaskId: habit.id,
        isCompleted: true,
        completedAt: new Date(),
        dueDate: new Date(`${dayOffset(-5)}T00:00:00.000Z`),
      },
    });

    await authed(user).post('/tasks/spawn-recurring').send({ localDate: today() });

    const still = await prisma.task.findUnique({ where: { id: earned.id } });
    expect(still).not.toBeNull();
    expect(still?.isCompleted).toBe(true);
  });
});

describe('GET /tasks/recurring — the end date', () => {
  it('reports an ended habit as not scheduled, with no next occurrence', async () => {
    // The client renders nextOccurrence as "next: <day>". A stale date here
    // would promise a day the habit will never fire on again.
    const user = await createUser();
    await makeHabit(user, dayOffset(-1));

    const res = await authed(user).get(recurringUrl());

    expect(res.status).toBe(200);
    const [template] = res.body.data;
    expect(template.scheduledToday).toBe(false);
    expect(template.nextOccurrence).toBeNull();
  });

  it('reports a live habit as scheduled today', async () => {
    const user = await createUser();
    await makeHabit(user, dayOffset(7));

    const res = await authed(user).get(recurringUrl());

    const [template] = res.body.data;
    expect(template.scheduledToday).toBe(true);
    expect(template.nextOccurrence).toBe(today());
  });

  it('reports a habit ending TODAY as still scheduled', async () => {
    const user = await createUser();
    await makeHabit(user, today());

    const res = await authed(user).get(recurringUrl());

    const [template] = res.body.data;
    expect(template.scheduledToday).toBe(true);
    expect(template.nextOccurrence).toBe(today());
  });

  it('is unaffected when there is no end date', async () => {
    const user = await createUser();
    await makeHabit(user, null);

    const res = await authed(user).get(recurringUrl());

    const [template] = res.body.data;
    expect(template.scheduledToday).toBe(true);
    expect(template.nextOccurrence).toBe(today());
  });
});
