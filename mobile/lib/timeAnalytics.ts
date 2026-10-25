/**
 * Pure maths behind the time analytics screens (components/timeReport).
 *
 * Everything here works on 'YYYY-MM-DD' day keys, never on Date instants: the
 * server has already placed every session on the user's local calendar day,
 * and re-deriving a day from an instant on the client is how the app used to
 * disagree with itself across midnight and DST. Day arithmetic goes through
 * UTC midnights, where every day is exactly 24 hours.
 *
 * No react-native imports, so vitest can run it under plain Node.
 */

const DAY_MS = 86_400_000;
const HOUR = 3600;

export interface DayTotal {
  date: string;
  seconds: number;
  sessions?: number;
}

// ─── Day keys ────────────────────────────────────────────────────────────────

function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function shiftKey(key: string, days: number): string {
  return utcToKey(keyToUtc(key) + days * DAY_MS);
}

/** Whole days from `a` to `b`; negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(key: string): number {
  return (new Date(keyToUtc(key)).getUTCDay() + 6) % 7;
}

/** The Monday-start week holding `today`, moved by `offset` whole weeks. */
export function weekRange(today: string, offset = 0): { from: string; to: string } {
  const from = shiftKey(today, -mondayIndex(today) + offset * 7);
  return { from, to: shiftKey(from, 6) };
}

// ─── The climb ───────────────────────────────────────────────────────────────

export interface ClimbPoint {
  date: string;
  /** Running total up to and including this day. */
  total: number;
}

/** Points beyond this are thinned: a phone is ~350pt wide, more is invisible. */
export const CLIMB_MAX_POINTS = 120;

/**
 * Cumulative focus from the first active day to `today`, one point per day,
 * thinned evenly to at most `maxPoints`. The last point is always kept, so the
 * line ends exactly on the all-time total.
 *
 * `daily` holds active days only (as /time-report/history returns them); the
 * gaps are filled here so a quiet month reads as a flat stretch, not a jump.
 */
export function climbSeries(daily: DayTotal[], today: string, maxPoints = CLIMB_MAX_POINTS): ClimbPoint[] {
  if (daily.length === 0) return [];
  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = sorted[0].date;
  const last = today > sorted[sorted.length - 1].date ? today : sorted[sorted.length - 1].date;
  const span = daysBetween(first, last) + 1;

  const byDay = new Map(sorted.map((d) => [d.date, d.seconds]));
  const all: ClimbPoint[] = [];
  let total = 0;
  for (let i = 0; i < span; i += 1) {
    const date = shiftKey(first, i);
    total += byDay.get(date) ?? 0;
    all.push({ date, total });
  }
  if (all.length <= maxPoints) return all;

  const step = (all.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => all[Math.round(i * step)]);
}

/**
 * The next round number of hours to climb towards. Early rungs are close
 * together so a new user has something within reach; after 100h it is every
 * 100h, as the design's milestone line shows.
 */
const MILESTONE_RUNGS_HOURS = [1, 5, 10, 25, 50, 100];

export function nextMilestone(totalSeconds: number): { hours: number; remainingSeconds: number } {
  const hours = totalSeconds / HOUR;
  const rung = MILESTONE_RUNGS_HOURS.find((h) => h > hours)
    ?? (Math.floor(hours / 100) + 1) * 100;
  return { hours: rung, remainingSeconds: rung * HOUR - totalSeconds };
}

/** Share of days since the first session that had any focus. Null with no history. */
export function activeDayShare(activeDays: number, firstDate: string | null, today: string): number | null {
  if (!firstDate) return null;
  const span = Math.max(1, daysBetween(firstDate, today) + 1);
  return Math.min(1, activeDays / span);
}

// ─── Week bars ───────────────────────────────────────────────────────────────

export interface WeekBar {
  date: string;
  seconds: number;
  isToday: boolean;
  isFuture: boolean;
}

