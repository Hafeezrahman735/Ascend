/**
 * Turns content.ts into dated rows: every focus session, every habit
 * completion, every achievement unlock. Pure — no database — so the invariants
 * the screenshots depend on (a 12-day streak, 3 sessions today, a top-3-not-#1
 * leaderboard spot) are checked by the unit suite rather than by eye.
 */
import { hashUnit } from '../demoHistory';
import { dayNameFromLocalDate } from '../localDate';
import { dateKeyIn, shiftDateKey, streaksFrom, zonedInstant } from './time';
import { getRankTitle } from '../rank';
import {
  FIXED_DAYS, FIXED_ONLY_TASKS, FRIENDS, HABITS, MAIN_USERNAME, MAIN_XP, SESSIONS_BY_DAY, TASKS,
  type FixedBlock, type FriendSpec, type HabitKey, type HabitSpec, type Strand, type TaskKey,
} from './content';

const MINUTE_MS = 60_000;

/** Block lengths for generated task work, weighted toward a normal 50. */
const TASK_BLOCK_MINUTES = [30, 45, 50, 50, 60, 90];

/** The main account's history reaches back this far; nothing is older. */
export const MAIN_HISTORY_DAYS = 28;

export interface PlannedBlock {
  dateKey: string;
  startedAt: Date;
  completedAt: Date;
  minutes: number;
}

export interface MainSession extends PlannedBlock {
  strand: Strand;
}

function pick<T>(list: readonly T[], seed: string): T {
  return list[Math.floor(hashUnit(seed) * list.length)];
}

// ── Laying blocks out on a day ─────────────────────────────────────────────

/**
 * Place blocks back to back, with short breaks, through an afternoon/evening.
 * About one day in six starts in the morning instead, so the hour breakdown is
 * "mostly evenings" rather than "only evenings".
 */
function layOutPastDay(dateKey: string, minutes: number[], timeZone: string, seed: string): PlannedBlock[] {
  const morning = hashUnit(`${seed}:morning`) < 0.17;
  let cursor = (morning ? 10 : 13) * 60 + Math.floor(hashUnit(`${seed}:start`) * 90);
  const spans: { start: number; end: number }[] = [];
  for (const [i, length] of minutes.entries()) {
    const start = cursor + (i === 0 ? 0 : 10 + Math.floor(hashUnit(`${seed}:gap:${i}`) * 60));
    spans.push({ start, end: start + length });
    cursor = start + length;
  }

  // Never run past 23:55: slide the whole day earlier instead of cutting a block.
  const overflow = Math.max(0, spans[spans.length - 1].end - (23 * 60 + 55));
  return spans.map(({ start, end }, i) => {
    const s = start - overflow;
    const e = end - overflow;
    return {
      dateKey,
      startedAt: zonedInstant(dateKey, Math.floor(s / 60), s % 60, timeZone),
      completedAt: zonedInstant(dateKey, Math.floor(e / 60), e % 60, timeZone),
      minutes: minutes[i],
    };
  });
}

/**
 * Place blocks so the last one finishes `endsBefore` and each earlier one
 * finishes before the next starts. Throws if they would spill into the
 * previous day, because then "today" on the phone would be wrong.
 */
function layOutBackwardsFrom(
  endsBefore: Date,
  minutes: number[],
  gapMinutes: number,
  timeZone: string,
): PlannedBlock[] {
  const dateKey = dateKeyIn(endsBefore, timeZone);
  const midnight = zonedInstant(dateKey, 0, 0, timeZone).getTime();

  const blocks: PlannedBlock[] = [];
  let end = endsBefore.getTime();
  for (let i = minutes.length - 1; i >= 0; i -= 1) {
    const start = end - minutes[i] * MINUTE_MS;
    if (start < midnight) {
      throw new DayTooShortError(dateKey);
    }
    blocks.unshift({ dateKey, startedAt: new Date(start), completedAt: new Date(end), minutes: minutes[i] });
    end = start - gapMinutes * MINUTE_MS;
  }
  return blocks;
}

export class DayTooShortError extends Error {
  constructor(dateKey: string) {
    super(
      `Not enough of ${dateKey} has passed to fit its sessions before now. `
      + 'Re-run the seed later in the day (after about 05:00 local).',
    );
  }
}

