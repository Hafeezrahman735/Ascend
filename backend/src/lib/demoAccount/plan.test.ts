import { describe, it, expect } from 'vitest';
import { achievements } from '../achievementSeedData';
import { dayNameFromLocalDate } from '../localDate';
import { FRIENDS, GOALS, HABITS, TASKS } from './content';
import {
  ARCHIVE_DAYS, DayTooShortError, MAIN_HISTORY_DAYS, archiveSessionsByDay, calendarEvents, checkPlan, deriveUnlocks,
  habitEndDate, leaderboardOf, planFriend, planMain, sumMinutes,
} from './plan';
import { checkDemoTarget } from './target';
import { dateKeyIn, shiftDateKey, streaksFrom, zonedInstant } from './time';

/**
 * The demo account exists to be screenshotted, so these pin the things a
 * screenshot would show: the streak, today's total, the podium, and that no
 * two screens can disagree about any of them.
 */

const CHICAGO = 'America/Chicago';

// A spread of run times, including across the Chicago DST change on Nov 1st.
const RUNS: { label: string; now: Date; timeZone: string }[] = [
  { label: 'midday Chicago', now: new Date('2026-09-23T17:05:00Z'), timeZone: CHICAGO },
  { label: 'late evening Chicago', now: new Date('2026-09-24T04:40:00Z'), timeZone: CHICAGO },
  { label: 'early morning Chicago', now: new Date('2026-09-23T11:15:00Z'), timeZone: CHICAGO },
  { label: 'the day after DST ends', now: new Date('2026-11-02T18:00:00Z'), timeZone: CHICAGO },
  { label: 'midday Kolkata', now: new Date('2026-09-23T07:00:00Z'), timeZone: 'Asia/Kolkata' },
  // Habit completion days move with the weekday, and so does how the history
  // is shared out between tasks and habits. Cover all seven.
  ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({
    label: `weekday ${d}`,
    now: new Date(Date.UTC(2026, 8, 20 + d, 19, 0)),
    timeZone: CHICAGO,
  })),
];

describe('time helpers', () => {
  it('zonedInstant reads back as the wall clock it was built from, across DST', () => {
    for (const [dateKey, hour] of [['2026-09-23', 21], ['2026-11-01', 1], ['2026-11-01', 23], ['2026-03-08', 12]] as const) {
      const instant = zonedInstant(dateKey, hour, 30, CHICAGO);
      expect(dateKeyIn(instant, CHICAGO)).toBe(dateKey);
      const shown = new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
      expect(shown).toBe(`${String(hour).padStart(2, '0')}:30`);
    }
  });

  it('streaksFrom keeps a run that ended yesterday, as streak-check does, and drops an older one', () => {
    const days = ['2026-09-10', '2026-09-11', '2026-09-20', '2026-09-21', '2026-09-22'];
    expect(streaksFrom(days, '2026-09-23')).toEqual({ current: 3, longest: 3, lastActive: '2026-09-22' });
    expect(streaksFrom(days, '2026-09-24').current).toBe(0);
    expect(streaksFrom([], '2026-09-23')).toEqual({ current: 0, longest: 0, lastActive: null });
  });
});

