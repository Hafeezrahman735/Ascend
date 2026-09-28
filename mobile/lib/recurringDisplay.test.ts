import { describe, it, expect } from 'vitest';
import {
  templatesWithoutInstance, daysUntil, nextOccurrenceLabel,
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

describe('templatesWithoutInstance', () => {
  it('shows a template the server says is not scheduled today', () => {
    const t = template({ id: 'mw', scheduledToday: false });
    expect(templatesWithoutInstance([t], []).map((x) => x.id)).toEqual(['mw']);
  });

  it('shows a template scheduled today that has no instance', () => {
    // Dropping these is how recurring tasks vanished: a habit the spawner
    // skipped had no instance and was filtered out here too, so it showed
    // nowhere at all.
    const dueButUnspawned = template({ id: 'daily', scheduledToday: true });
    expect(templatesWithoutInstance([dueButUnspawned], []).map((x) => x.id)).toEqual(['daily']);
  });

  it('hides a template that already has a live instance', () => {
    const t = template({ id: 'daily', scheduledToday: false });
    expect(templatesWithoutInstance([t], [task({ id: 'i', parentTaskId: 'daily' })])).toEqual([]);
  });

  it('treats an archived instance as absent', () => {
    const t = template({ id: 'daily', scheduledToday: false });
    const archived = task({ id: 'i', parentTaskId: 'daily', isArchived: true });
    expect(templatesWithoutInstance([t], [archived]).map((x) => x.id)).toEqual(['daily']);
  });

  it('does not double-list a habit whose instance is completed but still live', () => {
    // Completion does not archive, so the instance still stands in for it.
    const t = template({ id: 'daily', scheduledToday: true });
    const done = task({ id: 'i', parentTaskId: 'daily', isCompleted: true });
    expect(templatesWithoutInstance([t], [done])).toEqual([]);
  });

  it('ignores archived templates', () => {
    expect(templatesWithoutInstance([template({ id: 'x', scheduledToday: false, isArchived: true })], []))
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
