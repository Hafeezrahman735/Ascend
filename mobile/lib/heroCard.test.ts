import { describe, it, expect } from 'vitest';
import {
  CARD_ORDER, URGENCY_WINDOW, isUrgencyEligible, hasUrgentTask, selectHeroCard,
} from './heroCard';
import type { Task } from '../types';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'Task', isCompleted: false, isArchived: false,
    dueDate: null, parentTaskId: null, tags: [], priority: 'medium',
    sessionsOnTask: 0, totalTimeOnTask: 0, sessionDates: [],
    isRecurring: false, recurringDays: [], createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as unknown as Task;
}

const NOW = new Date(2026, 8, 1, 12, 0); // Tue 1 Sep 2026, midday

describe('isUrgencyEligible', () => {
  it('accepts an ordinary task inside the window', () => {
    expect(isUrgencyEligible(task(), 2)).toBe(true);
  });

  it('rejects completed and archived tasks', () => {
    expect(isUrgencyEligible(task({ isCompleted: true }), 2)).toBe(false);
    expect(isUrgencyEligible(task({ isArchived: true }), 2)).toBe(false);
  });

  it('keeps a recurring instance that is due today', () => {
    // The rule is about STALE habits, not habits. A recurring instance due today
    // is one you still have time to do, and dropping it would quietly remove
    // today's habits from the card.
    expect(isUrgencyEligible(task({ parentTaskId: 'tpl' }), 0)).toBe(true);
  });

  it('rejects a recurring instance that is past due', () => {
    // Mirrors getDueChip (taskMetrics.ts:51-53): a past-due instance is a stale
    // row awaiting the next spawn, not a missed deadline.
    expect(isUrgencyEligible(task({ parentTaskId: 'tpl' }), -1)).toBe(false);
  });
});

describe('hasUrgentTask', () => {
  it('finds a task due today, west of UTC', () => {
    // The bug this guards: dueDate is stored at UTC midnight, so reading local
    // calendar fields off the parsed instant measured today as -1 and excluded it.
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    expect(hasUrgentTask([task({ dueDate: '2026-09-01T00:00:00.000Z' })], NOW, 6)).toBe(true);
    process.env.TZ = tz;
  });

  it('respects the horizon at both ends', () => {
    const inside = [task({ dueDate: '2026-09-07' })];  // +6
    const outside = [task({ dueDate: '2026-09-08' })]; // +7
    expect(hasUrgentTask(inside, NOW, 6)).toBe(true);
    expect(hasUrgentTask(outside, NOW, 6)).toBe(false);
  });

  it('ignores tasks with no due date', () => {
    expect(hasUrgentTask([task({ dueDate: null })], NOW, 6)).toBe(false);
  });

  it('excludes a stale recurring instance', () => {
    expect(hasUrgentTask([task({ dueDate: '2026-08-20', parentTaskId: 'tpl' })], NOW, 6)).toBe(false);
  });
});

describe('the lead and rotation horizons agree with each other', () => {
  // The regression guard: selectHeroCard and the availableCards filter used to be
  // two hand-written copies of this predicate with different constants, and they
  // had already drifted — one lacked the recurring rule entirely. Anything urgent
  // enough to LEAD must also be present in the ROTATION, or the card wins the slot
  // and then is filtered out of the list it was supposed to render.
  it('never leads with something the rotation would exclude', () => {
    expect(URGENCY_WINDOW.lead).toBeLessThanOrEqual(URGENCY_WINDOW.rotation);
    for (let d = -3; d <= 10; d += 1) {
      const due = new Date(2026, 8, 1 + d);
      const t = [task({ dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` })];
      const leads = hasUrgentTask(t, NOW, URGENCY_WINDOW.lead);
      const inRotation = hasUrgentTask(t, NOW, URGENCY_WINDOW.rotation);
      if (leads) expect(inRotation).toBe(true);
    }
  });
});

describe('selectHeroCard', () => {
  const base = { goals: [], sessionHistory: [], currentStreak: 0, peakHour: null, now: NOW };

  it('leads with urgency when a task is due inside the lead window', () => {
    expect(selectHeroCard({ ...base, tasks: [task({ dueDate: '2026-09-02' })] })).toBe('urgency');
  });

  it('does not lead with urgency for a task outside the lead window', () => {
    expect(selectHeroCard({ ...base, tasks: [task({ dueDate: '2026-09-06' })] })).not.toBe('urgency');
  });

  it('falls back to self_comparison with nothing to say', () => {
    expect(selectHeroCard({ ...base, tasks: [] })).toBe('self_comparison');
  });

  it('always returns a card that exists in the rotation', () => {
    expect(CARD_ORDER).toContain(selectHeroCard({ ...base, tasks: [] }));
  });
});
