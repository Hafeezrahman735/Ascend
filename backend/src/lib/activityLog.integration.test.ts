import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../test/factories';

/**
 * The personal activity log, end to end: finishing work writes a row, and
 * `GET /activity` reads it back.
 *
 * Written because this very nearly got deleted. `socialStore.feedEvents` has no
 * UI and the `/social` socket that pushed to it was never connected, which made
 * the whole feed_events table look dead — but `GET /activity` reads the SAME
 * table for the Tasks tab's Recent Activity card, which is very much alive.
 * Removing the emit sites would have left that card permanently empty, and
 * nothing in the suite would have said a word.
 *
 * So this test exists to make the write path load-bearing in CI: if a future
 * cleanup drops the FEED_CREATE emits again, this fails instead of the feature.
 */

const TWENTY_FIVE_MIN = 25 * 60;

function todayLocal(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function completeSession(user: TestUser) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    actualElapsedSeconds: TWENTY_FIVE_MIN,
    localDate: todayLocal(),
    tz: 'UTC',
  });
  expect(res.status).toBe(200);
}

/** The event bus is fire-and-forget, so the write lands just after the response. */
async function activityFor(user: TestUser) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await authed(user).get('/activity');
    expect(res.status).toBe(200);
    if (res.body.data.events.length > 0) return res.body.data.events;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

describe('GET /activity', () => {
  it('records a completed session', async () => {
    const user = await createUser();

    await completeSession(user);

    const events = await activityFor(user);
    const session = events.find((e: { eventType: string }) => e.eventType === 'session_completed');
    expect(session).toBeDefined();
    expect(session.payload.durationMinutes).toBe(25);
  });

  it('records a completed task', async () => {
    const user = await createUser();

    const created = await authed(user).post('/tasks').send({ title: 'Rewrite the methods section' });
    expect(created.status).toBe(200);
    const done = await authed(user).patch(`/tasks/${created.body.data.id}`).send({
      isCompleted: true,
      completedAt: new Date().toISOString(),
    });
    expect(done.status).toBe(200);

    const events = await activityFor(user);
    const task = events.find((e: { eventType: string }) => e.eventType === 'task_completed');
    expect(task).toBeDefined();
    expect(task.payload.taskTitle).toBe('Rewrite the methods section');
  });

  it('is self-only — one user never sees another user activity', async () => {
    const owner = await createUser();
    const stranger = await createUser();

    await completeSession(owner);
    await activityFor(owner);

    const res = await authed(stranger).get('/activity');
    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(0);
  });
});