/** Monday to Sunday for the week starting `from`, read out of a daily series. */
export function weekBars(daily: DayTotal[], from: string, today: string): WeekBar[] {
  const byDay = new Map(daily.map((d) => [d.date, d.seconds]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftKey(from, i);
    return { date, seconds: byDay.get(date) ?? 0, isToday: date === today, isFuture: date > today };
  });
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

export interface HeatCell {
  date: string;
  seconds: number;
  /** 0 = nothing, 1–4 = quartile of the active days shown. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Column (week, oldest first) and row (0 = Monday). */
  col: number;
  row: number;
  isFuture: boolean;
}

export const HEATMAP_WEEKS = 53;

/**
 * A rolling year of days in Monday-start columns, ending on the week holding
 * `today`. Intensity is relative to the user's own active days (quartiles), so
 * a light schedule still shows its shape instead of a page of the faintest
 * colour. Days after today are flagged rather than dropped, so the grid keeps
 * its rectangle.
 */
export function heatmapCells(daily: DayTotal[], today: string, weeks = HEATMAP_WEEKS): HeatCell[] {
  const start = shiftKey(weekRange(today).from, -(weeks - 1) * 7);
  const byDay = new Map(daily.map((d) => [d.date, d.seconds]));

  const inWindow: number[] = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const s = byDay.get(shiftKey(start, i)) ?? 0;
    if (s > 0) inWindow.push(s);
  }
  const cuts = quartileCuts(inWindow);

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = shiftKey(start, i);
    const seconds = byDay.get(date) ?? 0;
    return {
      date,
      seconds,
      level: seconds <= 0 ? 0 : levelFor(seconds, cuts),
      col: Math.floor(i / 7),
      row: i % 7,
      isFuture: date > today,
    };
  });
}