// ── Habits ──────────────────────────────────────────────────────────────────

function isScheduled(habit: HabitSpec, dateKey: string): boolean {
  return habit.days.length === 0 || habit.days.includes(dayNameFromLocalDate(dateKey));
}

/** Days in the history window the habit was scheduled, most recent first. */
function occurrences(habit: HabitSpec, today: string): string[] {
  const days: string[] = [];
  for (let d = 0; d < MAIN_HISTORY_DAYS; d += 1) {
    const key = shiftDateKey(today, -d);
    if (isScheduled(habit, key)) days.push(key);
  }
  return days;
}

export interface HabitHistory {
  /** Local dates the habit was completed on, most recent first. */
  completedOn: string[];
  /** Today's occurrence exists (the habit is scheduled today). */
  scheduledToday: boolean;
  currentStreak: number;
  longestStreak: number;
}

/**
 * A habit's streak counts consecutive SCHEDULED occurrences, not calendar days
 * — a weekday habit is not broken by a Saturday. Counted here from the
 * completion list the same way spawn-recurring would have left it.
 */
export function habitHistory(habit: HabitSpec, today: string): HabitHistory {
  const occ = occurrences(habit, today);
  const missed = new Set(habit.missedOccurrences);
  const done = occ.map((_, i) => !missed.has(i));

  let current = 0;
  while (current < done.length && done[current]) current += 1;

  let longest = 0;
  let run = 0;
  for (const d of done) {
    run = d ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  return {
    completedOn: occ.filter((_, i) => done[i]),
    scheduledToday: occ[0] === today,
    currentStreak: current,
    longestStreak: longest,
  };
}

// ── The main account's sessions ────────────────────────────────────────────

/** Minutes before `now` that today's blocks end, last block first. */
const TODAY_GAP_MINUTES = 35;

/**
 * How many sessions a task may carry. A finished task lands on its estimate at
 * most; an open one stays short of it. Without a cap the tasks with the longest
 * date windows soak up every block and a 3-session task shows 10 sessions — a
 * progress bar at 333%.
 */
export function sessionCap(task: (typeof TASKS)[number]): number {
  return task.completedDaysAgo === undefined ? Math.max(0, task.estSessions - 1) : task.estSessions;
}

function generatedBlocks(
  daysAgo: number,
  count: number,
  dateKey: string,
  habitsDone: Map<HabitKey, Set<string>>,
  used: Map<TaskKey, number>,
): FixedBlock[] {
  const hasRoom = (t: (typeof TASKS)[number]) => (used.get(t.key) ?? 0) < sessionCap(t);
  const take = (key: TaskKey) => used.set(key, (used.get(key) ?? 0) + 1);

  // A task gets its first block on the day it is finished, so nothing on the
  // list was completed without any time behind it.
  const blocks: FixedBlock[] = [];
  for (const t of TASKS.filter((t) => t.completedDaysAgo === daysAgo && hasRoom(t))) {
    take(t.key);
    blocks.push({ strand: { kind: 'task', key: t.key }, minutes: pick(TASK_BLOCK_MINUTES, `main:${daysAgo}:finish:${t.key}`) });
  }

  const habitsToday = HABITS.filter((h) => habitsDone.get(h.key)?.has(dateKey));
  const usedHabits = new Set<HabitKey>();
  const habitBlock = (seed: string): FixedBlock | null => {
    const free = habitsToday.filter((h) => !usedHabits.has(h.key));
    if (free.length === 0) return null;
    const habit = pick(free, `${seed}:which-habit`);
    usedHabits.add(habit.key);
    return { strand: { kind: 'habit', key: habit.key }, minutes: habit.minutes };
  };

  for (let i = blocks.length; i < count; i += 1) {
    const seed = `main:${daysAgo}:${i}`;
    // Roughly a third of blocks are habit time, when a habit was done that day.
    const habitFirst = hashUnit(`${seed}:habit`) < 0.34 ? habitBlock(seed) : null;
    if (habitFirst) {
      blocks.push(habitFirst);
      continue;
    }
    const open = TASKS.filter((t) =>
      !FIXED_ONLY_TASKS.includes(t.key)
      && t.createdDaysAgo >= daysAgo
      && (t.completedDaysAgo === undefined || t.completedDaysAgo <= daysAgo)
      && hasRoom(t));
    if (open.length > 0) {
      const task = pick(open, `${seed}:task`);
      take(task.key);
      blocks.push({ strand: { kind: 'task', key: task.key }, minutes: pick(TASK_BLOCK_MINUTES, `${seed}:len`) });
      continue;
    }
    blocks.push(habitBlock(seed) ?? { strand: { kind: 'free' }, minutes: pick(TASK_BLOCK_MINUTES, `${seed}:len`) });
  }
  return blocks;
}

export interface MainPlan {
  today: string;
  sessions: MainSession[];
  habits: Map<HabitKey, HabitHistory>;
}

export function planMain(now: Date, timeZone: string): MainPlan {
  const today = dateKeyIn(now, timeZone);

  const habits = new Map<HabitKey, HabitHistory>(HABITS.map((h) => [h.key, habitHistory(h, today)]));
  const habitsDone = new Map<HabitKey, Set<string>>(
    [...habits].map(([key, h]) => [key, new Set(h.completedOn)]),
  );

  // Sessions already spoken for by the fixed days count against each cap.
  const used = new Map<TaskKey, number>();
  for (const block of Object.values(FIXED_DAYS).flat()) {
    if (block.strand.kind === 'task') used.set(block.strand.key, (used.get(block.strand.key) ?? 0) + 1);
  }

  const sessions: MainSession[] = [];
  for (const [daysAgoText, count] of Object.entries(SESSIONS_BY_DAY)) {
    const daysAgo = Number(daysAgoText);
    const dateKey = shiftDateKey(today, -daysAgo);
    const blocks = FIXED_DAYS[daysAgo] ?? generatedBlocks(daysAgo, count, dateKey, habitsDone, used);
    const minutes = blocks.map((b) => b.minutes);

    const laidOut = daysAgo === 0
      ? layOutBackwardsFrom(new Date(now.getTime() - TODAY_GAP_MINUTES * MINUTE_MS), minutes, 20, timeZone)
      : layOutPastDay(dateKey, minutes, timeZone, `main:${daysAgo}`);

    laidOut.forEach((slot, i) => sessions.push({ ...slot, strand: blocks[i].strand }));
  }

  sessions.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  return { today, sessions, habits };
}

// ── Friends ─────────────────────────────────────────────────────────────────

export interface FriendSession extends PlannedBlock {
  label: string;
}

export interface FriendRecap {
  caption: string;
  postedAt: Date;
  dateKey: string;
  sessionCount: number;
  focusMinutes: number;
  streakAtPost: number;
}

export interface FriendPlan {
  sessions: FriendSession[];
  recaps: FriendRecap[];
  /** Recaps dropped because another already covers that local day, or the day
   *  has not had room for them yet. The app writes one recap per day. */
  skipped: string[];
}

/** Split a total into `n` near-equal whole-minute blocks. */
function splitMinutes(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

export function planFriend(friend: FriendSpec, now: Date, timeZone: string): FriendPlan {
  const today = dateKeyIn(now, timeZone);
  const sessions: FriendSession[] = [];
  const skipped: string[] = [];
  const recapDays = new Map<string, { postedAt: Date; caption: string; sessionCount: number; focusMinutes: number }>();

  for (const recap of [...friend.recaps].sort((a, b) => a.minutesAgo - b.minutesAgo)) {
    const postedAt = new Date(now.getTime() - recap.minutesAgo * MINUTE_MS);
    const dateKey = dateKeyIn(postedAt, timeZone);
    if (recapDays.has(dateKey)) {
      skipped.push(recap.caption);
      continue;
    }
    let blocks: PlannedBlock[];
    try {
      blocks = layOutBackwardsFrom(new Date(postedAt.getTime() - 5 * MINUTE_MS), splitMinutes(recap.focusMinutes, recap.sessions), 10, timeZone);
    } catch (error) {
      if (!(error instanceof DayTooShortError)) throw error;
      skipped.push(recap.caption);
      continue;
    }
    blocks.forEach((b, i) => sessions.push({ ...b, label: pick(friend.strands, `${friend.username}:${dateKey}:${i}`) }));
    recapDays.set(dateKey, { postedAt, caption: recap.caption, sessionCount: recap.sessions, focusMinutes: recap.focusMinutes });
  }

  // The streak ends on the day of their latest recap (today or yesterday).
  const latest = [...recapDays.keys()].sort().pop() ?? today;
  const workedDays: string[] = [];
  for (let d = 0; d < friend.streak; d += 1) workedDays.push(shiftDateKey(latest, -d));
  // shiftDateKey(latest, -friend.streak) is the rest day that bounds the streak.
  for (let d = friend.streak + 1; d <= friend.streak + friend.historyDays; d += 1) {
    if (hashUnit(`${friend.username}:worked:${d}`) < 0.6) workedDays.push(shiftDateKey(latest, -d));
  }

  for (const dateKey of workedDays) {
    if (recapDays.has(dateKey)) continue;
    const seed = `${friend.username}:${dateKey}`;
    const [min, max] = friend.blocksPerDay;
    const count = min + Math.floor(hashUnit(`${seed}:count`) * (max - min + 1));
    const minutes = Array.from({ length: count }, (_, i) => pick(friend.blockMinutes, `${seed}:len:${i}`));
    layOutPastDay(dateKey, minutes, timeZone, seed)
      .forEach((b, i) => sessions.push({ ...b, label: pick(friend.strands, `${seed}:what:${i}`) }));
  }

  sessions.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());

  // A recap quotes the streak as it stood on the day it was posted.
  const recaps: FriendRecap[] = [...recapDays].map(([dateKey, r]) => ({
    caption: r.caption,
    postedAt: r.postedAt,
    dateKey,
    sessionCount: r.sessionCount,
    focusMinutes: r.focusMinutes,
    streakAtPost: streaksFrom(sessions.filter((s) => s.dateKey <= dateKey).map((s) => s.dateKey), dateKey).current,
  }));

  return { sessions, recaps, skipped };
}

// ── Achievements ────────────────────────────────────────────────────────────

export interface CatalogueEntry {
  id: string;
  key: string;
  category: string;
  threshold: number;
}

export interface UnlockInput {
  sessions: { completedAt: Date; dateKey: string; minutes: number }[];
  taskCompletions: Date[];
  followsCreatedAt: Date[];
  xp: number;
  /** The clock achievements/handler.ts reads with getHours(): the server's. */
  serverTimeZone: string;
}

export interface Unlock {
  achievementId: string;
  key: string;
  unlockedAt: Date;
}

/**
 * Every achievement this history has earned, stamped with the moment it was
 * earned — the Nth session, the day the streak reached N, and so on. Awarding
 * a fixed list instead would leave earned achievements locked, or unlock ones
 * the numbers on the same screen say are out of reach.
 */
export function deriveUnlocks(catalogue: CatalogueEntry[], input: UnlockInput): Unlock[] {
  const sessions = [...input.sessions].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  const nth = <T>(list: T[], n: number): T | undefined => (n >= 1 ? list[n - 1] : undefined);

  // When cumulative focus first reached `seconds`.
  const focusReached = (seconds: number): Date | undefined => {
    let total = 0;
    for (const s of sessions) {
      total += s.minutes * 60;
      if (total >= seconds) return s.completedAt;
    }
    return undefined;
  };

  // When a run of consecutive worked days first reached `days`.
  const lastSessionOn = new Map<string, Date>();
  for (const s of sessions) lastSessionOn.set(s.dateKey, s.completedAt);
  const days = [...lastSessionOn.keys()].sort();
  const streakReached = (target: number): Date | undefined => {
    let run = 0;
    for (const [i, day] of days.entries()) {
      run = i > 0 && shiftDateKey(days[i - 1], 1) === day ? run + 1 : 1;
      if (run >= target) return lastSessionOn.get(day);
    }
    return undefined;
  };

  // XP is set, not accrued (see MAIN_XP), so a rank is dated to the point in
  // the history where the same share of the total focus time had been done.
  const totalFocusSeconds = sessions.reduce((sum, s) => sum + s.minutes * 60, 0);
  const xpReached = (threshold: number): Date | undefined =>
    input.xp >= threshold ? focusReached(Math.ceil((threshold / input.xp) * totalFocusSeconds)) : undefined;

  const serverParts = (d: Date) => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: input.serverTimeZone, hour: '2-digit', hourCycle: 'h23' });
    return { hour: Number(fmt.format(d)), dateKey: dateKeyIn(d, input.serverTimeZone) };
  };
  const perServerDay = new Map<string, { count: number; minutes: number; last: Date }>();
  for (const s of sessions) {
    const { dateKey } = serverParts(s.completedAt);
    const entry = perServerDay.get(dateKey) ?? { count: 0, minutes: 0, last: s.completedAt };
    perServerDay.set(dateKey, { count: entry.count + 1, minutes: entry.minutes + s.minutes, last: s.completedAt });
  }
  const firstDay = (ok: (e: { count: number; minutes: number }) => boolean) =>
    [...perServerDay.values()].find(ok)?.last;

  const completions = [...input.taskCompletions].sort((a, b) => a.getTime() - b.getTime());
  const follows = [...input.followsCreatedAt].sort((a, b) => a.getTime() - b.getTime());

  const unlockedAt = (a: CatalogueEntry): Date | undefined => {
    switch (a.key) {
      case 'social-butterfly': return nth(follows, 5);
      case 'early-bird': return sessions.find((s) => serverParts(s.completedAt).hour < 8)?.completedAt;
      case 'night-owl': return sessions.find((s) => serverParts(s.completedAt).hour >= 22)?.completedAt;
      case 'speed-runner': return firstDay((e) => e.count >= 8);
      case 'marathon': return firstDay((e) => e.minutes >= 240);
    }
    switch (a.category) {
      case 'STREAK': return streakReached(a.threshold);
      case 'SESSIONS': return nth(sessions, a.threshold)?.completedAt;
      // threshold is HOURS here (lib/achievementSeedData.ts).
      case 'FOCUS_TIME': return focusReached(a.threshold * 3600);
      case 'TASKS': return nth(completions, a.threshold);
      case 'RANK': return xpReached(a.threshold);
      default: return undefined;
    }
  };

  const unlocks: Unlock[] = [];
  for (const a of catalogue) {
    const at = unlockedAt(a);
    if (at) unlocks.push({ achievementId: a.id, key: a.key, unlockedAt: at });
  }
  return unlocks;
}