describe.each(RUNS)('planMain — $label', ({ now, timeZone }) => {
  const main = planMain(now, timeZone);
  const today = main.sessions.filter((s) => s.dateKey === main.today);

  it('has a 12-day streak ending today, and it is the longest run', () => {
    const streak = streaksFrom(main.sessions.map((s) => s.dateKey), main.today);
    expect(streak).toMatchObject({ current: 12, longest: 12, lastActive: main.today });
  });

  it('puts exactly 3 sessions and 1h 40m on today, all already finished', () => {
    expect(today).toHaveLength(3);
    expect(sumMinutes(today)).toBe(100);
    for (const s of today) {
      expect(dateKeyIn(s.startedAt, timeZone)).toBe(main.today);
      expect(s.completedAt.getTime()).toBeLessThan(now.getTime());
    }
  });

  it('never schedules a session in the future or overlapping another', () => {
    const sorted = [...main.sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (const [i, s] of sorted.entries()) {
      expect(s.completedAt.getTime()).toBeLessThan(now.getTime());
      expect(s.completedAt.getTime() - s.startedAt.getTime()).toBe(s.minutes * 60_000);
      expect(dateKeyIn(s.completedAt, timeZone)).toBe(s.dateKey);
      if (i > 0) expect(s.startedAt.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].completedAt.getTime());
    }
  });

  it('only puts work on a task between its creation and its completion', () => {
    for (const t of TASKS) {
      const on = main.sessions.filter((s) => s.strand.kind === 'task' && s.strand.key === t.key);
      const daysAgo = (dateKey: string) =>
        Math.round((Date.parse(main.today) - Date.parse(dateKey)) / 86_400_000);
      for (const s of on) {
        expect(daysAgo(s.dateKey)).toBeLessThanOrEqual(t.createdDaysAgo);
        if (t.completedDaysAgo !== undefined) expect(daysAgo(s.dateKey)).toBeGreaterThanOrEqual(t.completedDaysAgo);
      }
      // Nothing finished without time behind it.
      if (t.completedDaysAgo !== undefined) expect(on.length).toBeGreaterThan(0);
    }
  });

  it('keeps every task within its session estimate, and open ones short of it', () => {
    // An uncapped generator once put 10 sessions on a 3-session task — a
    // progress bar at 333% on the Tasks screen.
    for (const t of TASKS) {
      const on = main.sessions.filter((s) => s.strand.kind === 'task' && s.strand.key === t.key).length;
      expect(on).toBeLessThanOrEqual(t.estSessions);
      if (t.completedDaysAgo === undefined) expect(on).toBeLessThan(t.estSessions);
    }
  });

  it('gives the Live Activity exactly its one session today, ~25% of a 4-session estimate', () => {
    const live = main.sessions.filter((s) => s.strand.kind === 'task' && s.strand.key === 'live-activity');
    expect(live).toHaveLength(1);
    expect(live[0].dateKey).toBe(main.today);
  });

  it('only logs habit time on days the habit was done', () => {
    for (const s of main.sessions) {
      if (s.strand.kind !== 'habit') continue;
      expect(main.habits.get(s.strand.key)!.completedOn).toContain(s.dateKey);
    }
  });

  it('ranks the account on the podium but not first, which the seed also enforces', () => {
    const board = leaderboardOf(main, FRIENDS.map((f) => planFriend(f, now, timeZone)));
    const position = board.findIndex((r) => r.username === 'test_user_1') + 1;
    expect(position).toBeGreaterThanOrEqual(2);
    expect(position).toBeLessThanOrEqual(3);
    expect(() => checkPlan(main, board)).not.toThrow();
  });
});

describe('habit streaks', () => {
  const main = planMain(new Date('2026-09-23T17:05:00Z'), CHICAGO);

  it('matches the brief: reading 12 days, LeetCode 8 weekdays, done today except the one left open', () => {
    expect(main.habits.get('reading')).toMatchObject({ currentStreak: 12, scheduledToday: true });
    expect(main.habits.get('leetcode')).toMatchObject({ currentStreak: 8, scheduledToday: true });
    for (const h of main.habits.values()) {
      if (h.scheduledToday && !h.pendingToday) expect(h.completedOn[0]).toBe(main.today);
    }
  });
});

