import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed } from '../../test/factories';

/**
 * Event routes against a real Postgres and a real Express app.
 *
 * The interesting behaviour is not the CRUD — it is the schedule rule, the
 * ownership scoping, and the fact that an Event reaches GET /calendar tagged
 * `event` and never as a task. That last one is the whole reason the model is
 * separate: completing a task awards XP and posts to the social feed, and a
 * dentist appointment must never be able to take that path.
 */

/** 'YYYY-MM-DD' n days from today, in UTC. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = () => dayOffset(0);

type TestUser = Awaited<ReturnType<typeof createUser>>;

function createEvent(user: TestUser, body: Record<string, unknown>) {
  return authed(user).post('/events').send(body);
}

/** Titles of the `event`-typed items a calendar response returned. */
function eventTitles(body: {
  data: { items: { type: string; data: { title: string } }[] };
}): string[] {
  return body.data.items.filter((i) => i.type === 'event').map((i) => i.data.title);
}

describe('POST /events', () => {
  it('creates an all-day event when no times are given', async () => {
    const user = await createUser();

    const res = await createEvent(user, { title: 'Public holiday', date: today() });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Public holiday',
      date: today(),
      startMinutes: null,
      endMinutes: null,
      isArchived: false,
    });
  });

  it('creates a timed event', async () => {
    const user = await createUser();

    const res = await createEvent(user, {
      title: 'Dentist',
      date: today(),
      startMinutes: 14 * 60,
      endMinutes: 15 * 60,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ startMinutes: 840, endMinutes: 900 });
  });

  it('rejects a half-scheduled event', async () => {
    const user = await createUser();

    const res = await createEvent(user, {
      title: 'Half scheduled',
      date: today(),
      startMinutes: 600,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/both a start and an end/i);
  });

  it('rejects an event that ends before it starts, rather than clamping it', async () => {
    // 11pm-1am is unrepresentable while endMinutes caps at 1439. Refusing is
    // honest; silently storing 23:00-23:59 would misreport the user's day.
    const user = await createUser();

    const res = await createEvent(user, {
      title: 'Overnight flight',
      date: today(),
      startMinutes: 23 * 60,
      endMinutes: 60,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after start time/i);
  });

  it('rejects an event with no date — unlike a note, an undated event is not a thing', async () => {
    const user = await createUser();

    const res = await createEvent(user, { title: 'Floating' });

    expect(res.status).toBe(400);
  });

  it('rejects a whitespace-only title', async () => {
    const user = await createUser();

    const res = await createEvent(user, { title: '   ', date: today() });

    expect(res.status).toBe(400);
  });

  it('rejects a start time outside the day', async () => {
    const user = await createUser();

    const res = await createEvent(user, {
      title: 'Impossible', date: today(), startMinutes: 1440, endMinutes: 1500,
    });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/events').send({ title: 'Anonymous', date: today() });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /events/:id', () => {
  it('updates the title and moves the day', async () => {
    const user = await createUser();
    const created = await createEvent(user, { title: 'Standup', date: today() });

    const res = await authed(user)
      .patch(`/events/${created.body.data.id}`)
      .send({ title: 'Standup (moved)', date: dayOffset(2) });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: 'Standup (moved)', date: dayOffset(2) });
  });

  it('validates the MERGED row, so clearing one end of a timed event fails', async () => {
    const user = await createUser();
    const created = await createEvent(user, {
      title: 'Dentist', date: today(), startMinutes: 600, endMinutes: 660,
    });

    const res = await authed(user)
      .patch(`/events/${created.body.data.id}`)
      .send({ startMinutes: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/both a start and an end/i);
  });

  it('allows clearing both ends, turning a timed event all-day', async () => {
    const user = await createUser();
    const created = await createEvent(user, {
      title: 'Dentist', date: today(), startMinutes: 600, endMinutes: 660,
    });

    const res = await authed(user)
      .patch(`/events/${created.body.data.id}`)
      .send({ startMinutes: null, endMinutes: null });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ startMinutes: null, endMinutes: null });
  });

  it('rejects a patch that would invert an existing block', async () => {
    const user = await createUser();
    const created = await createEvent(user, {
      title: 'Dentist', date: today(), startMinutes: 600, endMinutes: 660,
    });

    const res = await authed(user)
      .patch(`/events/${created.body.data.id}`)
      .send({ endMinutes: 540 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after start time/i);
  });

  it("404s on another user's event and leaves it untouched", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await createEvent(owner, { title: 'Private', date: today() });

    const res = await authed(stranger)
      .patch(`/events/${created.body.data.id}`)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(404);

    const check = await authed(owner).get(`/calendar?start=${today()}&end=${today()}`);
    expect(eventTitles(check.body)).toEqual(['Private']);
  });

  it('404s on an id that does not exist', async () => {
    const user = await createUser();

    const res = await authed(user).patch('/events/does-not-exist').send({ title: 'x' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /events/:id', () => {
  it('archives the event and drops it from the calendar', async () => {
    const user = await createUser();
    const created = await createEvent(user, { title: 'Cancelled', date: today() });

    const res = await authed(user).delete(`/events/${created.body.data.id}`);
    expect(res.status).toBe(200);

    const check = await authed(user).get(`/calendar?start=${today()}&end=${today()}`);
    expect(eventTitles(check.body)).toEqual([]);
  });

  it('404s on a second delete, because the row is already archived', async () => {
    const user = await createUser();
    const created = await createEvent(user, { title: 'Once', date: today() });

    await authed(user).delete(`/events/${created.body.data.id}`);
    const res = await authed(user).delete(`/events/${created.body.data.id}`);

    expect(res.status).toBe(404);
  });

  it("404s on another user's event", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await createEvent(owner, { title: 'Private', date: today() });

    const res = await authed(stranger).delete(`/events/${created.body.data.id}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /calendar — events', () => {
  it("tags events as 'event', never as a task", async () => {
    const user = await createUser();
    await createEvent(user, { title: 'Dentist', date: today(), startMinutes: 840, endMinutes: 900 });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${today()}`);

    expect(res.status).toBe(200);
    const events = res.body.data.items.filter((i: { type: string }) => i.type === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: today(), data: { title: 'Dentist' } });
    // The whole point of a separate model: nothing about it reads as a task.
    expect(res.body.data.items.filter((i: { type: string }) => i.type === 'task')).toEqual([]);
  });

  it('returns only events inside the requested range', async () => {
    const user = await createUser();
    await createEvent(user, { title: 'Inside', date: dayOffset(1) });
    await createEvent(user, { title: 'Outside', date: dayOffset(9) });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(3)}`);

    expect(eventTitles(res.body)).toEqual(['Inside']);
  });

  it('orders a day by start time, with all-day events first', async () => {
    const user = await createUser();
    await createEvent(user, { title: 'Afternoon', date: today(), startMinutes: 840, endMinutes: 900 });
    await createEvent(user, { title: 'Morning', date: today(), startMinutes: 540, endMinutes: 600 });
    await createEvent(user, { title: 'All day', date: today() });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${today()}`);

    // Postgres sorts NULLs last on ASC by default, so the all-day event lands at
    // the end of the ordered rows — pinning it here so a later ordering change
    // is a deliberate one.
    expect(eventTitles(res.body)).toEqual(['Morning', 'Afternoon', 'All day']);
  });

  it("never returns another user's events", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await createEvent(owner, { title: 'Theirs', date: today() });

    const res = await authed(stranger).get(`/calendar?start=${today()}&end=${today()}`);

    expect(eventTitles(res.body)).toEqual([]);
  });
});