// ── The whole-account checks ─────────────────────────────────────────────

export interface LeaderboardRow {
  username: string;
  focusMinutes: number;
  rank: string;
}

export function sumMinutes(sessions: { minutes: number }[]): number {
  return sessions.reduce((sum, s) => sum + s.minutes, 0);
}

/**
 * The board this account's Friends tab shows: everyone it follows plus itself,
 * ordered by all-time focus. Computed before anything is written so a content
 * change that would put the account at #1 (or off the podium) fails the run
 * instead of shipping a wrong screenshot.
 */
export function leaderboardOf(main: MainPlan, friends: FriendPlan[]): LeaderboardRow[] {
  return [
    { username: MAIN_USERNAME, focusMinutes: sumMinutes(main.sessions), rank: getRankTitle(MAIN_XP) },
    ...FRIENDS.map((f, i) => ({ username: f.username, focusMinutes: sumMinutes(friends[i].sessions), rank: getRankTitle(f.xp) })),
  ].sort((a, b) => b.focusMinutes - a.focusMinutes);
}

/** What the plan must produce for the screenshots to say what they should. */
export function checkPlan(main: MainPlan, board: LeaderboardRow[]): void {
  const days = main.sessions.map((s) => s.dateKey);
  const streak = streaksFrom(days, main.today);
  const today = main.sessions.filter((s) => s.dateKey === main.today);
  const position = board.findIndex((r) => r.username === MAIN_USERNAME) + 1;

  const problems: string[] = [];
  if (streak.current !== 12) problems.push(`day streak is ${streak.current}, expected 12`);
  if (today.length !== 3) problems.push(`${today.length} sessions today, expected 3`);
  if (sumMinutes(today) !== 100) problems.push(`${sumMinutes(today)} focus minutes today, expected 100`);
  if (position < 2 || position > 3) problems.push(`leaderboard position ${position}, expected 2 or 3`);
  if (problems.length > 0) throw new Error(`Demo plan is inconsistent: ${problems.join('; ')}`);
}
