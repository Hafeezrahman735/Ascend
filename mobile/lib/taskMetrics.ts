import type { Task } from '../types';
import type { SessionRecord } from '../store/sync';
import { calcDaysUntilDue } from '../store/selectors/tasks';
import { parseLocalDate } from '../utils/date';
import type { ThemeColors } from '../hooks/useTheme';

/**
 * Pure metric and formatting helpers for the Tasks screen.
 *
 * Extracted verbatim from app/(tabs)/tasks.tsx, which was 2589 lines. Nothing
 * about the logic changed in the move — every function is byte-identical to
 * what it replaced, only exported.
 *
 * The point of the move is testability as much as file size: these are pure
 * functions over tasks and session records, and until now the only way to
 * exercise them was to render a 2500-line screen.
 */

// ─── Date helpers (no date-fns) ───────────────────────────────────────────────
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}
export function isToday(ts: number): boolean {
  const d = new Date(ts); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
export function isThisWeek(ts: number): boolean {
  const d = new Date(ts); const mon = getMonday(new Date()); const next = new Date(mon); next.setDate(next.getDate() + 7);
  return d >= mon && d < next;
}
export function isThisMonth(ts: number): boolean {
  const d = new Date(ts); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600); const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`; return `${m}m`;
}
export function formatDuration(seconds: number): string {
  if (seconds >= 3600) { const h = Math.floor(seconds/3600); const m = Math.round((seconds%3600)/60); return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${Math.round(seconds/60)}m`;
}
/**
 * How long past due, in the same d/w/mo shape formatLastWorked uses.
 *
 * Bounded on purpose. An unbounded day count renders "178d overdue" on a task
 * abandoned in spring, which is false precision — nobody triages on 178 versus
 * 179 — and it is the most punitive string this app can produce. Thresholds are
 * copied from formatLastWorked deliberately so the two cannot drift.
 */
export function formatOverdue(days: number): string {
  const d = Math.abs(days);
  if (d < 7) return `${d}d overdue`;
  if (d < 30) return `${Math.floor(d / 7)}w overdue`;
  return `${Math.floor(d / 30)}mo overdue`;
}

/**
 * The due-date chip for a task row: what it says, how it is tinted, and what
 * VoiceOver reads.
 *
 * The whole ladder is here rather than the overdue branch alone, because the
 * other branches were the worse bug. A task due TODAY used to render the
 * weekday name — "⚠ Mon" — which reads as "due on Monday". Seven days out
 * rendered "Due Mon", colliding with the same weekday the week after and every
 * week after that. Meanwhile the urgency card forty pixels away said "Today"
 * and "Tomorrow". One fact, two vocabularies, one screen.
 *
 * Colour runs in two tiers, not one. ROSE is this app's DESTRUCTIVE colour —
 * the delete-goal button, and `error` itself in the light palette — and a task
 * that is one day late is neither destructive nor broken. So a fresh slip gets
 * `warning`, which is already this app's "behind, not broken" (SelfComparisonCard
 * uses it for "you can catch up"), and ROSE starts at three days, where it is
 * earned. The two tiers also do triage work one tier cannot: amber is today's
 * slip, rose is a decision you have been avoiding.
 *
 * No "⚠" in the label. The chip is already tinted, so the glyph is decoration
 * for sighted users and noise for everyone else — VoiceOver read every overdue
 * row as "warning, overdue". Colour carries the alarm; `a11yLabel` carries the
 * meaning.
 */