function quartileCuts(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

function levelFor(seconds: number, [q1, q2, q3]: [number, number, number]): 1 | 2 | 3 | 4 {
  if (seconds > q3) return 4;
  if (seconds > q2) return 3;
  if (seconds > q1) return 2;
  return 1;
}

// ─── Patterns ────────────────────────────────────────────────────────────────

/**
 * Average focus per weekday over a window, Monday first. `byWeekday` is the
 * report's Sunday-first total per weekday; each is divided by how many of that
 * weekday the window holds, so a window with five Mondays and four Sundays
 * does not flatter Monday.
 */
export function weekdayAverages(byWeekday: number[], from: string, to: string): number[] {
  const counts = new Array(7).fill(0);
  const days = daysBetween(from, to) + 1;
  for (let i = 0; i < days; i += 1) counts[mondayIndex(shiftKey(from, i))] += 1;
  return counts.map((n, mon) => {
    const sundayFirst = (mon + 1) % 7;
    return n === 0 ? 0 : Math.round((byWeekday[sundayFirst] ?? 0) / n);
  });
}

/** The busiest run of `width` consecutive hours, for "you focus most 9–11am". */
export function peakWindow(byHour: number[], width = 2): { start: number; seconds: number } | null {
  let best: { start: number; seconds: number } | null = null;
  for (let start = 0; start <= 24 - width; start += 1) {
    const seconds = byHour.slice(start, start + width).reduce((a, b) => a + b, 0);
    if (seconds > 0 && (!best || seconds > best.seconds)) best = { start, seconds };
  }
  return best;
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export interface PaceGoalLike {
  id: string;
  deadline: string | null;
  plannedMinutes: number | null;
  isCompleted: boolean;
  isArchived: boolean;
  createdAt: string;
}

/**
 * How the Goals lens groups goals: planned ones first, soonest deadline first
 * (no deadline last), then active goals without a plan, then completed ones.
 * Archived goals never appear.
 */
export function groupGoals<G extends PaceGoalLike>(goals: G[]): { planned: G[]; unplanned: G[]; completed: G[] } {
  const live = goals.filter((g) => !g.isArchived);
  const active = live.filter((g) => !g.isCompleted);
  const planned = active
    .filter((g) => g.plannedMinutes !== null)
    .sort((a, b) => {
      if (a.deadline === b.deadline) return a.createdAt < b.createdAt ? -1 : 1;
      if (a.deadline === null) return 1;
      if (b.deadline === null) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
  return {
    planned,
    unplanned: active.filter((g) => g.plannedMinutes === null),
    completed: live.filter((g) => g.isCompleted),
  };
}

/** Bar geometry for planned vs done: both as 0..1 of the plan. */
export function paceShares(
  actualSeconds: number,
  plannedMinutes: number,
  expectedSeconds: number | null,
): { done: number; expected: number | null } {
  const planned = plannedMinutes * 60;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    done: clamp(actualSeconds / planned),
    expected: expectedSeconds === null ? null : clamp(expectedSeconds / planned),
  };
}

export interface PaceLike {
  status: 'completed' | 'no_plan' | 'reached' | 'past_due' | 'no_deadline' | 'ahead' | 'behind' | 'on_pace';
  remainingSeconds: number | null;
  deltaSeconds: number | null;
  perDayToFinishSeconds: number | null;
}

export type PaceTone = 'primary' | 'accent' | 'warning';

/**
 * The words and colour for a goal's time pace. Facts only: how far ahead or
 * behind, and what a day would close the gap. No adjective about the user.
 * `fmt` is the app's duration formatter, passed in to keep this file pure.
 */
export function paceCopy(pace: PaceLike, fmt: (seconds: number) => string): { text: string; tone: PaceTone } {
  const left = pace.remainingSeconds !== null ? fmt(pace.remainingSeconds) : '';
  switch (pace.status) {
    case 'completed': return { text: 'Completed', tone: 'accent' };
    case 'no_plan': return { text: 'No planned time', tone: 'primary' };
    case 'reached': return { text: 'Plan reached', tone: 'accent' };
    case 'past_due': return { text: `Past due · ${left} left`, tone: 'warning' };
    case 'no_deadline': return { text: `${left} left · no deadline`, tone: 'primary' };
    case 'ahead': return { text: `Ahead by ${fmt(pace.deltaSeconds ?? 0)}`, tone: 'accent' };
    case 'behind': {
      const perDay = pace.perDayToFinishSeconds !== null ? ` · ${fmt(pace.perDayToFinishSeconds)}/day to finish` : '';
      return { text: `Behind by ${fmt(Math.abs(pace.deltaSeconds ?? 0))}${perDay}`, tone: 'warning' };
    }
    case 'on_pace':
    default:
      return { text: 'On pace', tone: 'primary' };
  }
}

/**
 * Parse what the user typed into "Planned focus time" (hours, decimals
 * allowed: "12", "1.5", "0,75") into whole minutes. Empty means no plan.
 * Returns undefined for anything the server would refuse (1–100,000 minutes).
 */
export const MAX_PLANNED_MINUTES = 100_000;

export function parsePlannedHours(input: string): number | null | undefined {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const minutes = Math.round(Number(text) * 60);
  if (minutes < 1 || minutes > MAX_PLANNED_MINUTES) return undefined;
  return minutes;
}

/** Minutes back to the hours text the form shows: 90 → "1.5", 600 → "10". */
export function plannedHoursText(minutes: number | null): string {
  if (minutes === null) return '';
  return String(Math.round((minutes / 60) * 100) / 100);
}

// ─── Trends ──────────────────────────────────────────────────────────────────

export interface Mover {
  name: string;
  seconds: number;
  previousSeconds: number;
}

/** A goal or tag has to move by at least this much to be worth a sentence. */
const TREND_MIN_SECONDS = 15 * 60;
const TREND_LIMIT = 3;

/** The few things that actually moved, largest change first. */
export function topMovers(rows: Mover[]): Mover[] {
  return rows
    .filter((r) => Math.abs(r.seconds - r.previousSeconds) >= TREND_MIN_SECONDS)
    .sort((a, b) => Math.abs(b.seconds - b.previousSeconds) - Math.abs(a.seconds - a.previousSeconds))
    .slice(0, TREND_LIMIT);
}

export function moverSentence(m: Mover, noun: string): string {
  if (m.previousSeconds === 0) return `${m.name} is new this ${noun}.`;
  if (m.seconds === 0) return `${m.name} got no time this ${noun}.`;
  const change = (m.seconds - m.previousSeconds) / m.previousSeconds;
  return `${m.name} is ${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}% from the previous ${noun}.`;
}

// ─── Chart geometry ──────────────────────────────────────────────────────────

/** SVG path for a line through `values`, spread evenly across `width`, 0 at the bottom. */
export function linePath(values: number[], width: number, height: number, max: number): string {
  if (values.length === 0) return '';
  const top = max > 0 ? max : 1;
  const dx = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${round(i * dx)},${round(height - (v / top) * height)}`)
    .join(' ');
}

/** The same line closed down to the baseline, for the soft fill under it. */
export function areaPath(values: number[], width: number, height: number, max: number): string {
  if (values.length === 0) return '';
  const lastX = values.length > 1 ? width : 0;
  return `${linePath(values, width, height, max)} L${round(lastX)},${height} L0,${height} Z`;
}

/** Which point a finger at `x` is over, for scrubbing. */
export function indexAtX(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round((x / width) * (count - 1))));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '2026-03-07' → 'Sat 7 Mar'. */
export function dayLabel(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${WEEKDAYS[mondayIndex(key)]} ${d} ${MONTHS[m - 1]}`;
}

/** '2026-03-07' → 'Mar 2026'. */
export function monthYearLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** A week range as '6–12 Oct' or '29 Sep – 5 Oct'. */
export function weekLabel(from: string, to: string): string {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  return fm === tm ? `${fd}–${td} ${MONTHS[tm - 1]}` : `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]}`;
}

/** Whole hours for big headline numbers: 312h, or minutes under an hour. */
export function compactHours(seconds: number): string {
  if (seconds < HOUR) return `${Math.round(seconds / 60)}m`;
  if (seconds < 10 * HOUR) return `${Math.round((seconds / HOUR) * 10) / 10}h`;
  return `${Math.round(seconds / HOUR).toLocaleString('en-US')}h`;
}
