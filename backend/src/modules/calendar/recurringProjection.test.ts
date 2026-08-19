import { describe, it, expect } from 'vitest';
import { projectRecurring, eachDateInRange, isScheduledOn } from './recurringProjection';

// Created well before the test range so existing cases are unaffected by the
// createdAt bound; the bound gets its own tests below.
const template = (id: string, days: string[] = [], createdAt = new Date('2020-01-01T00:00:00.000Z')) =>
  ({ id, recurringDays: days, createdAt });
const instance = (parentTaskId: string, date: string, extra: Record<string, unknown> = {}) => ({
  parentTaskId,
  dueDate: new Date(`${date}T00:00:00.000Z`),
  ...extra,
});

// 2026-08-17 is a Monday.
const MON = '2026-08-17';
const TUE = '2026-08-18';
const WED = '2026-08-19';

describe('eachDateInRange', () => {
  it('is inclusive of both ends', () => {
    expect(eachDateInRange(MON, WED)).toEqual([MON, TUE, WED]);
  });

  it('returns a single day for a one-day range', () => {
    expect(eachDateInRange(MON, MON)).toEqual([MON]);
  });

  it('returns nothing for an inverted range instead of looping forever', () => {
    expect(eachDateInRange(WED, MON)).toEqual([]);
  });
});

describe('isScheduledOn', () => {
  it('treats an empty recurringDays as every day', () => {
    expect(isScheduledOn(template('t'), MON)).toBe(true);
    expect(isScheduledOn(template('t'), TUE)).toBe(true);
  });

  it('matches only the listed days', () => {
    const monWed = template('t', ['mon', 'wed']);
    expect(isScheduledOn(monWed, MON)).toBe(true);
    expect(isScheduledOn(monWed, TUE)).toBe(false);
    expect(isScheduledOn(monWed, WED)).toBe(true);
  });
});

describe('projectRecurring', () => {
  it('reports a scheduled day that has no instance row', () => {
    // The bug this exists to prevent: spawn-recurring only ever creates a row
    // for today, so without projection a daily habit appeared on the calendar
    // exactly once no matter how wide the range.
    const out = projectRecurring({
      templates: [template('daily')],
      instances: [],
      start: MON,
      end: WED,
    });

    expect(out.map((o) => o.date)).toEqual([MON, TUE, WED]);
    expect(out.every((o) => o.instance === null)).toBe(true);
  });

  it('attaches the real instance when one exists for that day', () => {
    const done = instance('daily', TUE, { isCompleted: true });
    const out = projectRecurring({
      templates: [template('daily')],
      instances: [done],
      start: MON,
      end: WED,
    });

    const tuesday = out.find((o) => o.date === TUE);
    expect(tuesday?.instance).toBe(done);
    // The other two days are still reported, just without a row.
    expect(out.filter((o) => o.instance === null)).toHaveLength(2);
  });

  it('keeps archived history visible', () => {
    // spawn-recurring archives every instance not due today. The calendar used
    // to filter isArchived, which erased weeks of completed habits. Projection
    // must surface them, so archived rows are passed in and matched.
    const archived = instance('daily', MON, { isCompleted: true, isArchived: true });
    const out = projectRecurring({
      templates: [template('daily')],
      instances: [archived],
      start: MON,
      end: WED,
    });

    expect(out.find((o) => o.date === MON)?.instance).toBe(archived);
  });

  it('skips days the template is not scheduled for', () => {
    const out = projectRecurring({
      templates: [template('mw', ['mon', 'wed'])],
      instances: [],
      start: MON,
      end: WED,
    });

    expect(out.map((o) => o.date)).toEqual([MON, WED]);
  });

  it('still shows an instance whose day is no longer scheduled', () => {
    // The user completed it on Tuesday, then edited the schedule to Mon/Wed.
    // That Tuesday completion is real work and must not vanish from history.
    const tuesdayDone = instance('mw', TUE, { isCompleted: true });
    const out = projectRecurring({
      templates: [template('mw', ['mon', 'wed'])],
      instances: [tuesdayDone],
      start: MON,
      end: WED,
    });

    const tuesday = out.find((o) => o.date === TUE);
    expect(tuesday?.instance).toBe(tuesdayDone);
    expect(tuesday?.template).toBeNull();
  });

  it('does not emit the same day twice for one template', () => {
    const out = projectRecurring({
      templates: [template('daily')],
      instances: [instance('daily', TUE)],
      start: MON,
      end: WED,
    });

    const keys = out.map((o) => `${o.template?.id ?? o.instance?.parentTaskId}|${o.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('projects several templates independently', () => {
    const out = projectRecurring({
      templates: [template('daily'), template('mw', ['mon', 'wed'])],
      instances: [],
      start: MON,
      end: WED,
    });

    expect(out.filter((o) => o.template?.id === 'daily')).toHaveLength(3);
    expect(out.filter((o) => o.template?.id === 'mw')).toHaveLength(2);
  });

  it('returns nothing when there are no templates and no instances', () => {
    expect(projectRecurring({ templates: [], instances: [], start: MON, end: WED })).toEqual([]);
  });
});

describe('projectRecurring — createdAt bound', () => {
  it('does not project a template before it existed', () => {
    // Creating a habit today used to paint every earlier day of the month as an
    // un-completed occurrence, indistinguishable from days genuinely missed.
    const madeToday = template('new', [], new Date(`${WED}T00:00:00.000Z`));
    const out = projectRecurring({
      templates: [madeToday],
      instances: [],
      start: MON,
      end: WED,
    });

    expect(out.map((o) => o.date)).toEqual([WED]);
  });

  it('includes the creation day itself', () => {
    const madeTuesday = template('new', [], new Date(`${TUE}T00:00:00.000Z`));
    const out = projectRecurring({
      templates: [madeTuesday], instances: [], start: MON, end: WED,
    });
    expect(out.map((o) => o.date)).toEqual([TUE, WED]);
  });

  it('still surfaces a real instance predating the template record', () => {
    // Defensive: if data ever has an instance older than its template, it is
    // real completed work and must not disappear.
    const madeWed = template('t', [], new Date(`${WED}T00:00:00.000Z`));
    const old = instance('t', MON, { isCompleted: true });
    const out = projectRecurring({
      templates: [madeWed], instances: [old], start: MON, end: WED,
    });
    expect(out.find((o) => o.date === MON)?.instance).toBe(old);
  });

  it('respects createdAt per template, not globally', () => {
    const oldT = template('old', []);
    const newT = template('new', [], new Date(`${WED}T00:00:00.000Z`));
    const out = projectRecurring({
      templates: [oldT, newT], instances: [], start: MON, end: WED,
    });
    expect(out.filter((o) => o.template?.id === 'old')).toHaveLength(3);
    expect(out.filter((o) => o.template?.id === 'new')).toHaveLength(1);
  });
});