export function getDueChip(
  task: Task,
  c: ThemeColors,
  now: Date = new Date(),
): { label: string; bg: string; fg: string; a11yLabel: string } | null {
  if (!task.dueDate) return null;
  if (task.isCompleted) {
    return { label: '✓ Done', bg: c.tealDim, fg: c.accent, a11yLabel: 'Done' };
  }
  const daysLeft = calcDaysUntilDue(task, now);
  // null covers a malformed dueDate as well as a missing one. Without this the
  // old code fell through to `Due ${dayName}` and rendered "Due Invalid Date" —
  // reachable, because tasks hydrate from an unvalidated AsyncStorage cache.
  if (daysLeft === null) return null;

  // A past-due recurring instance is a stale row awaiting the next spawn, not a
  // missed deadline. One due today is a habit you still have time to do.
  if (task.parentTaskId && daysLeft < 0) return null;

  if (daysLeft < 0) {
    const label = formatOverdue(daysLeft);
    const fresh = daysLeft >= -2;
    return {
      label,
      bg: fresh ? c.warning + '1A' : c.ROSE_DIM,
      fg: fresh ? c.warning : c.ROSE,
      a11yLabel: label,
    };
  }
  if (daysLeft === 0) {
    return { label: 'Due today', bg: c.warning + '1A', fg: c.warning, a11yLabel: 'Due today' };
  }
  if (daysLeft === 1) {
    return { label: 'Due tomorrow', bg: c.warning + '1A', fg: c.warning, a11yLabel: 'Due tomorrow' };
  }
  const due = parseLocalDate(task.dueDate.substring(0, 10));
  if (daysLeft <= 6) {
    const dayName = due.toLocaleDateString('en-US', { weekday: 'short' });
    return {
      label: `Due ${dayName}`,
      bg: c.warning + '1A',
      fg: c.warning,
      a11yLabel: `Due in ${daysLeft} days, ${dayName}`,
    };
  }
  if (daysLeft <= 13) {
    return {
      label: `Due in ${daysLeft}d`,
      bg: c.inactive,
      fg: c.subtext,
      a11yLabel: `Due in ${daysLeft} days`,
    };
  }
  const date = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label: `Due ${date}`, bg: c.inactive, fg: c.subtext, a11yLabel: `Due ${date}` };
}

// Time-per-category grouping used to live here, resolving each session's tag on
// the client. It is gone: the server freezes a session's tag when it is saved
// and GET /time-report aggregates it, so the Time Tracker card and the full
// report read one number from one place. Two implementations of "which tag does
// this session belong to" is how they came to disagree in the first place.

/**
 * A duration short enough to sit under a 40px-wide bar: "45m", "1.5h", "12h".
 */
export function compactDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

// How many not-scheduled-today recurring rows to show before collapsing behind
// "Show N more". Three keeps the tail short for someone with many habits.
// The main tab's Tasks zone holds four rows total: three real tasks plus up to
// one recurring, so a habit is visible without opening the drill-down and today's
// work still leads.

// ─── Date helpers for hero card / pill strip ─────────────────────────────────
export function isYesterdayLocal(ts: number): boolean {
  const d = new Date(ts); const y = new Date(); y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
}
export function startOfThisWeekMs(): number {
  const d = new Date(); const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); d.setHours(0, 0, 0, 0); return d.getTime();
}
export function startOfWeekNMs(n: number): number { return startOfThisWeekMs() - n * 7 * 86_400_000; }

export function getLastWeekCompletionRate(tasks: Task[]): number | null {
  const thisStart = startOfThisWeekMs(); const lastStart = startOfWeekNMs(1);
  const active = tasks.filter((t) => !t.isArchived);
  const planned = active.filter((t) => { const ts = new Date(t.createdAt).getTime(); return ts >= lastStart && ts < thisStart; });
  if (planned.length === 0) return null;
  const done = active.filter((t) => {
    if (!t.isCompleted || !t.completedAt) return false;
    const ts = new Date(t.completedAt).getTime(); return ts >= lastStart && ts < thisStart;
  });
  return Math.round((done.length / planned.length) * 100);
}

// diffCalendarDaysTasks lived here. It parsed Task.dueDate as an instant and then
// read LOCAL calendar fields off it, and because dueDate is stored at UTC midnight
// that measured a day early for every user west of UTC. Callers use
// daysUntilDue(task.dueDate, now) from utils/date.ts, which compares UTC midnights
// on both sides and takes the raw string rather than a pre-parsed Date.

