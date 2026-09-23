import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../index';
import { prisma } from '../prisma';
import { achievements } from '../achievementSeedData';
import { loadAchievementCatalogue } from '../achievementCatalogue';
import { createUser, authed } from '../../test/factories';
import { DEMO_EMAIL_DOMAIN, FRIENDS, GROUP, MAIN_USERNAME } from './content';
import { friendEmail, seedDemoAccount, teardownDemoAccount } from './seed';
import { dateKeyIn } from './time';

/**
 * The demo seed, checked the way the screenshots will see it: through the real
 * routes the app calls, against a real database. Every acceptance item in the
 * brief is one of these assertions, so "the seeded data renders oddly" shows
 * up here first rather than on a phone.
 */

const EMAIL = `demo+screenshots${DEMO_EMAIL_DOMAIN}`;
const PASSWORD = 'demo-password-123';

/**
 * The routes read the real clock, so the seed must too. Pick a zone where it
 * is currently daytime: the seed refuses to run in the small hours, because
 * today's three sessions would not fit before now.
 */
function daytimeZone(now: Date): string {
  const zones = ['Pacific/Honolulu', 'America/Chicago', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland'];
  for (const zone of zones) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 10 && hour < 20) return zone;
  }
  throw new Error('no daytime zone found');
}

async function seed() {
  const timeZone = daytimeZone(new Date());
  const summary = await seedDemoAccount(prisma, { email: EMAIL, password: PASSWORD, timeZone });
  const login = await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  const account = {
    id: login.body.data.user.id as string,
    email: EMAIL,
    username: MAIN_USERNAME,
    password: PASSWORD,
    accessToken: login.body.data.accessToken as string,
    refreshToken: login.body.data.refreshToken as string,
  };
  return { summary, timeZone, account, api: authed(account) };
}

async function demoCounts() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const [sessions, posts, tasks, follows, groups] = await Promise.all([
    prisma.session.count({ where: { userId: { in: ids } } }),
    prisma.socialPost.count({ where: { authorId: { in: ids } } }),
    prisma.task.count({ where: { userId: { in: ids } } }),
    prisma.follow.count({ where: { followerId: { in: ids } } }),
    prisma.studyGroup.count({ where: { createdBy: { in: ids } } }),
  ]);
  return { users: users.length, sessions, posts, tasks, follows, groups };
}

beforeEach(async () => {
  // The integration setup truncates every table; the catalogue is seed data.
  // Reload the in-memory copy too — the server warms it once at boot, and it
  // would otherwise still hold the previous test's ids.
  await prisma.achievement.createMany({ data: achievements });
  await loadAchievementCatalogue();
});

describe('seedDemoAccount — the Focus and Profile screens', () => {
  it('logs in to a 12-day streak with 3 sessions and 1h 40m today, which streak-check keeps', async () => {
    const { api, timeZone, account } = await seed();
    const today = dateKeyIn(new Date(), timeZone);

    const me = await api.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ username: MAIN_USERNAME, currentStreak: 12, longestStreak: 12 });
    expect(me.body.data.termsAcceptedAt).not.toBeNull();

    // The profile totals are the sessions, not a number written beside them.
    const agg = await prisma.session.aggregate({ where: { userId: account.id }, _sum: { durationSeconds: true }, _count: true });
    expect(me.body.data.totalSessions).toBe(agg._count);
    expect(me.body.data.totalFocusTime).toBe(agg._sum.durationSeconds);

    // What the app calls on open. A streak the seed got wrong would reset here.
    const check = await api.post('/auth/me/streak-check').send({ localDate: today });
    expect(check.body.data.currentStreak).toBe(12);

    const sessions = await api.get('/timer/sessions');
    const todays = await prisma.session.findMany({ where: { userId: account.id, localDate: today } });
    expect(todays).toHaveLength(3);
    expect(todays.reduce((sum, s) => sum + s.durationSeconds, 0)).toBe(100 * 60);
    const served = new Set((sessions.body.data.sessions as { id: string }[]).map((s) => s.id));
    for (const s of todays) expect(served.has(s.id)).toBe(true);
  });

  it('shows only achievements the history earned, and none that it earned but left locked', async () => {
    const { api } = await seed();
    const res = await api.get('/achievements');
    expect(res.status).toBe(200);

    const list = res.body.data as { key: string; isUnlocked: boolean; progress: number; currentValue: number; threshold: number }[];
    const unlocked = list.filter((a) => a.isUnlocked).map((a) => a.key);
    expect(unlocked).toEqual(expect.arrayContaining(['streak_7', 'sessions_50', 'focus_600', 'social-butterfly']));
    expect(unlocked).not.toContain('streak_14');

    // The route recomputes progress from the live counters. A locked
    // achievement at 100% is two screens disagreeing.
    const earnedButLocked = list.filter((a) => !a.isUnlocked && a.progress >= 1);
    expect(earnedButLocked.map((a) => a.key)).toEqual([]);
  });
});

