import type { Task } from '../types';
import type { SessionRecord } from '../store/sync';
import { calcDaysUntilDue } from '../store/selectors/tasks';
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
export function filterByPeriod(sessions: SessionRecord[], period: string): SessionRecord[] {
  if (period === 'today') return sessions.filter((s) => isToday(s.completedAt));
  if (period === 'week')  return sessions.filter((s) => isThisWeek(s.completedAt));
  if (period === 'month') return sessions.filter((s) => isThisMonth(s.completedAt));
  return sessions;
}
export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600); const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`; return `${m}m`;
}
export function formatDuration(seconds: number): string {
  if (seconds >= 3600) { const h = Math.floor(seconds/3600); const m = Math.round((seconds%3600)/60); return m > 0 ? `${h}h ${m}m` : `${h}h`; }
  return `${Math.round(seconds/60)}m`;
}
export function getDueChip(task: Task, c: ThemeColors): { label: string; bg: string; fg: string } | null {
  if (!task.dueDate) return null;
  if (task.isCompleted) return { label: '✓ Done', bg: c.tealDim, fg: c.accent };
  const daysLeft = calcDaysUntilDue(task);
  if (daysLeft === null) return null;
  // Recurring instances are day-of habits, not deadlines — a past-due one is just a
  // stale instance awaiting cleanup on the next spawn, so never flag it "overdue".
  if (task.parentTaskId && daysLeft < 0) return null;
  const dueDateOnly = task.dueDate.substring(0, 10);
  const dayName = new Date(dueDateOnly + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  if (daysLeft < 0) return { label: '⚠ Overdue', bg: c.ROSE_DIM, fg: c.ROSE };
  if (daysLeft <= 3) return { label: `⚠ ${dayName}`, bg: c.ROSE_DIM, fg: c.ROSE };
  return { label: `Due ${dayName}`, bg: c.inactive, fg: c.subtext };
}

// ─── Time-per-category grouping ────────────────────────────────────────────────
export function buildCategoryMap(sessions: SessionRecord[], tasks: Task[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of sessions) {
    if (s.type !== 'focus') continue;
    const task = tasks.find((t) => t.id === s.taskId);
    const tag = task?.tags?.[0] ?? 'Untagged';
    map[tag] = (map[tag] ?? 0) + s.durationSeconds;
  }
  return map;
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

export function diffCalendarDaysTasks(a: Date, b: Date): number {
  const aD = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bD = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aD.getTime() - bD.getTime()) / 86_400_000);
}

// ─── Peak focus ───────────────────────────────────────────────────────────────
// Returns the hour-of-day (0–23) with the most sessions. Needs ≥5 sessions total.
export function getPeakHour(sessions: SessionRecord[]): number | null {
  if (sessions.length < 5) return null;
  const counts: Record<number, number> = {};
  for (const s of sessions) {
    const h = new Date(s.completedAt).getHours();
    counts[h] = (counts[h] ?? 0) + 1;
  }
  let peak = -1; let max = 0;
  for (const [h, c] of Object.entries(counts)) {
    if (c > max) { max = c; peak = Number(h); }
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

