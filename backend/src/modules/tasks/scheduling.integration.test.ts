import { describe, it, expect } from 'vitest';
import { createUser, authed } from '../../test/factories';

/**
 * Task start/end times — the data behind the calendar Day timeline.
 *
 * Times are stored as minutes from LOCAL midnight rather than as instants, so a
 * 09:00 task stays 09:00 across a timezone change or a DST boundary. These run
 * against a real Postgres and the real Express app, so they prove the stored
 * column and the validation rules, not a reimplementation of either.
 */

/** 'YYYY-MM-DD' n days from today, in UTC — matches the dueDate convention. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = () => dayOffset(0);

const NINE_AM = 9 * 60;          // 540
const TEN_THIRTY = 10 * 60 + 30; // 630

describe('POST /tasks — scheduled times', () => {
  it('stores a start and end time and returns them', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Ship the lock fix',
      dueDate: today(),
      startMinutes: NINE_AM,
      endMinutes: TEN_THIRTY,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBe(NINE_AM);
    expect(res.body.data.endMinutes).toBe(TEN_THIRTY);

    // And it survives the round trip, rather than only existing in the response.
    const list = await authed(user).get('/tasks');
    const stored = list.body.data.find((t: { title: string }) => t.title === 'Ship the lock fix');
    expect(stored.startMinutes).toBe(NINE_AM);
    expect(stored.endMinutes).toBe(TEN_THIRTY);
  });

  it('leaves both null when no time is given — untimed stays the default', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({ title: 'Untimed', dueDate: today() });

    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBeNull();
    expect(res.body.data.endMinutes).toBeNull();
  });

  it('rejects an end that is not after the start', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Backwards',
      dueDate: today(),
      startMinutes: TEN_THIRTY,
      endMinutes: NINE_AM,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after start/i);
  });

  it('rejects a zero-length block', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Instant',
      dueDate: today(),
      startMinutes: NINE_AM,
      endMinutes: NINE_AM,
    });

    expect(res.status).toBe(400);
  });

  it('rejects a time with no due date — it could not be placed on any day', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Floating',
      startMinutes: NINE_AM,
      endMinutes: TEN_THIRTY,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/due date/i);
  });

  it('rejects a start with no end — a timeline block needs a height', async () => {
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Half open',
      dueDate: today(),
      startMinutes: NINE_AM,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/both a start and an end/i);
  });

  it('rejects minutes outside a single day', async () => {
    const user = await createUser();

    const tooLate = await authed(user).post('/tasks').send({
      title: 'Tomorrow really',
      dueDate: today(),
      startMinutes: 0,
      endMinutes: 1440,
    });
    expect(tooLate.status).toBe(400);

    const negative = await authed(user).post('/tasks').send({
      title: 'Yesterday really',
      dueDate: today(),
      startMinutes: -1,
      endMinutes: 60,
    });
    expect(negative.status).toBe(400);
  });
});

describe('PATCH /tasks/:id — scheduled times', () => {
  async function createUntimed(user: Awaited<ReturnType<typeof createUser>>) {
    const res = await authed(user).post('/tasks').send({ title: 'Task', dueDate: today() });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  async function createTimed(user: Awaited<ReturnType<typeof createUser>>) {
    const id = await createUntimed(user);
    const res = await authed(user)
      .patch(`/tasks/${id}`)
      .send({ startMinutes: NINE_AM, endMinutes: TEN_THIRTY });
    expect(res.status).toBe(200);
    return id;
  }

  it('adds times to an existing task', async () => {
    const user = await createUser();
    const id = await createUntimed(user);

    const res = await authed(user)
      .patch(`/tasks/${id}`)
      .send({ startMinutes: NINE_AM, endMinutes: TEN_THIRTY });

    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBe(NINE_AM);
    expect(res.body.data.endMinutes).toBe(TEN_THIRTY);
  });

  it('clears times back to untimed with null', async () => {
    const user = await createUser();
    const id = await createTimed(user);

    const res = await authed(user)
      .patch(`/tasks/${id}`)
      .send({ startMinutes: null, endMinutes: null });

    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBeNull();
    expect(res.body.data.endMinutes).toBeNull();
  });

  it('refuses to strand a timed task by clearing only its due date', async () => {
    // The merged-validation case: the patch alone looks harmless, but applying
    // it would leave a 09:00-10:30 block on no calendar day at all.
    const user = await createUser();
    const id = await createTimed(user);

    const res = await authed(user).patch(`/tasks/${id}`).send({ dueDate: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/due date/i);
  });

  it('refuses to strand an end time by clearing only the start', async () => {
    const user = await createUser();
    const id = await createTimed(user);

    const res = await authed(user).patch(`/tasks/${id}`).send({ startMinutes: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/both a start and an end/i);
  });

  it('rejects a patch that would invert the block', async () => {
    const user = await createUser();
    const id = await createTimed(user);

    const res = await authed(user).patch(`/tasks/${id}`).send({ endMinutes: NINE_AM - 30 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after start/i);
  });

  it('will not let one user schedule another persons task', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const id = await createUntimed(owner);

    const res = await authed(stranger)
      .patch(`/tasks/${id}`)
      .send({ startMinutes: NINE_AM, endMinutes: TEN_THIRTY });

    expect(res.status).toBe(404);

    const check = await authed(owner).get(`/tasks/${id}`);
    expect(check.body.data.startMinutes).toBeNull();
  });
});

describe('scheduled times on recurring tasks and the calendar', () => {
  it('spawns the instance with the time slot from its template', async () => {
    // "Gym at 07:00" has to spawn at 07:00 — the time is part of the habit.
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Gym',
      isRecurring: true,
      recurringDays: [],
      localDate: today(),
      dueDate: today(),
      startMinutes: 7 * 60,
      endMinutes: 8 * 60,
    });
    expect(res.status).toBe(200);

    // GET /tasks hides templates, so anything returned here is the instance.
    const list = await authed(user).get('/tasks');
    const instance = list.body.data.find((t: { title: string }) => t.title === 'Gym');
    expect(instance).toBeDefined();
    expect(instance.startMinutes).toBe(7 * 60);
    expect(instance.endMinutes).toBe(8 * 60);
  });

  it('lets a template hold a time slot without a due date of its own', async () => {
    // A template is never drawn on a calendar — its instances are, and each of
    // those gets its own dueDate at spawn time. Requiring one on the template
    // would block "gym at 07:00, every day" for no reason.
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'Stretch',
      isRecurring: true,
      recurringDays: [],
      localDate: today(),
      startMinutes: 6 * 60,
      endMinutes: 6 * 60 + 20,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.dueDate).toBeNull();
    expect(res.body.data.startMinutes).toBe(6 * 60);

    // The instance still lands on a real day, carrying the slot.
    const list = await authed(user).get('/tasks');
    const instance = list.body.data.find((t: { title: string }) => t.title === 'Stretch');
    expect(instance.dueDate).not.toBeNull();
    expect(instance.startMinutes).toBe(6 * 60);
    expect(instance.endMinutes).toBe(6 * 60 + 20);
  });

  it('still refuses a stray time on a one-off task with no day', async () => {
    // The exemption is for templates only — it must not leak to ordinary tasks.
    const user = await createUser();

    const res = await authed(user).post('/tasks').send({
      title: 'One off',
      isRecurring: false,
      startMinutes: 6 * 60,
      endMinutes: 7 * 60,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/due date/i);
  });

  it('carries the times through to the calendar payload', async () => {
    const user = await createUser();
    await authed(user).post('/tasks').send({
      title: 'Deep work',
      dueDate: today(),
      startMinutes: NINE_AM,
      endMinutes: TEN_THIRTY,
    });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${today()}`);

    expect(res.status).toBe(200);
    const item = res.body.data.items.find(
      (i: { type: string; data: { title?: string } }) =>
        i.type === 'task' && i.data?.title === 'Deep work',
    );
    expect(item).toBeDefined();
    expect(item.data.startMinutes).toBe(NINE_AM);
    expect(item.data.endMinutes).toBe(TEN_THIRTY);
  });
});