describe('seedDemoAccount — the Tasks screen', () => {
  it('fills Due Soon with real deadlines, keeps habits off it, and gives the goals part-done progress', async () => {
    const { api, timeZone } = await seed();
    const res = await api.get('/tasks');
    expect(res.status).toBe(200);

    const tasks = res.body.data as {
      title: string; dueDate: string | null; isCompleted: boolean; parentTaskId: string | null;
      sessionsOnTask: number; estimatedMinutes: number | null; totalTimeOnTask: number;
    }[];
    const today = Date.parse(dateKeyIn(new Date(), timeZone));
    const daysLeft = (t: { dueDate: string | null }) => (t.dueDate ? Math.round((Date.parse(t.dueDate.slice(0, 10)) - today) / 86_400_000) : null);

    const dueSoon = tasks.filter((t) => !t.isCompleted && daysLeft(t) !== null && daysLeft(t)! >= 0 && daysLeft(t)! <= 2);
    expect(dueSoon.map((t) => t.title).sort()).toEqual([
      'Build iOS Live Activity for the focus timer',
      'Write integration tests for the auth routes',
      'Write the LinkedIn launch post for Ascend',
    ]);

    // Today's habit instances are done, so none of them competes for a slot.
    const habitsToday = tasks.filter((t) => t.parentTaskId);
    expect(habitsToday.length).toBeGreaterThan(0);
    expect(habitsToday.every((t) => t.isCompleted)).toBe(true);

    const live = tasks.find((t) => t.title.startsWith('Build iOS Live Activity'))!;
    expect(live).toMatchObject({ sessionsOnTask: 1, estimatedMinutes: 200, totalTimeOnTask: 50 * 60 });

    for (const t of tasks) {
      expect(Number.isFinite(t.totalTimeOnTask)).toBe(true);
      expect(t.totalTimeOnTask).toBeGreaterThanOrEqual(0);
    }

    const goals = await api.get('/task-goals');
    const progress = (goals.body.data as { title: string; overallProgress: number }[]).map((g) => g.overallProgress);
    expect(progress).toHaveLength(2);
    for (const p of progress) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe('seedDemoAccount — the Social screen', () => {
  it('puts the account 2nd or 3rd on its Friends board, never 1st', async () => {
    const { api, summary } = await seed();
    const res = await api.get('/social/focus-leaderboard?scope=friends&period=all_time');
    expect(res.status).toBe(200);

    const entries = res.body.data.entries as { displayName: string; isMe: boolean }[];
    expect(entries).toHaveLength(FRIENDS.length + 1);
    const position = entries.findIndex((e) => e.isMe) + 1;
    expect(position).toBeGreaterThanOrEqual(2);
    expect(position).toBeLessThanOrEqual(3);
    expect(entries.map((e) => e.displayName)).toEqual(summary.leaderboard.map((r) => r.username));
  });

  it('shows recaps whose numbers match the day they describe, each with 1-6 reactions', async () => {
    const { api } = await seed();
    const res = await api.get('/social/posts?scope=public');
    expect(res.status).toBe(200);

    const posts = res.body.data.posts as {
      authorId: string; type: string; caption: string; sessionCount: number; focusMinutes: number;
      reactions: Record<string, string[]>; localDate?: string; createdAt: string;
    }[];
    const recaps = posts.filter((p) => p.type === 'session_recap');
    expect(recaps.length).toBeGreaterThanOrEqual(8);

    const main = await prisma.user.findUniqueOrThrow({ where: { username: MAIN_USERNAME } });
    expect(recaps.filter((p) => p.authorId === main.id)).toHaveLength(2);

    for (const p of recaps) {
      const total = Object.values(p.reactions).reduce((sum, ids) => sum + ids.length, 0);
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(6);
      // Nobody reacts to their own post.
      expect(Object.values(p.reactions).flat()).not.toContain(p.authorId);

      // The sessions behind the card, counted from the table.
      const before = new Date(p.createdAt);
      const author = await prisma.user.findUniqueOrThrow({ where: { id: p.authorId } });
      const last = await prisma.session.findFirstOrThrow({ where: { userId: author.id, completedAt: { lt: before } }, orderBy: { completedAt: 'desc' } });
      const day = await prisma.session.findMany({ where: { userId: author.id, localDate: last.localDate } });
      expect(day).toHaveLength(p.sessionCount);
      expect(day.reduce((sum, s) => sum + s.durationSeconds, 0)).toBe(p.focusMinutes * 60);
    }
  });

  it('keeps the friends’ profiles closed, and the group private to its members', async () => {
    const { api } = await seed();
    const friend = await prisma.user.findUniqueOrThrow({ where: { email: friendEmail('priya_codes') } });
    expect((await api.get(`/social/users/${friend.id}`)).status).toBe(403);

    const group = await prisma.studyGroup.findFirstOrThrow({ where: { name: GROUP.name }, include: { members: true } });
    expect(group.members).toHaveLength(GROUP.members.length + 1);
    const outsider = await createUser();
    expect((await authed(outsider).get(`/social/groups/${group.id}`)).status).toBe(404);
  });
});

describe('seedDemoAccount — re-running and tearing down', () => {
  it('rebuilds on a second run without duplicating anything', async () => {
    await seed();
    const first = await demoCounts();
    await seed();
    expect(await demoCounts()).toEqual(first);
    expect(first.users).toBe(FRIENDS.length + 1);
  });

  it('removes every demo row, and scrubs demo reactions from a real user’s post', async () => {
    await seed();
    const real = await createUser();
    const realPost = await prisma.socialPost.create({ data: { authorId: real.id, type: 'free_post', caption: 'real', visibility: 'public' } });
    const demo = await prisma.user.findUniqueOrThrow({ where: { username: MAIN_USERNAME } });
    await prisma.socialPost.update({ where: { id: realPost.id }, data: { reactions: { '🔥': [demo.id, real.id], '💪': [demo.id] } } });

    const removed = await teardownDemoAccount(prisma);
    expect(removed).toHaveLength(FRIENDS.length + 1);
    expect(await demoCounts()).toEqual({ users: 0, sessions: 0, posts: 0, tasks: 0, follows: 0, groups: 0 });

    const after = await prisma.socialPost.findUniqueOrThrow({ where: { id: realPost.id } });
    expect(after.reactions).toEqual({ '🔥': [real.id] });
    expect(await prisma.user.count({ where: { id: real.id } })).toBe(1);
  });

  it('refuses an email the teardown could not find, and writes nothing', async () => {
    await expect(
      seedDemoAccount(prisma, { email: 'someone@example.com', password: PASSWORD, timeZone: daytimeZone(new Date()) }),
    ).rejects.toThrow(DEMO_EMAIL_DOMAIN);
    expect(await demoCounts()).toMatchObject({ users: 0 });
  });

  it('leaves the previous seed untouched when a run fails part-way', async () => {
    await seed();
    // A real account takes a friend's username, so the rebuild fails part-way
    // through the transaction — after it has already deleted the old rows.
    await prisma.user.update({ where: { email: friendEmail('marcus.builds') }, data: { username: 'marcus.old' } });
    await createUser({ username: 'marcus.builds', email: 'marcus@example.com' });
    const before = await demoCounts();

    await expect(
      seedDemoAccount(prisma, { email: EMAIL, password: PASSWORD, timeZone: daytimeZone(new Date()) }),
    ).rejects.toThrow();
    expect(await demoCounts()).toEqual(before);
    expect(before.users).toBe(FRIENDS.length + 1);
  });
});
