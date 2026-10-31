import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * GET /time-report/sessions — the sessions behind a /time-report row.
 *
 * The contract that matters: for the same window and zone, a goal or task
 * row's seconds in /time-report equal this route's total, including the two
 * "none" groups, because both read the same rows by the same rules.
 */

const MIN = 60;
const FROM = '2026-07-01';
const TO = '2026-07-07';
const NY = 'America/New_York';

async function goal(user: TestUser, title: string) {
  return prisma.taskGoal.create({ data: { userId: user.id, title } });
}

async function task(user: TestUser, title: string, taskGoalId: string | null = null) {
  return prisma.task.create({ data: { userId: user.id, title, taskGoalId } });
}

function session(user: TestUser, iso: string, minutes: number, taskId: string | null, stamped = true) {
  const d = new Date(iso);
  return {
    userId: user.id,
    type: 'focus',
    durationSeconds: minutes * MIN,
    completedAt: d,
    taskId,
    taskTitleSnapshot: taskId ? 'Snapshot title' : null,
    localDate: stamped ? iso.slice(0, 10) : null,
    localHour: stamped ? d.getUTCHours() : null,
    localWeekday: stamped ? d.getUTCDay() : null,
    localDateApprox: false,
  };
}

async function drill(user: TestUser, query: string, tz = 'UTC') {
  const res = await authed(user).get(`/time-report/sessions?from=${FROM}&to=${TO}&tz=${encodeURIComponent(tz)}&${query}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function report(user: TestUser, tz = 'UTC') {
  const res = await authed(user).get(`/time-report?from=${FROM}&to=${TO}&tz=${encodeURIComponent(tz)}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('GET /time-report/sessions — reconciles with /time-report', () => {
  it('matches every goal row, task row and both none groups', async () => {
    const user = await createUser();
    const g1 = await goal(user, 'Launch');
    const g2 = await goal(user, 'Learn');
    const t1 = await task(user, 'Landing page', g1.id);
    const t2 = await task(user, 'Docs', g1.id);
    const t3 = await task(user, 'Course', g2.id);
    const t4 = await task(user, 'Loose task');
    await prisma.session.createMany({
      data: [
        session(user, '2026-07-02T10:00:00Z', 30, t1.id),
        session(user, '2026-07-03T10:00:00Z', 20, t2.id),
        session(user, '2026-07-03T11:00:00Z', 45, t3.id),
        session(user, '2026-07-04T10:00:00Z', 15, t4.id),
        session(user, '2026-07-05T10:00:00Z', 10, null),
        // Outside the window: must be in neither.
        session(user, '2026-07-09T10:00:00Z', 99, t1.id),
      ],
    });

    const r = await report(user);
    for (const g of r.goals as { goalId: string; seconds: number; sessions: number }[]) {
      const d = await drill(user, `by=goal&key=${g.goalId}`);
      expect(d.totals).toEqual({ seconds: g.seconds, sessions: g.sessions });
    }
    for (const t of r.tasks as { taskId: string; seconds: number; sessions: number }[]) {
      const d = await drill(user, `by=task&key=${t.taskId}`);
      expect(d.totals).toEqual({ seconds: t.seconds, sessions: t.sessions });
    }
    expect((await drill(user, 'by=goal&none=true')).totals.seconds).toBe(r.intent.unlinkedSeconds);
    expect((await drill(user, 'by=task&none=true')).totals.seconds).toBe(r.unattributedSeconds);
    expect((await drill(user, `by=goal&key=${g1.id}`)).totals.seconds).toBe(50 * MIN);
  });

  it('follows a task to its new goal, old sessions included', async () => {
    const user = await createUser();
    const a = await goal(user, 'A');
    const b = await goal(user, 'B');
    const t = await task(user, 'Mover', a.id);
    await prisma.session.createMany({ data: [session(user, '2026-07-02T10:00:00Z', 30, t.id)] });

    await prisma.task.update({ where: { id: t.id }, data: { taskGoalId: b.id } });

    expect((await drill(user, `by=goal&key=${a.id}`)).totals.seconds).toBe(0);
    expect((await drill(user, `by=goal&key=${b.id}`)).totals.seconds).toBe(30 * MIN);
    expect(((await report(user)).goals as { goalId: string; seconds: number }[])
      .find((g) => g.goalId === b.id)?.seconds).toBe(30 * MIN);
  });

  it('files an unstamped row by its local day in the requested zone, exactly as the report does', async () => {
    const user = await createUser();
    const t = await task(user, 'Late night');
    // 23:30 on Jun 30 in New York (outside), and 23:30 on Jul 7 (inside).
    await prisma.session.createMany({
      data: [
        session(user, '2026-07-01T03:30:00Z', 25, t.id, false),
        session(user, '2026-07-08T03:30:00Z', 35, t.id, false),
      ],
    });

    const d = await drill(user, `by=task&key=${t.id}`, NY);
    expect(d.totals).toEqual({ seconds: 35 * MIN, sessions: 1 });
    expect(d.sessions[0].localDate).toBe('2026-07-07');
    expect(d.sessions[0].approximateDay).toBe(true);
    const r = await report(user, NY);
    expect(r.tasks[0].seconds).toBe(35 * MIN);
  });
});

describe('GET /time-report/sessions — paging', () => {
  it('pages newest first with no repeats, even when timestamps tie', async () => {
    const user = await createUser();
    const t = await task(user, 'Busy');
    await prisma.session.createMany({
      data: [
        ...Array.from({ length: 4 }, () => session(user, '2026-07-03T10:00:00Z', 5, t.id)),
        ...Array.from({ length: 3 }, (_, i) => session(user, `2026-07-0${4 + i}T10:00:00Z`, 5, t.id)),
      ],
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `by=task&key=${t.id}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const d = await drill(user, q);
      seen.push(...d.sessions.map((s: { id: string }) => s.id));
      expect(d.totals.sessions).toBe(7);
      cursor = d.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    const first = await drill(user, `by=task&key=${t.id}`);
    const times = first.sessions.map((s: { completedAt: string }) => s.completedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('GET /time-report/sessions — validation and scope', () => {
  it('rejects malformed requests with 400', async () => {
    const user = await createUser();
    const bad = [
      `by=goal&key=x&none=true&from=${FROM}&to=${TO}`,
      `by=goal&from=${FROM}&to=${TO}`,
      `by=tag&key=x&from=${FROM}&to=${TO}`,
      `by=task&key=x&from=${TO}&to=${FROM}`,
      'by=task&key=x&from=2024-01-01&to=2026-01-01',
      `by=task&key=x&from=${FROM}&to=${TO}&limit=101`,
      `by=task&key=x&from=${FROM}&to=${TO}&cursor=nope`,
      'by=task&key=x&from=July&to=August',
    ];
    for (const q of bad) {
      const res = await authed(user).get(`/time-report/sessions?${q}`);
      expect([q, res.status]).toEqual([q, 400]);
    }
  });

  it('returns an empty list for an unknown key, and never another user’s sessions', async () => {
    const me = await createUser();
    const other = await createUser();
    const theirs = await task(other, 'Theirs');
    await prisma.session.createMany({ data: [session(other, '2026-07-02T10:00:00Z', 30, theirs.id)] });

    expect((await drill(me, 'by=task&key=does-not-exist')).totals).toEqual({ seconds: 0, sessions: 0 });
    expect((await drill(me, `by=task&key=${theirs.id}`)).sessions).toEqual([]);
    expect((await drill(me, 'by=task&none=true')).sessions).toEqual([]);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).get(`/time-report/sessions?by=task&none=true&from=${FROM}&to=${TO}`);
    expect(res.status).toBe(401);
  });
});

/**
 * Timeline mode: no `by`. Every focus session in the range, oldest first,
 * placed on its local day for the calendar's plan-vs-actual overlay.
 */
describe('GET /time-report/sessions — timeline mode', () => {
  async function timeline(user: TestUser, from: string, to: string, tz = 'UTC') {
    const res = await authed(user).get(`/time-report/sessions?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`);
    expect(res.status).toBe(200);
    return res.body.data as {
      truncated: boolean;
      sessions: {
        id: string; clientSessionId: string | null; localDate: string; taskId: string | null;
        approximateDay: boolean; startLocalMinutes: number; endLocalMinutes: number;
      }[];
    };
  }

  it('returns only the caller’s focus sessions in range, oldest first, positioned on the day', async () => {
    const me = await createUser();
    const other = await createUser();
    const t = await task(me, 'Case study');
    await prisma.session.createMany({
      data: [
        { ...session(me, '2026-07-03T10:31:00Z', 27, t.id), clientSessionId: '11111111-1111-4111-8111-111111111111' },
        session(me, '2026-07-02T09:47:00Z', 25, t.id),
        { ...session(me, '2026-07-02T11:00:00Z', 5, t.id), type: 'shortBreak' },
        session(me, '2026-07-09T10:00:00Z', 30, t.id),
        session(other, '2026-07-02T10:00:00Z', 30, null),
      ],
    });

    const d = await timeline(me, FROM, TO);
    expect(d.truncated).toBe(false);
    expect(d.sessions.map((s) => s.localDate)).toEqual(['2026-07-02', '2026-07-03']);
    expect(d.sessions[0]).toMatchObject({ startLocalMinutes: 9 * 60 + 22, endLocalMinutes: 9 * 60 + 47, clientSessionId: null });
    expect(d.sessions[1]).toMatchObject({
      startLocalMinutes: 10 * 60 + 4,
      endLocalMinutes: 10 * 60 + 31,
      clientSessionId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('keeps the frozen day and hour of a session saved in another zone, and clips at midnight', async () => {
    const user = await createUser();
    // Finished 00:10 on Jul 3 where it was saved (stamped), viewed from New York,
    // where the same instant is 20:10 on Jul 2.
    await prisma.session.createMany({
      data: [{
        ...session(user, '2026-07-03T00:10:00Z', 25, null),
        localDate: '2026-07-03', localHour: 0, localWeekday: 5,
      }],
    });

    const [s] = (await timeline(user, FROM, TO, NY)).sessions;
    expect(s.localDate).toBe('2026-07-03');
    expect(s).toMatchObject({ startLocalMinutes: 0, endLocalMinutes: 10, approximateDay: false });
  });

  it('places an unstamped row in the requested zone, exactly as the drill-down files it', async () => {
    const user = await createUser();
    const t = await task(user, 'Late night');
    await prisma.session.createMany({ data: [session(user, '2026-07-08T03:30:00Z', 35, t.id, false)] });

    const [s] = (await timeline(user, FROM, TO, NY)).sessions;
    expect(s).toMatchObject({ localDate: '2026-07-07', approximateDay: true, endLocalMinutes: 23 * 60 + 30 });
    expect((await drill(user, `by=task&key=${t.id}`, NY)).sessions[0].localDate).toBe(s.localDate);
  });

  it('rejects drill-down parameters, long or backwards ranges with 400', async () => {
    const user = await createUser();
    const bad = [
      `key=x&from=${FROM}&to=${TO}`,
      `none=true&from=${FROM}&to=${TO}`,
      `cursor=x&from=${FROM}&to=${TO}`,
      `limit=5&from=${FROM}&to=${TO}`,
      'from=2026-07-01&to=2026-08-01',
      `from=${TO}&to=${FROM}`,
      'from=July&to=August',
    ];
    for (const q of bad) {
      const res = await authed(user).get(`/time-report/sessions?${q}`);
      expect([q, res.status]).toEqual([q, 400]);
    }
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).get(`/time-report/sessions?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(401);
  });
});
