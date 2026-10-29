import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * A recurring task ends on its due date.
 *
 * Before end dates were enforced, a habit repeated forever: nothing read a
 * dueDate set on a recurring task, so a user could set an end date, watch it
 * save, and watch the habit carry on regardless.
 *
 * A recurring task's dueDate is the last day it repeats, INCLUSIVE. These tests
 * cover the two routes that show it, against a real database.
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
    },
  });
}

/** Whether today's list has a row for this recurring task. */
async function listedToday(user: TestUser, taskId: string): Promise<boolean> {
  const res = await authed(user).get(`/tasks?localDate=${encodeURIComponent(today())}`);
  expect(res.status).toBe(200);
  return res.body.data.some((t: { id: string }) => t.id === taskId);
}

describe('GET /tasks — the end date', () => {
  it('still lists the task ON its last day', async () => {
    // Inclusive. "Ends today" means today's occurrence is still owed.
    const user = await createUser();
    const habit = await makeHabit(user, today());

    expect(await listedToday(user, habit.id)).toBe(true);
  });

  it('does not list it after the end date', async () => {
    // A habit that ended last week must not keep producing a row every day.
    const user = await createUser();
    const habit = await makeHabit(user, dayOffset(-3));

    expect(await listedToday(user, habit.id)).toBe(false);
  });

  it('lists a task with no end date', async () => {
    // Every recurring task created before end dates existed carries a null
    // dueDate and must be unaffected.
    const user = await createUser();
    const habit = await makeHabit(user, null);

    expect(await listedToday(user, habit.id)).toBe(true);
  });

  it('lists it before the end date', async () => {
    const user = await createUser();
    const habit = await makeHabit(user, dayOffset(7));

    expect(await listedToday(user, habit.id)).toBe(true);
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
