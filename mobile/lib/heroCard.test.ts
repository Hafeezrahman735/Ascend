import { describe, it, expect } from 'vitest';
import {
  CARD_ORDER, URGENCY_WINDOW, isUrgencyEligible, hasUrgentTask, selectHeroCard,
  urgentTasks, overdueCount, shouldUrgencyLead, nextHeroMemory, EMPTY_HERO_MEMORY,
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

describe('urgentTasks — ordering and the floor', () => {
  const NOW2 = new Date(2026, 8, 1, 12, 0);
  const t = (id: string, dueDate: string) => task({ id, dueDate });

  it('leads with today, not with the most overdue', () => {
    // The regression this guards: sorting by days ascending put the MOST overdue
    // item first, which is close to a definition of the task the user has already
    // decided not to do — and with three rows it pushed today's real work off.
    const ordered = urgentTasks(
      [t('a', '2026-08-20'), t('b', '2026-09-01'), t('c', '2026-08-30')],
      NOW2,
    );
    expect(ordered.map((u) => u.task.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts tomorrow above overdue, and least-overdue first', () => {
    const ordered = urgentTasks(
      [t('late', '2026-08-25'), t('tmrw', '2026-09-02'), t('slip', '2026-08-31')],
      NOW2,
    );
    expect(ordered.map((u) => u.task.id)).toEqual(['tmrw', 'slip', 'late']);
  });

  it('drops work older than the floor so it cannot haunt the card forever', () => {
    expect(urgentTasks([t('ancient', '2026-08-01')], NOW2)).toHaveLength(0);
    expect(urgentTasks([t('inside', '2026-08-18')], NOW2)).toHaveLength(1);
  });

  it('is inclusive at exactly the floor and exactly the ceiling', () => {
    expect(urgentTasks([t('floor', '2026-08-18')], NOW2)).toHaveLength(1);   // -14
    expect(urgentTasks([t('below', '2026-08-17')], NOW2)).toHaveLength(0);   // -15
    expect(urgentTasks([t('ceil', '2026-09-07')], NOW2)).toHaveLength(1);    // +6
    expect(urgentTasks([t('above', '2026-09-08')], NOW2)).toHaveLength(0);   // +7
  });

  it('breaks ties stably rather than inheriting server order', () => {
    const a = urgentTasks([t('z', '2026-09-03'), t('a', '2026-09-03')], NOW2);
    const b = urgentTasks([t('a', '2026-09-03'), t('z', '2026-09-03')], NOW2);
    expect(a.map((u) => u.task.id)).toEqual(b.map((u) => u.task.id));
  });

  it('counts only the past-due ones as overdue', () => {
    expect(overdueCount([t('x', '2026-08-30'), t('y', '2026-09-03')], NOW2)).toBe(1);
  });
});

describe('shouldUrgencyLead — the cap that stops a permanent red card', () => {
  const TODAY = '2026-09-01';

  it('never leads with nothing overdue', () => {
    expect(shouldUrgencyLead(EMPTY_HERO_MEMORY, 0, TODAY)).toBe(false);
  });

  it('leads the first time overdue work appears', () => {
    expect(shouldUrgencyLead(EMPTY_HERO_MEMORY, 1, TODAY)).toBe(true);
  });

  it('yields once it has already led today with the same pile', () => {
    // Without this the card returns on every single app open, forever: the manual
    // override resets on every tab focus, so swiping away never survives.
    expect(shouldUrgencyLead({ overdueSeen: 3, ledOn: TODAY }, 3, TODAY)).toBe(false);
  });

  it('leads again when the pile grows within the day', () => {
    expect(shouldUrgencyLead({ overdueSeen: 3, ledOn: TODAY }, 4, TODAY)).toBe(true);
  });

  it('leads again tomorrow', () => {
    expect(shouldUrgencyLead({ overdueSeen: 3, ledOn: '2026-08-31' }, 3, TODAY)).toBe(true);
  });

  it('does not lead when the pile shrank but the day has not turned', () => {
    expect(shouldUrgencyLead({ overdueSeen: 5, ledOn: TODAY }, 2, TODAY)).toBe(false);
  });

  it('resets on zero, so a cleared list can raise the card again later', () => {
    // The inverse failure: clear five items, acquire three, and a stale baseline
    // of 5 would mean the card never appears again.
    const cleared = nextHeroMemory(0, TODAY);
    expect(cleared).toEqual(EMPTY_HERO_MEMORY);
    expect(shouldUrgencyLead(cleared, 3, TODAY)).toBe(true);
  });
});

describe('the cap governs leading, never existing', () => {
  it('leaves an overdue task inside the window even when it may not lead', () => {
    // The card must stay in the rotation so the dot never disappears. A card that
    // vanished would read as the app hiding overdue work, not as it moving on.
    const NOW2 = new Date(2026, 8, 1, 12, 0);
    const tasks = [task({ id: 'a', dueDate: '2026-08-30' })];
    expect(shouldUrgencyLead({ overdueSeen: 1, ledOn: '2026-09-01' }, 1, '2026-09-01')).toBe(false);
    expect(urgentTasks(tasks, NOW2)).toHaveLength(1);
  });

  it('lets a task due today lead regardless of the overdue cap', () => {
    const NOW2 = new Date(2026, 8, 1, 12, 0);
    const card = selectHeroCard({
      tasks: [task({ id: 'a', dueDate: '2026-09-01' }), task({ id: 'b', dueDate: '2026-08-30' })],
      goals: [], sessionHistory: [], currentStreak: 0, peakHour: null,
      memory: { overdueSeen: 9, ledOn: '2026-09-01' }, now: NOW2,
    });
    expect(card).toBe('urgency');
  });

  it('yields the slot when overdue is capped and nothing else is due', () => {
    const NOW2 = new Date(2026, 8, 1, 12, 0);
    const card = selectHeroCard({
      tasks: [task({ id: 'b', dueDate: '2026-08-30' })],
      goals: [], sessionHistory: [], currentStreak: 0, peakHour: null,
      memory: { overdueSeen: 1, ledOn: '2026-09-01' }, now: NOW2,
    });
    expect(card).not.toBe('urgency');
  });
});
