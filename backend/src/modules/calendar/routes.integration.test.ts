import { describe, it, expect } from 'vitest';
import { createUser, authed } from '../../test/factories';

/**
 * The reported bug: a recurring task set to every day showed on the calendar
 * only on the day its instance existed. Past days were archived by
 * spawn-recurring and filtered out; future days had no row at all.
 *
 * These run against a real Postgres and a real Express app, so they prove the
 * whole path — route, projection, and the schedule rule — not just the pure
 * function in isolation.
 */

/** 'YYYY-MM-DD' n days from today, in UTC. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = () => dayOffset(0);

async function createRecurring(user: Awaited<ReturnType<typeof createUser>>, opts: {
  title: string;
  recurringDays?: string[];
}) {
  const res = await authed(user).post('/tasks').send({
    title: opts.title,
    isRecurring: true,
    recurringDays: opts.recurringDays ?? [],
    localDate: today(),
  });
  expect(res.status).toBe(200);
  return res.body.data;
}

function habitDates(items: { type: string; date: string; data: { title?: string } }[], title: string): string[] {
  return items
    .filter((i) => i.type === 'habit_instance' && i.data?.title === title)
    .map((i) => i.date)
    .sort();
}

describe('GET /calendar — recurring tasks', () => {
  it('shows an everyday recurring task on EVERY day of the range', async () => {
    // This is the exact reported symptom: "go to gym", active every day of the
    // week, appeared on one date only.
    const user = await createUser();
    await createRecurring(user, { title: 'Go to gym' });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(6)}`);

    expect(res.status).toBe(200);
    const dates = habitDates(res.body.data.items, 'Go to gym');
    expect(dates).toEqual([
      dayOffset(0), dayOffset(1), dayOffset(2), dayOffset(3),
      dayOffset(4), dayOffset(5), dayOffset(6),
    ]);
  });

  it('shows future scheduled days, not just today', async () => {
    const user = await createUser();
    await createRecurring(user, { title: 'Future' });

    const res = await authed(user).get(`/calendar?start=${dayOffset(1)}&end=${dayOffset(3)}`);

    expect(habitDates(res.body.data.items, 'Future')).toEqual([
      dayOffset(1), dayOffset(2), dayOffset(3),
    ]);
  });

  it('only shows the days a partial schedule actually covers', async () => {
    const user = await createUser();
    // Whatever weekday today is, schedule the task for that weekday only.
    const todayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getUTCDay()];
    await createRecurring(user, { title: 'Weekly', recurringDays: [todayName] });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(6)}`);

    // Today and the same weekday next week (day +7 is outside the range).
    expect(habitDates(res.body.data.items, 'Weekly')).toEqual([today()]);
  });

  it('does NOT project a recurring task before it was created', async () => {
    // Otherwise a habit made today paints the whole earlier month as missed.
    const user = await createUser();
    await createRecurring(user, { title: 'New habit' });

    const res = await authed(user).get(`/calendar?start=${dayOffset(-5)}&end=${today()}`);

    expect(habitDates(res.body.data.items, 'New habit')).toEqual([today()]);
  });

  it('marks days with no real row as projected', async () => {
    const user = await createUser();
    await createRecurring(user, { title: 'Flagged' });

    const res = await authed(user).get(`/calendar?start=${dayOffset(2)}&end=${dayOffset(2)}`);

    const item = res.body.data.items.find(
      (i: { type: string; data: { title?: string } }) =>
        i.type === 'habit_instance' && i.data?.title === 'Flagged',
    );
    expect(item).toBeDefined();
    expect(item.data.isProjected).toBe(true);
    expect(item.data.isCompleted).toBe(false);
    // Synthetic id must never look like a real task id.
    expect(String(item.data.id).startsWith('projected:')).toBe(true);
  });

  it('keeps a one-off task and a recurring task distinct', async () => {
    const user = await createUser();
    await createRecurring(user, { title: 'Recurring one' });
    await authed(user).post('/tasks').send({ title: 'One off', dueDate: today() });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(2)}`);
    const items = res.body.data.items;

    expect(habitDates(items, 'Recurring one')).toHaveLength(3);
    // The standalone task appears once, as a task, not as a recurring occurrence.
    const oneOff = items.filter((i: { data: { title?: string } }) => i.data?.title === 'One off');
    expect(oneOff).toHaveLength(1);
    expect(oneOff[0].type).toBe('task');
  });

  it('returns no recurring occurrences for a user who has none', async () => {
    const user = await createUser();
    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(6)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.filter((i: { type: string }) => i.type === 'habit_instance'))
      .toEqual([]);
  });

  it('does not leak another user recurring tasks', async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await createRecurring(theirs, { title: 'Their habit' });

    const res = await authed(mine).get(`/calendar?start=${today()}&end=${dayOffset(6)}`);

    expect(habitDates(res.body.data.items, 'Their habit')).toEqual([]);
  });
});
