import { describe, it, expect } from 'vitest';
import {
  dormantTemplates, daysUntil, nextOccurrenceLabel, composeTaskList,
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

describe('dormantTemplates', () => {
  it('shows a template the server says is not scheduled today', () => {
    const t = template({ id: 'mw', scheduledToday: false });
    expect(dormantTemplates([t], []).map((x) => x.id)).toEqual(['mw']);
  });

  it('NEVER shows a template that IS scheduled today, even with no instance', () => {
    // The bug this prevents: a failed spawn, a cold-start race or a deleted
    // instance all leave a due-today habit with no row. Treating that as dormant
    // rendered the one habit you must do today as dimmed and uncompletable,
    // labelled "Due today".
    const dueButUnspawned = template({ id: 'daily', scheduledToday: true });
    expect(dormantTemplates([dueButUnspawned], [])).toEqual([]);
  });

  it('treats a missing scheduledToday as scheduled, not dormant', () => {
    // Older server without the field: fail safe, never grey out a habit.
    const legacy = template({ id: 'legacy' });
    expect(dormantTemplates([legacy], [])).toEqual([]);
  });

  it('hides a template that already has a live instance', () => {
    const t = template({ id: 'daily', scheduledToday: false });
    expect(dormantTemplates([t], [task({ id: 'i', parentTaskId: 'daily' })])).toEqual([]);
  });

  it('treats an archived instance as absent', () => {
    const t = template({ id: 'daily', scheduledToday: false });
    const archived = task({ id: 'i', parentTaskId: 'daily', isArchived: true });
    expect(dormantTemplates([t], [archived]).map((x) => x.id)).toEqual(['daily']);
  });

  it('keeps showing a template whose instance is completed but still live', () => {
    // Completion does not archive, so the template must not reappear as dormant
    // and double-list itself.
    const t = template({ id: 'daily', scheduledToday: true });
    const done = task({ id: 'i', parentTaskId: 'daily', isCompleted: true });
    expect(dormantTemplates([t], [done])).toEqual([]);
  });

  it('ignores archived templates', () => {
    expect(dormantTemplates([template({ id: 'x', scheduledToday: false, isArchived: true })], []))
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

describe('composeTaskList', () => {
  const tasks = [task({ id: 't1' }), task({ id: 't2' })];
  const dormant = [
    template({ id: 'far', scheduledToday: false, nextOccurrence: '2026-08-22' }),
    template({ id: 'soon', scheduledToday: false, nextOccurrence: '2026-08-19' }),
  ];

  it('puts real tasks first and dormant last', () => {
    const { items } = composeTaskList({ tasks, templates: dormant, filter: 'all', from: TODAY });
    expect(items.map((i) => i.kind)).toEqual(['task', 'task', 'dormant', 'dormant']);
  });

  it('orders dormant by soonest next occurrence', () => {
    const { items } = composeTaskList({ tasks: [], templates: dormant, filter: 'all', from: TODAY });
    expect(items.map((i) => (i.kind === 'dormant' ? i.template.id : ''))).toEqual(['soon', 'far']);
  });

  it('shows dormant under the all filter only', () => {
    for (const filter of ['active', 'pending', 'done'] as const) {
      const { items } = composeTaskList({ tasks, templates: dormant, filter, from: TODAY });
      expect(items.every((i) => i.kind === 'task')).toBe(true);
    }
  });

  it('caps dormant and reports how many are hidden', () => {
    const { items, dormantTotal, dormantHidden } = composeTaskList({
      tasks: [], templates: dormant, filter: 'all', from: TODAY, limitDormant: 1,
    });
    expect(items).toHaveLength(1);
    expect(dormantTotal).toBe(2);
    expect(dormantHidden).toBe(1);
  });

  it('reports zero hidden when everything fits', () => {
    const { dormantHidden } = composeTaskList({
      tasks: [], templates: dormant, filter: 'all', from: TODAY, limitDormant: 10,
    });
    expect(dormantHidden).toBe(0);
  });

  it('returns only real tasks when there are no templates', () => {
    const { items, dormantTotal } = composeTaskList({
      tasks, templates: [], filter: 'all', from: TODAY,
    });
    expect(items).toHaveLength(2);
    expect(dormantTotal).toBe(0);
  });

  it('is empty for no tasks and no templates', () => {
    const { items } = composeTaskList({ tasks: [], templates: [], filter: 'all', from: TODAY });
    expect(items).toEqual([]);
  });
});