// ─── Peak focus ───────────────────────────────────────────────────────────────
/**
 * The hour of day (0-23) where the most focus TIME lands. Needs >=5 sessions.
 *
 * Previously ranked by session COUNT, which meant an hour holding three
 * five-minute sessions beat an hour holding one ninety-minute one — the
 * opposite of what a "peak focus" readout is asked for. It also disagreed with
 * the server's `mostProductiveHour`, which has always ranked by seconds, so the
 * Tasks screen and the task stats sheet could name two different peak hours
 * from the same sessions. Both now measure time.
 */
export function getPeakHour(sessions: SessionRecord[]): number | null {
  if (sessions.length < 5) return null;
  const secondsByHour: Record<number, number> = {};
  for (const s of sessions) {
    const h = new Date(s.completedAt).getHours();
    secondsByHour[h] = (secondsByHour[h] ?? 0) + s.durationSeconds;
  }
  let peak = -1; let max = 0;
  for (const [h, seconds] of Object.entries(secondsByHour)) {
    if (seconds > max) { max = seconds; peak = Number(h); }
  }
  return peak >= 0 ? peak : null;
}

// Converts a 24h integer to a 2-hour window string.
// Examples: 9 → "9 – 11am", 21 → "9 – 11pm", 22 → "10pm – 12am", 23 → "11pm – 1am"
export function formatPeakWindow(hour: number): string {
  const end = (hour + 2) % 24;
  const sSuffix = hour < 12 ? 'am' : 'pm';
  const eSuffix = end  < 12 ? 'am' : 'pm';
  const sDisplay = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const eDisplay = end  === 0 ? 12 : end  > 12 ? end  - 12 : end;
  return sSuffix === eSuffix
    ? `${sDisplay} – ${eDisplay}${eSuffix}`
    : `${sDisplay}${sSuffix} – ${eDisplay}${eSuffix}`;
}

// ─── Completion rate ──────────────────────────────────────────────────────────
// "Planned" = created in the period; "Completed" = completedAt in the period.
// Returns null (→ "—") when no tasks were planned; 0 when planned > 0 but none done.
export function getCompletionRate(tasks: Task[], period: string): number | null {
  const active = tasks.filter((t) => !t.isArchived);
  const planned = active.filter((t) => {
    const ts = new Date(t.createdAt).getTime();
    if (period === 'today') return isToday(ts);
    if (period === 'week')  return isThisWeek(ts);
    if (period === 'month') return isThisMonth(ts);
    return true;
  });
  if (planned.length === 0) return null;
  const completed = active.filter((t) => {
    if (!t.isCompleted || !t.completedAt) return false;
    const ts = new Date(t.completedAt).getTime();
    if (period === 'today') return isToday(ts);
    if (period === 'week')  return isThisWeek(ts);
    if (period === 'month') return isThisMonth(ts);
    return true;
  });
  return Math.round((completed.length / planned.length) * 100);
}


/**
 * How far a task's actual time landed from its estimate, as words.
 *
 * The sheet used to show `estimationAccuracy` as `actual / estimate * 100`, so
 * a task that ran three times over reported "300%" — a number that reads as
 * excellent and means the opposite. Signed seconds said plainly cannot be
 * misread in either direction.
 */
export function formatEstimateDelta(deltaSeconds: number | null): string {
  if (deltaSeconds == null) return 'No estimate set';
  // Under a minute either way is the estimate being right, not a near miss.
  if (Math.abs(deltaSeconds) < 60) return 'Matched the estimate';
  const magnitude = formatSeconds(Math.abs(deltaSeconds));
  return deltaSeconds > 0 ? `${magnitude} over` : `${magnitude} under`;
}

/**
 * "today" / "yesterday" / "4d ago" for the last session.
 *
 * Compares local calendar days rather than elapsed hours: a session at 11pm
 * last night is "yesterday" at 1am, not "2h ago", which is what a person
 * actually means when asking when they last touched something.
 */
export function formatLastWorked(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Not started';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Not started';

  const dayOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((dayOf(now) - dayOf(then)) / 86_400_000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "5 of 7 days" — how consistently a task has actually been worked. */
export function formatConsistency(consistency: number | null): string {
  if (consistency == null) return '—';
  return `${Math.round(consistency * 100)}%`;
}
