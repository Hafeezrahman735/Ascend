import { describe, it, expect } from 'vitest';
import type { TaskGoal } from '../types';
import {
  goalReminderId,
  isGoalReminderId,
  reminderFireDate,
  goalRemindersToSchedule,
  GOAL_REMINDER_HOUR,
  MAX_GOAL_REMINDERS,
} from './goalReminders';

const goal = (over: Partial<TaskGoal> = {}): TaskGoal => ({
  id: 'g1',
  title: 'Ship the thesis',
  tag: null,
  targetSessions: null,
  progressMode: 'tasks',
  deadline: '2026-09-10',
  isCompleted: false,
  completedAt: null,
  isArchived: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  linkedTaskCount: 8,
  completedTaskCount: 3,
  actualSessions: 0,
  totalFocusSeconds: 0,
  elapsedDays: 10,
  taskProgress: 3 / 8,
  sessionProgress: null,
  overallProgress: 3 / 8,
  ...over,
});

/** Local noon, so no test result depends on the machine's UTC offset. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('goalReminderId', () => {
  it('is stable for a goal, so rescheduling replaces rather than duplicates', () => {
    expect(goalReminderId('abc')).toBe(goalReminderId('abc'));
    expect(goalReminderId('abc')).not.toBe(goalReminderId('abd'));
  });

  it('is recognisable among the app’s other scheduled notifications', () => {
    // The service uses this to find the ones it owns. The timer alarms and the
    // daily reminder must never match, or a goal sync would cancel them.
    expect(isGoalReminderId(goalReminderId('abc'))).toBe(true);
    expect(isGoalReminderId('ascend-focus-complete')).toBe(false);
    expect(isGoalReminderId('ascend-break-complete')).toBe(false);
    expect(isGoalReminderId('ascend-daily-reminder')).toBe(false);
  });
});

describe('reminderFireDate', () => {
  it('fires the morning before the due date, in LOCAL time', () => {
    // A deadline is a calendar day. Sep 10 means Sep 10 wherever you are, so
    // the fire time is built locally rather than from an instant — parsing it
    // as UTC and reading local fields is a day early west of Greenwich.
    const fire = reminderFireDate('2026-09-10', at(2026, 9, 1));
    expect(fire).not.toBeNull();
    expect(fire!.getFullYear()).toBe(2026);
    expect(fire!.getMonth()).toBe(8); // September
    expect(fire!.getDate()).toBe(9);
    expect(fire!.getHours()).toBe(GOAL_REMINDER_HOUR);
    expect(fire!.getMinutes()).toBe(0);
  });

  it('crosses a month boundary correctly', () => {
    const fire = reminderFireDate('2026-10-01', at(2026, 9, 20));
    expect(fire!.getMonth()).toBe(8); // September
    expect(fire!.getDate()).toBe(30);
  });

  it('crosses a year boundary correctly', () => {
    const fire = reminderFireDate('2027-01-01', at(2026, 12, 20));
    expect(fire!.getFullYear()).toBe(2026);
    expect(fire!.getMonth()).toBe(11);
    expect(fire!.getDate()).toBe(31);
  });

  it('holds the hour across a DST boundary', () => {
    // Day arithmetic goes through the Date constructor rather than subtracting
    // 86_400_000ms, so a clock change between now and the deadline cannot drag
    // the reminder to 08:00 or 10:00.
    const fire = reminderFireDate('2026-11-02', at(2026, 10, 25));
    expect(fire!.getHours()).toBe(GOAL_REMINDER_HOUR);
    expect(fire!.getDate()).toBe(1);
  });

  it('is null once the moment has passed', () => {
    // Due tomorrow, but it is already past 9am today — that reminder is gone.
    expect(reminderFireDate('2026-09-10', at(2026, 9, 9, 10))).toBeNull();
    // Due today.
    expect(reminderFireDate('2026-09-10', at(2026, 9, 10))).toBeNull();
    // Overdue. The in-app overdue state covers this, not a notification.
    expect(reminderFireDate('2026-09-01', at(2026, 9, 10))).toBeNull();
  });

  it('still fires earlier the same morning', () => {
    expect(reminderFireDate('2026-09-10', at(2026, 9, 9, 7))).not.toBeNull();
  });

  it('is null for a missing or malformed deadline', () => {
    expect(reminderFireDate(null, at(2026, 9, 1))).toBeNull();
    expect(reminderFireDate(undefined, at(2026, 9, 1))).toBeNull();
    expect(reminderFireDate('', at(2026, 9, 1))).toBeNull();
    expect(reminderFireDate('10/09/2026', at(2026, 9, 1))).toBeNull();
    expect(reminderFireDate('2026-09-10T00:00:00Z', at(2026, 9, 1))).toBeNull();
  });
});

describe('goalRemindersToSchedule', () => {
  const NOW = at(2026, 9, 1);

  it('schedules one reminder per open goal with a future deadline', () => {
    const out = goalRemindersToSchedule(
      [goal({ id: 'a', deadline: '2026-09-10' }), goal({ id: 'b', deadline: '2026-09-20' })],
      NOW,
    );
    expect(out.map((r) => r.goalId)).toEqual(['a', 'b']);
  });

  it('says how much is left, using a number from THIS goal', () => {
    const [r] = goalRemindersToSchedule([goal({ linkedTaskCount: 8, completedTaskCount: 3 })], NOW);
    expect(r.title).toBe('Ship the thesis');
    expect(r.body).toContain('5 of 8 tasks');
  });

  it('says so when nothing is linked, rather than "0 of 0 tasks"', () => {
    const [r] = goalRemindersToSchedule(
      [goal({ linkedTaskCount: 0, completedTaskCount: 0 })],
      NOW,
    );
    expect(r.body).toContain('no tasks linked');
  });

  it('tells you to close out a goal whose tasks are all done', () => {
    const [r] = goalRemindersToSchedule(
      [goal({ linkedTaskCount: 4, completedTaskCount: 4 })],
      NOW,
    );
    expect(r.body).toContain('close it out');
  });

  it('says "task" not "tasks" for a single one', () => {
    const [r] = goalRemindersToSchedule(
      [goal({ linkedTaskCount: 1, completedTaskCount: 0 })],
      NOW,
    );
    expect(r.body).toContain('1 of 1 task still open');
    expect(r.body).not.toContain('tasks');
  });

  it('skips completed and archived goals', () => {
    // Finishing a goal early has to silence it, which only works if this set is
    // the whole truth about what should be pending.
    const out = goalRemindersToSchedule(
      [
        goal({ id: 'done', isCompleted: true }),
        goal({ id: 'gone', isArchived: true }),
        goal({ id: 'live' }),
      ],
      NOW,
    );
    expect(out.map((r) => r.goalId)).toEqual(['live']);
  });

  it('skips goals with no deadline, and ones whose moment has passed', () => {
    const out = goalRemindersToSchedule(
      [
        goal({ id: 'undated', deadline: null }),
        goal({ id: 'past', deadline: '2026-08-01' }),
        goal({ id: 'future' }),
      ],
      NOW,
    );
    expect(out.map((r) => r.goalId)).toEqual(['future']);
  });

  it('orders soonest first', () => {
    const out = goalRemindersToSchedule(
      [
        goal({ id: 'later', deadline: '2026-12-01' }),
        goal({ id: 'sooner', deadline: '2026-09-05' }),
        goal({ id: 'middle', deadline: '2026-10-01' }),
      ],
      NOW,
    );
    expect(out.map((r) => r.goalId)).toEqual(['sooner', 'middle', 'later']);
  });

  it('caps the set, keeping the soonest — iOS drops the overflow silently', () => {
    // 64 pending notifications is the platform ceiling and it is shared with
    // the daily reminder and the timer alarms, so goals stay well under it.
    const many = Array.from({ length: MAX_GOAL_REMINDERS + 8 }, (_, i) =>
      goal({ id: `g${i}`, deadline: `2026-10-${String(i + 2).padStart(2, '0')}` }),
    );
    const out = goalRemindersToSchedule(many, NOW);

    expect(out).toHaveLength(MAX_GOAL_REMINDERS);
    expect(out[0].goalId).toBe('g0');
    expect(out.at(-1)!.goalId).toBe(`g${MAX_GOAL_REMINDERS - 1}`);
  });

  it('returns nothing for an empty goal list', () => {
    expect(goalRemindersToSchedule([], NOW)).toEqual([]);
  });
});