describe.each(RUNS)('three months of history — $label', ({ now, timeZone }) => {
  const main = planMain(now, timeZone);
  const daysAgo = (dateKey: string) => Math.round((Date.parse(main.today) - Date.parse(dateKey)) / 86_400_000);

  it('reaches back about three months, and no further', () => {
    const oldest = Math.max(...main.sessions.map((s) => daysAgo(s.dateKey)));
    expect(oldest).toBeGreaterThanOrEqual(ARCHIVE_DAYS - 15);
    expect(oldest).toBeLessThan(ARCHIVE_DAYS);
  });

  it('rests on the day before the hand-shaped weeks, and never runs 12 days in the generated ones', () => {
    expect(main.sessions.some((s) => daysAgo(s.dateKey) === MAIN_HISTORY_DAYS)).toBe(false);
    const counts = archiveSessionsByDay(main.today);
    let run = 0;
    for (let d = ARCHIVE_DAYS - 1; d > MAIN_HISTORY_DAYS; d -= 1) {
      run = counts.has(d) ? run + 1 : 0;
      expect(run).toBeLessThan(12);
    }
  });

  it('never runs 8 sessions in a day, which would unlock Speed Runner', () => {
    const perDay = new Map<string, number>();
    for (const s of main.sessions) perDay.set(s.dateKey, (perDay.get(s.dateKey) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThan(8);
  });
});

describe('goals', () => {
  it('start no later than any task or recurring task on them', () => {
    for (const g of GOALS) {
      for (const t of TASKS.filter((t) => t.goal === g.key)) expect(t.createdDaysAgo).toBeLessThanOrEqual(g.createdDaysAgo);
      for (const h of HABITS.filter((h) => h.goal === g.key)) expect(h.startedDaysAgo).toBeLessThanOrEqual(g.createdDaysAgo);
    }
  });

  it('finish only after every task on them, and only when nothing recurring still counts', () => {
    for (const g of GOALS.filter((g) => g.completedDaysAgo !== undefined)) {
      for (const t of TASKS.filter((t) => t.goal === g.key)) {
        expect(t.completedDaysAgo).toBeDefined();
        expect(t.completedDaysAgo!).toBeGreaterThanOrEqual(g.completedDaysAgo!);
      }
      expect(HABITS.some((h) => h.goal === g.key)).toBe(false);
    }
  });

  it('cover each shape the Goals lens draws', () => {
    const open = GOALS.filter((g) => g.completedDaysAgo === undefined);
    expect(open.some((g) => g.plannedHours && g.deadlineInDays !== undefined)).toBe(true);
    expect(open.some((g) => g.plannedHours && g.deadlineInDays === undefined)).toBe(true);
    expect(open.some((g) => !g.plannedHours)).toBe(true);
    expect(GOALS.some((g) => g.completedDaysAgo !== undefined)).toBe(true);
  });
});

describe.each(RUNS)('recurring tasks — $label', ({ now, timeZone }) => {
  const main = planMain(now, timeZone);
  const history = (key: Parameters<typeof main.habits.get>[0]) => main.habits.get(key)!;

  it('leaves the open one undone today without breaking its streak', () => {
    const plan = history('plan-tomorrow');
    expect(plan).toMatchObject({ scheduledToday: true, pendingToday: true, currentStreak: 2 });
    expect(plan.completedOn).not.toContain(main.today);
  });

  it('counts the streak of the one missed yesterday from today', () => {
    expect(history('sql-challenge')).toMatchObject({ scheduledToday: true, pendingToday: false, currentStreak: 1 });
  });

  it('never completes an ended one after its end date, nor today', () => {
    const spec = HABITS.find((h) => h.key === 'kaggle-notebook')!;
    const end = habitEndDate(spec, main.today)!;
    expect(end < main.today).toBe(true);
    expect(history('kaggle-notebook').scheduledToday).toBe(false);
    for (const day of history('kaggle-notebook').completedOn) expect(day <= end).toBe(true);
  });

  it('only completes each one on its own days, and never before it started', () => {
    for (const spec of HABITS) {
      const first = shiftDateKey(main.today, -(spec.startedDaysAgo - 1));
      for (const day of history(spec.key).completedOn) {
        expect(day >= first).toBe(true);
        if (spec.days.length > 0) expect(spec.days).toContain(dayNameFromLocalDate(day));
      }
    }
  });
});

describe('calendar events', () => {
  const today = '2026-10-26';
  const events = calendarEvents(today);

  it('repeats the weekly ones only on their days', () => {
    const gym = events.filter((e) => e.title === 'Gym');
    expect(gym.length).toBeGreaterThan(10);
    for (const e of gym) expect(['mon', 'wed', 'fri']).toContain(dayNameFromLocalDate(e.date));
  });

  it('gives every event either a slot inside its day or none at all', () => {
    for (const e of events) {
      expect(e.date).toBe(shiftDateKey(today, e.dayOffset));
      if (e.startMinutes === null) {
        expect(e.endMinutes).toBeNull();
      } else {
        expect(e.startMinutes).toBeGreaterThanOrEqual(0);
        expect(e.endMinutes!).toBeGreaterThan(e.startMinutes);
        expect(e.endMinutes!).toBeLessThanOrEqual(1439);
      }
    }
    expect(events.some((e) => e.startMinutes === null)).toBe(true);
    expect(events.some((e) => e.dayOffset < 0) && events.some((e) => e.dayOffset > 0)).toBe(true);
  });
});

describe('planMain too early in the day', () => {
  it('refuses rather than spilling today’s sessions into yesterday', () => {
    expect(() => planMain(new Date('2026-09-23T06:10:00Z'), CHICAGO)).toThrow(DayTooShortError);
  });
});

describe.each(RUNS)('planFriend — $label', ({ now, timeZone }) => {
  const today = dateKeyIn(now, timeZone);

  it.each(FRIENDS)('$username: streak as specified, recaps that match their day', (friend) => {
    const plan = planFriend(friend, now, timeZone);
    expect(streaksFrom(plan.sessions.map((s) => s.dateKey), today).current).toBe(friend.streak);
    expect(plan.recaps.length + plan.skipped.length).toBe(friend.recaps.length);
    expect(new Set(plan.recaps.map((r) => r.dateKey)).size).toBe(plan.recaps.length);

    for (const r of plan.recaps) {
      const day = plan.sessions.filter((s) => s.dateKey === r.dateKey);
      expect(day).toHaveLength(r.sessionCount);
      expect(sumMinutes(day)).toBe(r.focusMinutes);
      expect(Math.max(...day.map((s) => s.completedAt.getTime()))).toBeLessThan(r.postedAt.getTime());
      expect(r.postedAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });
});

describe('deriveUnlocks', () => {
  const now = new Date('2026-09-23T17:05:00Z');
  const main = planMain(now, CHICAGO);
  const catalogue = achievements.map((a) => ({ id: a.key, key: a.key, category: a.category, threshold: a.threshold }));
  const follows = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (26 - i) * 86_400_000));
  const completions = Array.from({ length: 12 }, (_, i) => new Date(now.getTime() - (20 - i) * 86_400_000));

  const unlocks = deriveUnlocks(catalogue, {
    sessions: main.sessions,
    taskCompletions: completions,
    followsCreatedAt: follows,
    xp: 3400,
    timeZone: CHICAGO,
  });
  const keys = unlocks.map((u) => u.key);

  it('unlocks what the history earns and nothing it does not', () => {
    expect(keys).toEqual(expect.arrayContaining([
      'streak_3', 'streak_7', 'sessions_10', 'sessions_100', 'focus_600', 'focus_6000', 'tasks_10', 'level_5', 'social-butterfly',
    ]));
    for (const unearned of ['streak_14', 'sessions_250', 'focus_12000', 'tasks_50', 'level_10', 'speed-runner']) {
      expect(keys).not.toContain(unearned);
    }
  });

  it('dates each unlock to when it was earned, never in the future', () => {
    for (const u of unlocks) expect(u.unlockedAt.getTime()).toBeLessThan(now.getTime());
    const at = (key: string) => unlocks.find((u) => u.key === key)!.unlockedAt.getTime();
    expect(at('sessions_1')).toBeLessThan(at('sessions_10'));
    expect(at('streak_3')).toBeLessThan(at('streak_7'));
    expect(at('social-butterfly')).toBe(follows[4].getTime());
  });
});

describe('checkDemoTarget', () => {
  const remote = 'postgresql://u:p@staging-db.example.net:5432/railway';

  it('allows a local database without ceremony', () => {
    expect(checkDemoTarget('postgresql://u:p@localhost:5432/ascend', undefined)).toMatchObject({ ok: true, isLocal: true });
  });

  it('refuses a remote database unless its host is named exactly', () => {
    expect(checkDemoTarget(remote, undefined).ok).toBe(false);
    expect(checkDemoTarget(remote, 'other.proxy.rlwy.net').ok).toBe(false);
    expect(checkDemoTarget(remote, 'staging-db.example.net')).toMatchObject({ ok: true, isLocal: false });
  });

  it('refuses a missing or malformed URL', () => {
    expect(checkDemoTarget(undefined, undefined).ok).toBe(false);
    expect(checkDemoTarget('not a url', undefined).ok).toBe(false);
  });
});
