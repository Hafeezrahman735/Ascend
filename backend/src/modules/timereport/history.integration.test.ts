import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * GET /time-report/history and the /time-report additions (daily series,
 * remainder row for tasks past the top list, explicit truncation).
 *
 * History is grouped in SQL, so it must (a) be complete however many sessions
 * there are and (b) put every session on the same local day /time-report
 * does, including approximate legacy rows near midnight and across DST.
 */

const MIN = 60;
const NY = 'America/New_York';

/** A focus session written directly, so its instant and stamp can be anything. */
function row(user: TestUser, iso: string, minutes: number, stamp: Partial<{
  localDate: string | null; localHour: number | null; localWeekday: number | null; localDateApprox: boolean; taskId: string | null;
}> = {}) {
  return {
    userId: user.id,
    type: 'focus',
    durationSeconds: minutes * MIN,
    completedAt: new Date(iso),
    localDate: null,
    localHour: null,
    localWeekday: null,
    localDateApprox: false,
    ...stamp,
  };
}

async function history(user: TestUser, tz = NY) {
  const res = await authed(user).get(`/time-report/history?tz=${encodeURIComponent(tz)}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function report(user: TestUser, from: string, to: string, tz = NY) {
  const res = await authed(user).get(`/time-report?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('GET /time-report/history', () => {
  it('totals every session by local day, month and all time', async () => {
    const user = await createUser();
    await prisma.session.createMany({
      data: [
        row(user, '2026-01-10T15:00:00Z', 30, { localDate: '2026-01-10', localHour: 10, localWeekday: 6 }),
        row(user, '2026-01-10T18:00:00Z', 20, { localDate: '2026-01-10', localHour: 13, localWeekday: 6 }),
        row(user, '2026-02-02T15:00:00Z', 45, { localDate: '2026-02-02', localHour: 10, localWeekday: 1 }),
      ],
    });

    const h = await history(user);

    expect(h.allTime).toEqual({ seconds: 95 * MIN, sessions: 3, activeDays: 2, firstDate: '2026-01-10' });
    expect(h.daily).toEqual([
      { date: '2026-01-10', seconds: 50 * MIN, sessions: 2 },
      { date: '2026-02-02', seconds: 45 * MIN, sessions: 1 },
    ]);
    expect(h.monthly).toEqual([
      { month: '2026-01', seconds: 50 * MIN, sessions: 2 },
      { month: '2026-02', seconds: 45 * MIN, sessions: 1 },
    ]);
  });

  it('puts approximate rows on the same local day as /time-report, near midnight and across DST', async () => {
    const user = await createUser();
    await prisma.session.createMany({
      data: [
        // 23:30 in New York on Mar 7, but a UTC-guessed stamp of Mar 8.
        row(user, '2026-03-08T04:30:00Z', 25, { localDate: '2026-03-08', localHour: 4, localWeekday: 0, localDateApprox: true }),
        // DST starts Mar 8: 01:59 EST, then 03:00 EDT. Unstamped rows either side.
        row(user, '2026-03-08T06:59:00Z', 15),
        row(user, '2026-03-08T07:00:00Z', 15),
        // DST ends Nov 1: 00:30 EDT on Nov 1 is 04:30 UTC.
        row(user, '2026-11-01T04:30:00Z', 40, { localDateApprox: true, localDate: '2026-11-01', localHour: 4, localWeekday: 0 }),
        // 23:59 in New York on Oct 31.
        row(user, '2026-11-01T03:59:00Z', 10),
        // An exact stamp is kept as stamped, whatever the instant says.
        row(user, '2026-03-09T02:00:00Z', 5, { localDate: '2026-03-09', localHour: 22, localWeekday: 1 }),
      ],
    });

    const h = await history(user);
    const byDay = new Map<string, number>(h.daily.map((d: { date: string; seconds: number }) => [d.date, d.seconds]));
    expect(byDay.get('2026-03-07')).toBe(25 * MIN);
    expect(byDay.get('2026-03-08')).toBe(30 * MIN);
    expect(byDay.get('2026-03-09')).toBe(5 * MIN);
    expect(byDay.get('2026-10-31')).toBe(10 * MIN);
    expect(byDay.get('2026-11-01')).toBe(40 * MIN);

    for (const [from, to] of [['2026-03-05', '2026-03-12'], ['2026-10-28', '2026-11-04']]) {
      const r = await report(user, from, to);
      for (const d of r.series.daily as { date: string; seconds: number }[]) {
        expect([d.date, d.seconds]).toEqual([d.date, byDay.get(d.date) ?? 0]);
      }
    }
  });

  it('follows the requested zone, so the same sessions move day with it', async () => {
    const user = await createUser();
    await prisma.session.createMany({ data: [row(user, '2026-05-01T02:00:00Z', 30)] });

    expect((await history(user, NY)).daily[0].date).toBe('2026-04-30');
    expect((await history(user, 'Asia/Tokyo')).daily[0].date).toBe('2026-05-01');
  });

  it('stays complete past the 20,000-session cap that /time-report flags', async () => {
    const user = await createUser();
    const count = 20_050;
    const base = Date.parse('2026-06-15T12:00:00Z');
    await prisma.session.createMany({
      data: Array.from({ length: count }, (_, i) => row(user, new Date(base + i * 1000).toISOString(), 1)),
    });

    const h = await history(user, 'UTC');
    expect(h.allTime.sessions).toBe(count);
    expect(h.allTime.seconds).toBe(count * MIN);

    const r = await report(user, '2026-06-15', '2026-06-15', 'UTC');
    expect(r.truncated).toBe(true);
  });

  it('is empty, not an error, for a user with no sessions', async () => {
    const user = await createUser();
    const h = await history(user);
    expect(h.allTime).toEqual({ seconds: 0, sessions: 0, activeDays: 0, firstDate: null });
    expect(h.daily).toEqual([]);
    expect(h.monthly).toEqual([]);
  });

  it('counts only focus sessions, and only the caller’s', async () => {
    const me = await createUser();
    const other = await createUser();
    await prisma.session.createMany({
      data: [
        row(me, '2026-04-01T12:00:00Z', 30),
        { ...row(me, '2026-04-01T13:00:00Z', 5), type: 'short_break' },
        row(other, '2026-04-01T12:00:00Z', 90),
      ],
    });

    expect((await history(me, 'UTC')).allTime.seconds).toBe(30 * MIN);
  });

  it('falls back to UTC for an unknown zone and rejects an oversized one', async () => {
    const user = await createUser();
    expect((await history(user, 'Not/AZone')).timeZone).toBe('UTC');
    const res = await authed(user).get(`/time-report/history?tz=${'x'.repeat(65)}`);
    expect(res.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    expect((await request(app).get('/time-report/history')).status).toBe(401);
  });
});

describe('GET /time-report additions', () => {
  it('returns a zero-filled daily series that adds up to the total', async () => {
    const user = await createUser();
    await prisma.session.createMany({
      data: [
        row(user, '2026-07-02T12:00:00Z', 30, { localDate: '2026-07-02', localHour: 12, localWeekday: 4 }),
        row(user, '2026-07-04T12:00:00Z', 20, { localDate: '2026-07-04', localHour: 12, localWeekday: 6 }),
      ],
    });

    const r = await report(user, '2026-07-01', '2026-07-05', 'UTC');

    expect(r.series.daily.map((d: { date: string }) => d.date)).toEqual([
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
    expect(r.series.daily.map((d: { seconds: number }) => d.seconds)).toEqual([0, 30 * MIN, 0, 20 * MIN, 0]);
    expect(r.series.daily.reduce((sum: number, d: { seconds: number }) => sum + d.seconds, 0)).toBe(r.totals.seconds);
    expect(r.truncated).toBe(false);
  });

  it('adds a remainder row so the task list accounts for all task time', async () => {
    const user = await createUser();
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      prisma.task.create({ data: { userId: user.id, title: `Task ${i}` } })));
    await prisma.session.createMany({
      data: tasks.map((t, i) => row(user, '2026-07-02T12:00:00Z', i + 1,
        { taskId: t.id, localDate: '2026-07-02', localHour: 12, localWeekday: 4 })),
    });

    const r = await report(user, '2026-07-01', '2026-07-05', 'UTC');

    expect(r.tasks).toHaveLength(10);
    // The two smallest, 1 and 2 minutes, fall outside the top ten.
    expect(r.tasksOther).toEqual({ count: 2, seconds: 3 * MIN, sessions: 2 });
    const listed = r.tasks.reduce((sum: number, t: { seconds: number }) => sum + t.seconds, 0);
    expect(listed + r.tasksOther.seconds + r.unattributedSeconds).toBe(r.totals.seconds);
  });
});
