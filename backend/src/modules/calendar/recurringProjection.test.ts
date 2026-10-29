import { describe, it, expect } from 'vitest';
import { projectRecurring, eachDateInRange } from './recurringProjection';

// Created well before the test range so most cases are unaffected by the
// createdAt bound; the bound gets its own tests below.
const task = (
  id: string,
  days: string[] = [],
  { createdAt = new Date('2020-01-01T00:00:00.000Z'), dueDate = null as Date | null, isArchived = false } = {},
) => ({ id, recurringDays: days, createdAt, dueDate, isArchived });

/** A task that stops repeating after `date`, inclusive. */
const endingOn = (id: string, days: string[], date: string) =>
  task(id, days, { dueDate: new Date(`${date}T00:00:00.000Z`) });

const doneOn = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([id, dates]) => [id, new Set(dates)]));

const project = (tasks: ReturnType<typeof task>[], start: string, end: string, done = doneOn({})) =>
  projectRecurring({ tasks, done, start, end }).map((o) => [o.task.id, o.date, o.isCompleted]);

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

describe('projectRecurring', () => {
  it('treats an empty recurringDays as every day', () => {
    expect(project([task('a')], MON, WED)).toEqual([
      ['a', MON, false], ['a', TUE, false], ['a', WED, false],
    ]);
  });

  it('skips days the task is not scheduled for', () => {
    expect(project([task('a', ['mon', 'wed'])], MON, WED)).toEqual([
      ['a', MON, false], ['a', WED, false],
    ]);
  });

  it('marks a day done from the log', () => {
    expect(project([task('a')], MON, TUE, doneOn({ a: [TUE] }))).toEqual([
      ['a', MON, false], ['a', TUE, true],
    ]);
  });

  it('still shows a done day the schedule no longer includes', () => {
    // A ticked-off day always counts: editing the schedule never wipes it.
    expect(project([task('a', ['mon'])], MON, TUE, doneOn({ a: [TUE] }))).toEqual([
      ['a', MON, false], ['a', TUE, true],
    ]);
  });

  it('emits each day once per task', () => {
    expect(project([task('a', ['mon'])], MON, MON, doneOn({ a: [MON] }))).toEqual([['a', MON, true]]);
  });

  it('projects several tasks independently', () => {
    expect(project([task('a', ['mon']), task('b', ['tue'])], MON, TUE)).toEqual([
      ['a', MON, false], ['b', TUE, false],
    ]);
  });

  it('returns nothing when there are no tasks', () => {
    expect(project([], MON, WED)).toEqual([]);
  });

  it('shows only the done days of a deleted task, projecting nothing', () => {
    const deleted = task('a', [], { isArchived: true });
    expect(project([deleted], MON, WED, doneOn({ a: [TUE] }))).toEqual([['a', TUE, true]]);
  });
});

describe('projectRecurring — createdAt bound', () => {
  it('does not project a task before it existed, and includes its creation day', () => {
    const created = task('a', [], { createdAt: new Date(`${TUE}T15:00:00.000Z`) });
    expect(project([created], MON, WED)).toEqual([['a', TUE, false], ['a', WED, false]]);
  });

  it('still shows a done day before the creation day', () => {
    // A user west of UTC can tick off a local day before the creation instant's UTC day.
    const created = task('a', [], { createdAt: new Date(`${TUE}T03:00:00.000Z`) });
    expect(project([created], MON, MON, doneOn({ a: [MON] }))).toEqual([['a', MON, true]]);
  });

  it('respects createdAt per task, not globally', () => {
    const late = task('b', [], { createdAt: new Date(`${WED}T00:00:00.000Z`) });
    expect(project([task('a'), late], TUE, WED)).toEqual([
      ['a', TUE, false], ['a', WED, false], ['b', WED, false],
    ]);
  });
});

describe('projectRecurring — the end date', () => {
  it('still fires ON the end date, and not after it', () => {
    expect(project([endingOn('a', [], TUE)], MON, WED)).toEqual([['a', MON, false], ['a', TUE, false]]);
  });

  it('never ends when dueDate is null', () => {
    expect(project([task('a')], MON, WED)).toHaveLength(3);
  });

  it('projects nothing for a task that ended before the range', () => {
    expect(project([endingOn('a', [], '2026-08-01')], MON, WED)).toEqual([]);
  });

  it('bounds each task independently', () => {
    expect(project([endingOn('a', [], MON), task('b', ['tue'])], MON, WED)).toEqual([
      ['a', MON, false], ['b', TUE, false],
    ]);
  });
});
