import { dayNameFromLocalDate, utcDateStr } from '../../lib/localDate';
import { isScheduledOn as scheduleMatches } from '../../lib/recurrence';

/**
 * Projects recurring templates across a date range.
 *
 * A recurring task only ever has a real row for a day that has already been
 * spawned, and spawn-recurring archives every instance that is not due today.
 * So without projection the calendar can only ever show a recurring task on
 * today's date: past days were archived, future days do not exist yet.
 *
 * This walks the requested range and reports every day each template is
 * scheduled for, attaching the real instance when one exists (which carries the
 * completion state) and reporting a bare template occurrence when it does not.
 *
 * Uses the same `dayNameFromLocalDate` the spawner uses, so the calendar and the
 * spawner can never disagree about which days a template is scheduled for.
 */

export interface TemplateLike {
  id: string;
  recurringDays: string[];
  /**
   * When the template was created. Occurrences are never projected before this:
   * without the bound, creating a habit today makes every earlier day in the
   * month render as an un-completed occurrence, indistinguishable from a day the
   * user genuinely missed.
   */
  createdAt: Date;
}

export interface InstanceLike {
  parentTaskId: string | null;
  dueDate: Date | null;
}

export interface Occurrence<T extends TemplateLike, I extends InstanceLike> {
  /** 'YYYY-MM-DD' */
  date: string;
  template: T | null;
  /** The real row for this day, or null when nothing has been spawned yet. */
  instance: I | null;
}

/** Every 'YYYY-MM-DD' from start to end inclusive. */
export function eachDateInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return out;

  // Guard against an inverted or absurd range producing an unbounded loop.
  let guard = 0;
  while (cursor <= last && guard < 3660) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

/**
 * Scheduled on this date, and the template already existed then.
 * The schedule rule itself comes from lib/recurrence so there is one definition.
 */
export function isScheduledOn(template: TemplateLike, date: string): boolean {
  if (date < utcDateStr(template.createdAt)) return false;
  return scheduleMatches(template.recurringDays, date);
}

export function projectRecurring<T extends TemplateLike, I extends InstanceLike>(params: {
  templates: T[];
  instances: I[];
  start: string;
  end: string;
}): Occurrence<T, I>[] {
  const { templates, instances, start, end } = params;

  const byTemplateAndDate = new Map<string, I>();
  for (const instance of instances) {
    if (!instance.parentTaskId || !instance.dueDate) continue;
    byTemplateAndDate.set(
      `${instance.parentTaskId}|${instance.dueDate.toISOString().slice(0, 10)}`,
      instance,
    );
  }

  const out: Occurrence<T, I>[] = [];
  const claimed = new Set<string>();

  // Precomputed once per date rather than once per (date, template) pair: a
  // 400-day range across 20 templates is 8000 pairs, and each call otherwise
  // parses a new Date.
  const dates = eachDateInRange(start, end);
  const dayNames = new Map(dates.map((d) => [d, dayNameFromLocalDate(d)]));
  const createdOn = new Map(templates.map((t) => [t.id, utcDateStr(t.createdAt)]));

  for (const date of dates) {
    const dayName = dayNames.get(date)!;
    for (const template of templates) {
      if (date < createdOn.get(template.id)!) continue;
      if (template.recurringDays.length > 0 && !template.recurringDays.includes(dayName)) continue;
      const key = `${template.id}|${date}`;
      const instance = byTemplateAndDate.get(key) ?? null;
      if (instance) claimed.add(key);
      out.push({ date, template, instance });
    }
  }

  // Instances whose day the template is no longer scheduled for — the schedule
  // was edited after they were spawned. They are real completed work, so they
  // stay on the calendar rather than vanishing when a user changes the days.
  for (const [key, instance] of byTemplateAndDate) {
    if (claimed.has(key)) continue;
    const date = key.split('|')[1];
    out.push({ date, template: null, instance });
  }

  return out;
}
