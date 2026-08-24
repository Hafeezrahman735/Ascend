import { describe, it, expect } from 'vitest';
import { createUser, authed } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { MAX_SESSION_SECONDS } from '../../lib/sessionCredit';

/**
 * POST /timer/complete — how much focus time actually gets credited.
 *
 * This route had no integration coverage at all, which mattered once focus
 * blocks stopped being a fixed length. The client used to clamp every session to
 * the user's configured 25 minutes before sending it, so a 35-minute block
 * credited 25 and the missing 10 minutes were destroyed client-side, where no
 * server fix could reach them. The `plannedDurationSeconds` cases below are the
 * regression tests for that.
 *
 * Runs against a real Postgres and the real Express app.
 */

const FIVE_MIN = 5 * 60;
const TWENTY_MIN = 20 * 60;
const TWENTY_FIVE_MIN = 25 * 60;
const THIRTY_FIVE_MIN = 35 * 60;

/** A completion time the route will accept — it bounds how far off `now` this may be. */
const justNow = () => Date.now();

async function completeSession(
  user: Awaited<ReturnType<typeof createUser>>,
  body: Record<string, unknown>,
) {
  return authed(user).post('/timer/complete').send({
    completedAt: justNow(),
    actualElapsedSeconds: TWENTY_FIVE_MIN,
    ...body,
  });
}

async function createTask(user: Awaited<ReturnType<typeof createUser>>, title: string) {
  const res = await authed(user).post('/tasks').send({ title });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

describe('POST /timer/complete — credited duration', () => {
  it('credits a session that ran exactly as planned', async () => {
    const user = await createUser();

    const res = await completeSession(user, {
      actualElapsedSeconds: TWENTY_MIN,
      plannedDurationSeconds: TWENTY_MIN,
    });

    expect(res.status).toBe(200);
    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(TWENTY_MIN);
    expect(session?.plannedDurationSeconds).toBe(TWENTY_MIN);
  });

  it('credits a block LONGER than the old 25-minute default', async () => {
    // The regression test for the whole adaptive-session feature. A grace-zone
    // block legitimately runs past 25 minutes; the previous client clamped it to
    // 25 before the request was ever sent, so this outcome was unreachable.
    const user = await createUser();

    const res = await completeSession(user, {
      actualElapsedSeconds: THIRTY_FIVE_MIN,
      plannedDurationSeconds: THIRTY_FIVE_MIN,
    });

    expect(res.status).toBe(200);
    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(THIRTY_FIVE_MIN);
  });

  it('still refuses to credit more than was planned', async () => {
    // The forgery bound. Shortening blocks must not come at the cost of letting
    // a client claim arbitrary time.
    const user = await createUser();

    const res = await completeSession(user, {
      actualElapsedSeconds: THIRTY_FIVE_MIN,
      plannedDurationSeconds: TWENTY_MIN,
    });

    expect(res.status).toBe(200);
    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(TWENTY_MIN);
  });

  it('credits the full elapsed time when there is no plan (stopwatch)', async () => {
    const user = await createUser();

    const res = await completeSession(user, {
      actualElapsedSeconds: THIRTY_FIVE_MIN,
      plannedDurationSeconds: null,
    });

    expect(res.status).toBe(200);
    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(THIRTY_FIVE_MIN);
  });

  it('rejects a planned duration past the server ceiling', async () => {
    // Documents the bound the client must respect. The estimate stepper allows
    // 480 minutes while MAX_SESSION_SECONDS is 6h, so an uncapped plan would
    // produce a session the server refuses — losing it entirely rather than
    // merely mis-sizing it. mobile/lib/sessionPlan.ts caps blocks at 360 min
    // precisely to stay inside this.
    const user = await createUser();

    const res = await completeSession(user, {
      actualElapsedSeconds: MAX_SESSION_SECONDS,
      plannedDurationSeconds: MAX_SESSION_SECONDS + 1,
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /timer/complete — task counters', () => {
  it('adds the credited time to the linked task, not the elapsed time', async () => {
    const user = await createUser();
    const taskId = await createTask(user, 'Write the thing');

    const res = await completeSession(user, {
      actualElapsedSeconds: THIRTY_FIVE_MIN,
      plannedDurationSeconds: TWENTY_MIN, // over-run gets clamped
      taskId,
    });
    expect(res.status).toBe(200);

    const task = await authed(user).get(`/tasks/${taskId}`);
    expect(task.body.data.totalTimeOnTask).toBe(TWENTY_MIN);
    expect(task.body.data.sessionsOnTask).toBe(1);
  });

  it('accumulates blocks of DIFFERENT lengths across a plan', async () => {
    // A 65-minute plan splits into 25 + 20 + 20. The task must end up with the
    // full 65 minutes and three sessions, which is the property that makes
    // "remaining = estimate - totalTimeOnTask" converge instead of looping.
    const user = await createUser();
    const taskId = await createTask(user, 'Deep work');

    for (const minutes of [25, 20, 20]) {
      const seconds = minutes * 60;
      const res = await completeSession(user, {
        actualElapsedSeconds: seconds,
        plannedDurationSeconds: seconds,
        taskId,
      });
      expect(res.status).toBe(200);
    }

    const task = await authed(user).get(`/tasks/${taskId}`);
    expect(task.body.data.totalTimeOnTask).toBe(65 * 60);
    expect(task.body.data.sessionsOnTask).toBe(3);
  });

  it('saves the session but ignores a task the caller does not own', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const taskId = await createTask(owner, 'Not yours');

    const res = await completeSession(stranger, {
      actualElapsedSeconds: TWENTY_MIN,
      plannedDurationSeconds: TWENTY_MIN,
      taskId,
    });

    // Focus time is never thrown away over a bad task id.
    expect(res.status).toBe(200);
    const session = await prisma.session.findUnique({ where: { id: res.body.data.sessionId } });
    expect(session?.durationSeconds).toBe(TWENTY_MIN);
    expect(session?.taskId).toBeNull();

    // And the owner's task is untouched.
    const task = await authed(owner).get(`/tasks/${taskId}`);
    expect(task.body.data.totalTimeOnTask).toBe(0);
    expect(task.body.data.sessionsOnTask).toBe(0);
  });
});

describe('POST /timer/complete — idempotency', () => {
  it('does not double-credit a retried submission', async () => {
    // The client fires and forgets, so a retry after a flaky network is normal.
    const user = await createUser();
    const taskId = await createTask(user, 'Retried');
    const clientSessionId = 'test-client-session-0001';

    const first = await completeSession(user, {
      actualElapsedSeconds: FIVE_MIN,
      plannedDurationSeconds: FIVE_MIN,
      taskId,
      clientSessionId,
    });
    const second = await completeSession(user, {
      actualElapsedSeconds: FIVE_MIN,
      plannedDurationSeconds: FIVE_MIN,
      taskId,
      clientSessionId,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyProcessed).toBe(true);
    expect(second.body.data.sessionId).toBe(first.body.data.sessionId);

    const sessions = await prisma.session.count({ where: { userId: user.id, type: 'focus' } });
    expect(sessions).toBe(1);

    const task = await authed(user).get(`/tasks/${taskId}`);
    expect(task.body.data.totalTimeOnTask).toBe(FIVE_MIN);
    expect(task.body.data.sessionsOnTask).toBe(1);
  });
});
