import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * GET /time-report/goals/:id/daily — one goal's focus by local day.
 *
 * The contract: it follows each task's CURRENT goal, exactly like
 * /task-goals, so the series adds up to the goal's totalFocusSeconds there.
 */

const MIN = 60;
const NY = 'America/New_York';

async function goal(user: TestUser, title = 'Launch') {
  return prisma.taskGoal.create({ data: { userId: user.id, title } });
}

async function task(user: TestUser, title: string, taskGoalId: string | null = null, isRecurring = false) {
  return prisma.task.create({ data: { userId: user.id, title, taskGoalId, isRecurring } });
}

function session(user: TestUser, iso: string, minutes: number, taskId: string | null, stamped = true) {
  const d = new Date(iso);
  return {
    userId: user.id,
    type: 'focus',
    durationSeconds: minutes * MIN,
    completedAt: d,
    taskId,
    localDate: stamped ? iso.slice(0, 10) : null,
    localHour: stamped ? d.getUTCHours() : null,
    localWeekday: stamped ? d.getUTCDay() : null,
    localDateApprox: false,
  };
}

async function daily(user: TestUser, goalId: string, tz = 'UTC') {
  const res = await authed(user).get(`/time-report/goals/${goalId}/daily?tz=${encodeURIComponent(tz)}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('GET /time-report/goals/:id/daily', () => {
  it('groups the goal’s sessions by day and matches totalFocusSeconds on /task-goals', async () => {
    const user = await createUser();
    const g = await goal(user);
    const other = await goal(user, 'Other');
    const a = await task(user, 'A', g.id);
    const b = await task(user, 'B', g.id);
    const elsewhere = await task(user, 'C', other.id);
    await prisma.session.createMany({
      data: [
        session(user, '2026-07-02T10:00:00Z', 30, a.id),
        session(user, '2026-07-02T15:00:00Z', 20, b.id),
        session(user, '2026-07-05T10:00:00Z', 45, a.id),
        session(user, '2026-07-05T11:00:00Z', 50, elsewhere.id),
        session(user, '2026-07-06T10:00:00Z', 10, null),
      ],
    });

    const d = await daily(user, g.id);
    expect(d.daily).toEqual([
      { date: '2026-07-02', seconds: 50 * MIN, sessions: 2 },
      { date: '2026-07-05', seconds: 45 * MIN, sessions: 1 },
    ]);
    expect(d.totalSeconds).toBe(95 * MIN);
    expect(d.startDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const goals = await authed(user).get('/task-goals?tz=UTC');
    expect(goals.body.data.find((x: { id: string }) => x.id === g.id).totalFocusSeconds).toBe(d.totalSeconds);
  });

  it('follows a task to its new goal, recurring tasks included', async () => {
    const user = await createUser();
    const from = await goal(user, 'From');
    const to = await goal(user, 'To');
    const mover = await task(user, 'Mover', from.id);
    const habit = await task(user, 'Habit', to.id, true);
    await prisma.session.createMany({
      data: [
        session(user, '2026-07-02T10:00:00Z', 30, mover.id),
        session(user, '2026-07-03T10:00:00Z', 25, habit.id),
      ],
    });

    await prisma.task.update({ where: { id: mover.id }, data: { taskGoalId: to.id } });

    expect((await daily(user, from.id)).daily).toEqual([]);
    expect((await daily(user, to.id)).daily.map((x: { date: string }) => x.date)).toEqual(['2026-07-02', '2026-07-03']);
  });

  it('places an unstamped session on its local day in the requested zone', async () => {
    const user = await createUser();
    const g = await goal(user);
    const t = await task(user, 'Late', g.id);
    // 23:30 on Jul 1 in New York.
    await prisma.session.createMany({ data: [session(user, '2026-07-02T03:30:00Z', 40, t.id, false)] });

    expect((await daily(user, g.id, NY)).daily[0].date).toBe('2026-07-01');
    expect((await daily(user, g.id, 'UTC')).daily[0].date).toBe('2026-07-02');
  });

  it('returns 404 for another user’s goal or an unknown id, and 401 when signed out', async () => {
    const me = await createUser();
    const other = await createUser();
    const theirs = await goal(other);

    expect((await authed(me).get(`/time-report/goals/${theirs.id}/daily`)).status).toBe(404);
    expect((await authed(me).get('/time-report/goals/nope/daily')).status).toBe(404);
    expect((await request(app).get(`/time-report/goals/${theirs.id}/daily`)).status).toBe(401);
  });

  it('falls back to UTC for an unknown zone rather than failing', async () => {
    const user = await createUser();
    const g = await goal(user);
    const d = await daily(user, g.id, 'Not/AZone');
    expect(d.timeZone).toBe('UTC');
    expect(d.daily).toEqual([]);
  });
});
