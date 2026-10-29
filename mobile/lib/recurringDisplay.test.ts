import { describe, it, expect } from 'vitest';
import {
  templatesWithoutTodayRow, daysUntil, nextOccurrenceLabel,
  type RecurringTemplate,
} from './recurringDisplay';
import type { Task } from '../types';

const base = {
  tags: [], isArchived: false, isCompleted: false,
  createdAt: '2026-08-18T00:00:00.000Z', sessionsOnTask: 0, totalTimeOnTask: 0,
  sessionDates: [], isRecurring: false, recurringDays: [], priority: 'medium',
};

const task = (over: Partial<Task> & { id: string }): Task =>
  ({ ...base, title: over.id, ...over } as Task);

const template = (
  over: Partial<RecurringTemplate> & { id: string },
): RecurringTemplate =>
  ({ ...base, isRecurring: true, title: over.id, ...over } as RecurringTemplate);

// 2026-08-18 is a Tuesday.
const TODAY = new Date('2026-08-18T12:00:00');

describe('templatesWithoutTodayRow', () => {
  it('shows a recurring task with no row today', () => {
    const t = template({ id: 'mw', scheduledToday: false });
    expect(templatesWithoutTodayRow([t], []).map((x) => x.id)).toEqual(['mw']);
  });

  it('hides one that has its day row in the list', () => {
    const t = template({ id: 'daily', scheduledToday: true });
    const row = task({ id: 'daily', isRecurring: true, isOccurrence: true });
    expect(templatesWithoutTodayRow([t], [row])).toEqual([]);
  });

  it('does not double-list one whose day row is ticked off', () => {
    const t = template({ id: 'daily', scheduledToday: true });
    const done = task({ id: 'daily', isRecurring: true, isOccurrence: true, isCompleted: true });
    expect(templatesWithoutTodayRow([t], [done])).toEqual([]);
  });

  it('is not fooled by a one-off task that happens to share nothing but a title', () => {
    const t = template({ id: 'daily', scheduledToday: false });
    expect(templatesWithoutTodayRow([t], [task({ id: 'other' })]).map((x) => x.id)).toEqual(['daily']);
  });

  it('ignores archived recurring tasks', () => {
    expect(templatesWithoutTodayRow([template({ id: 'x', scheduledToday: false, isArchived: true })], []))
      .toEqual([]);
  });
});

describe('daysUntil', () => {
  it('is 0 for today and 1 for tomorrow', () => {
    expect(daysUntil('2026-08-18', TODAY)).toBe(0);
    expect(daysUntil('2026-08-19', TODAY)).toBe(1);
  });

  it('crosses a month boundary', () => {
    expect(daysUntil('2026-09-01', new Date('2026-08-31T12:00:00'))).toBe(1);
  });

  it('is null when absent or unparseable', () => {
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil(undefined, TODAY)).toBeNull();
    expect(daysUntil('not-a-date', TODAY)).toBeNull();
  });
});

describe('nextOccurrenceLabel', () => {
  it('names tomorrow and a weekday further out', () => {
    expect(nextOccurrenceLabel(template({ id: 'a', nextOccurrence: '2026-08-19' }), TODAY))
      .toBe('Next: tomorrow');
    expect(nextOccurrenceLabel(template({ id: 'a', nextOccurrence: '2026-08-21' }), TODAY))
      .toBe('Next: Fri');
  });

  it('says so when no valid day is set', () => {
    expect(nextOccurrenceLabel(template({ id: 'a', nextOccurrence: null }), TODAY))
      .toBe('No days selected');
  });
});

describe('nextOccurrenceLabel — a habit that has stopped repeating', () => {
  /**
   * A recurring task used to run forever. Now a template's dueDate is the last
   * day it repeats, and the server stops sending a nextOccurrence past it.
   *
   * null means two different things and they need different copy: no weekdays
   * ticked, versus the repeat having ended. "No days selected" on an ended
   * habit sends the user hunting for a setting that is not the problem.
   */
  it('says it finished, not that no days are selected', () => {
    expect(nextOccurrenceLabel(
      template({ id: 'a', nextOccurrence: null, dueDate: '2026-08-01T00:00:00.000Z' }),
      TODAY,
    )).toBe('Finished repeating');
  });

  it('still says no days selected when there is no end date', () => {
    expect(nextOccurrenceLabel(
      template({ id: 'a', nextOccurrence: null, dueDate: null }),
      TODAY,
    )).toBe('No days selected');
  });

  it('is not finished on the end date itself', () => {
    // Inclusive everywhere else, inclusive here.
    expect(nextOccurrenceLabel(
      template({ id: 'a', nextOccurrence: '2026-08-18', dueDate: '2026-08-18T00:00:00.000Z' }),
      TODAY,
    )).not.toBe('Finished repeating');
  });

  it('is unaffected while the end date is still ahead', () => {
    expect(nextOccurrenceLabel(
      template({ id: 'a', nextOccurrence: '2026-08-19', dueDate: '2026-12-31T00:00:00.000Z' }),
      TODAY,
    )).toBe('Next: tomorrow');
  });
});
