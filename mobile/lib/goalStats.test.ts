import { describe, it, expect } from 'vitest';
import {
  formatSeconds, daysUntil, shareOfLifetimeFocus, goalPace,
  goalStatusLine, goalStatCells, STALLED_AFTER_DAYS,
  type GoalStatsContext,
} from './goalStats';
import type { TaskGoal } from '../types';

const NOW = new Date(2026, 7, 26, 12, 0); // 26 Aug 2026, local noon
const DAY = 86_400_000;

function goal(over: Partial<TaskGoal> = {}): TaskGoal {
  return {
    id: 'g1',
    title: 'Ship the thesis',
    tag: null,
    targetSessions: null,
    progressMode: 'tasks',
    deadline: null,
    isCompleted: false,
    completedAt: null,
    isArchived: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    linkedTaskCount: 12,
    completedTaskCount: 6,
    actualSessions: 14,
    totalFocusSeconds: 34_800, // 9h 40m
    elapsedDays: 20,
    taskProgress: 0.5,
    sessionProgress: null,
    overallProgress: 0.5,
    ...over,
  };
}

function ctx(over: Partial<GoalStatsContext> = {}): GoalStatsContext {
  return { now: NOW, totalFocusMinutes: 2000, lastSessionAt: NOW.getTime(), ...over };
}

describe('formatSeconds', () => {
  it('formats hours and minutes', () => {
    expect(formatSeconds(34_800)).toBe('9h 40m');
    expect(formatSeconds(1500)).toBe('25m');
  });

  /**
   * The regression this guards is real and user-visible: goals hydrate from an
   * unvalidated AsyncStorage cache, so a cache written before a field existed
   * hands `undefined` to this function. The old implementation returned the
   * literal string "NaNm".
   */
  it('never returns NaN for absent or broken input', () => {
    expect(formatSeconds(undefined as unknown as number)).toBe('0m');
    expect(formatSeconds(NaN)).toBe('0m');
    expect(formatSeconds(Infinity)).toBe('0m');
    expect(formatSeconds(-5)).toBe('0m');
  });
});

describe('daysUntil', () => {
  it('counts forward, backward and today', () => {
    expect(daysUntil('2026-08-30', NOW)).toBe(4);
    expect(daysUntil('2026-08-20', NOW)).toBe(-6);
    expect(daysUntil('2026-08-26', NOW)).toBe(0);
  });

  it('is null for no deadline or a malformed one', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('next tuesday', NOW)).toBeNull();
  });
});

describe('shareOfLifetimeFocus', () => {
  /**
   * totalFocusSeconds is SECONDS, totalFocusMinutes is MINUTES. Dividing them
   * directly is wrong by 60x — the bug the first spec of this feature shipped.
   */
  it('converts seconds to minutes before comparing', () => {
    // 34800s = 580min of a 2000min life = 29%.
    expect(shareOfLifetimeFocus(goal(), 2000)).toBeCloseTo(0.29, 2);
  });

  it('is null when there is no lifetime focus to divide by', () => {
    expect(shareOfLifetimeFocus(goal(), 0)).toBeNull();
  });

  it('is null below the floor, so a rounding-error percentage never shows', () => {
    expect(shareOfLifetimeFocus(goal(), 100_000)).toBeNull();
  });

  it('never exceeds 100% when the stores disagree', () => {
    expect(shareOfLifetimeFocus(goal(), 1)).toBe(1);
  });
});

describe('goalPace', () => {
  it('reports on-track when the current rate finishes before the deadline', () => {
    // Half done in 20 days, 40 days left: 20 more days needed.
    expect(goalPace(goal({ deadline: '2026-10-05' }), NOW)?.onTrack).toBe(true);
  });

  it('reports behind when it does not', () => {
    const pace = goalPace(goal({ deadline: '2026-08-31' }), NOW);
    expect(pace?.onTrack).toBe(false);
    expect(pace?.perWeekNeeded).toBeGreaterThan(0);
  });

  /**
   * The day-one state of every goal ever created. progress/0 is Infinity, and
   * an Infinity forecast renders as a nonsense sentence.
   */
  it('is null on a goal created today, rather than dividing by zero', () => {
    const pace = goalPace(goal({ deadline: '2026-09-30', elapsedDays: 0 }), NOW);
    expect(pace).toBeNull();
  });

  it('is null with no deadline, no progress, or a passed deadline', () => {
    expect(goalPace(goal(), NOW)).toBeNull();
    expect(goalPace(goal({ deadline: '2026-09-30', overallProgress: 0 }), NOW)).toBeNull();
    expect(goalPace(goal({ deadline: '2026-08-01' }), NOW)).toBeNull();
  });

  it('counts in sessions when the goal measures sessions, tasks otherwise', () => {
    expect(goalPace(goal({ deadline: '2026-08-31' }), NOW)?.unit).toBe('task');
    const sessionGoal = goal({
      deadline: '2026-08-31', progressMode: 'sessions', targetSessions: 40,
    });
    expect(goalPace(sessionGoal, NOW)?.unit).toBe('session');
  });
});

describe('goalStatusLine — priority order', () => {
  it('leads with completion, and only there mentions how long it took', () => {
    const line = goalStatusLine(goal({ isCompleted: true, elapsedDays: 23 }), ctx());
    expect(line.text).toContain('Done in 23 days');
    expect(line.action).toBeUndefined();
  });

  it('asks for a link when nothing is linked, instead of showing zeros', () => {
    const line = goalStatusLine(goal({ linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }), ctx());
    expect(line.text).toContain('Nothing linked yet');
    expect(line.action).toBe('link-task');
  });

  it('asks for a session when tasks exist but no work has happened', () => {
    const line = goalStatusLine(goal({ actualSessions: 0 }), ctx());
    expect(line.action).toBe('start-session');
  });

  /**
   * The branch that matters most. A user who is one session in AND three weeks
   * past their deadline must be offered a way out, not congratulated on having
   * started. If this ordering breaks, the modal mocks the people it exists for.
   */
  it('puts a passed deadline above every encouraging branch', () => {
    const line = goalStatusLine(
      goal({ deadline: '2026-08-01', actualSessions: 1 }),
      ctx(),
    );
    expect(line.text).toContain('Past the deadline');
    expect(line.action).toBe('change-deadline');
  });

  it('names a stall without characterising it, and points forward', () => {
    const line = goalStatusLine(
      goal(),
      ctx({ lastSessionAt: NOW.getTime() - 11 * DAY }),
    );
    expect(line.text).toContain('Last session 11 days ago');
    expect(line.action).toBe('start-session');
  });

  it('does not call a goal stalled one day under the threshold', () => {
    const line = goalStatusLine(
      goal(),
      ctx({ lastSessionAt: NOW.getTime() - (STALLED_AFTER_DAYS - 1) * DAY }),
    );
    expect(line.text).not.toContain('Last session');
  });

  it('warms up on the first session, but only when nothing is wrong', () => {
    expect(goalStatusLine(goal({ actualSessions: 1 }), ctx()).text)
      .toBe("First session logged. That's the hardest one.");
  });

  it('falls back to banked effort when there is nothing to project', () => {
    expect(goalStatusLine(goal(), ctx()).text).toBe('9h 40m banked across 14 sessions.');
  });
});

describe('goalStatusLine — tone rules', () => {
  const cases: [string, TaskGoal, GoalStatsContext][] = [
    ['no tasks', goal({ linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }), ctx()],
    ['no sessions', goal({ actualSessions: 0 }), ctx()],
    ['overdue', goal({ deadline: '2026-08-01' }), ctx()],
    ['stalled', goal(), ctx({ lastSessionAt: NOW.getTime() - 30 * DAY })],
    ['behind', goal({ deadline: '2026-08-31' }), ctx()],
    ['healthy', goal({ deadline: '2026-10-05' }), ctx()],
    ['completed', goal({ isCompleted: true }), ctx()],
  ];

  it('never praises the user and never shouts, in any state', () => {
    for (const [name, g, c] of cases) {
      const { text } = goalStatusLine(g, c);
      expect(text, name).not.toMatch(/!/);
      expect(text.toLowerCase(), name).not.toMatch(/\b(great|amazing|awesome|well done|keep it up|crushing)\b/);
    }
  });

  it('always ends a struggling goal with something to do', () => {
    const struggling: [string, TaskGoal, GoalStatsContext][] = [
      ['no tasks', goal({ linkedTaskCount: 0, completedTaskCount: 0, actualSessions: 0 }), ctx()],
      ['no sessions', goal({ actualSessions: 0 }), ctx()],
      ['overdue', goal({ deadline: '2026-08-01' }), ctx()],
      ['stalled', goal(), ctx({ lastSessionAt: NOW.getTime() - 30 * DAY })],
    ];
    for (const [name, g, c] of struggling) {
      expect(goalStatusLine(g, c).action, name).toBeTruthy();
    }
  });

  /**
   * The invariant is about the GOAL'S AGE specifically, not about the word
   * "days". "Last session 11 days ago" is days-since-work and is allowed —
   * it is action-framed and the user can change it. "You made this 137 days
   * ago" is an accusation the user can do nothing about, so `elapsedDays`
   * appears only on a finished goal. The distinctive age below would collide
   * with nothing else in the sentence.
   */
  it("never shows the goal's own age on an in-flight goal, however old", () => {
    for (const [name, g, c] of cases) {
      if (g.isCompleted) continue;
      const aged = { ...g, elapsedDays: 137 };
      expect(goalStatusLine(aged, c).text, name).not.toContain('137');
    }
  });
});

describe('goalStatCells — progressMode gating', () => {
  /**
   * A fixed grid regresses this in both directions: a sessions-only goal
   * renders "0/0 tasks" and a goal with no target renders "4/null sessions".
   * The gating must mirror goalSubMetrics in tasks.tsx.
   */
  it('hides the tasks cell on a sessions-only goal', () => {
    const cells = goalStatCells(goal({ progressMode: 'sessions', targetSessions: 20 }), ctx());
    expect(cells.map((c) => c.key)).not.toContain('tasks');
    expect(cells.find((c) => c.key === 'sessions')?.value).toBe('14/20');
  });

  it('shows a bare session count when there is no target to measure against', () => {
    const cells = goalStatCells(goal({ progressMode: 'tasks', targetSessions: null }), ctx());
    const sessions = cells.find((c) => c.key === 'sessions');
    expect(sessions?.value).toBe('14');
    expect(sessions?.value).not.toContain('null');
  });

  it('shows both halves on a both-mode goal', () => {
    const cells = goalStatCells(goal({ progressMode: 'both', targetSessions: 20 }), ctx());
    expect(cells.map((c) => c.key)).toEqual(
      expect.arrayContaining(['tasks', 'sessions', 'avgSession']),
    );
  });

  it('omits the average when nothing has been logged, rather than dividing by zero', () => {
    const cells = goalStatCells(goal({ actualSessions: 0 }), ctx());
    expect(cells.map((c) => c.key)).not.toContain('avgSession');
    for (const cell of cells) expect(cell.value).not.toMatch(/NaN|Infinity/);
  });

  it('omits the share-of-life cell for a new account', () => {
    const cells = goalStatCells(goal(), ctx({ totalFocusMinutes: 0 }));
    expect(cells.map((c) => c.key)).not.toContain('shareOfLife');
  });

  it('never renders a broken number in any mode', () => {
    for (const mode of ['tasks', 'sessions', 'both'] as const) {
      for (const target of [null, 20]) {
        const cells = goalStatCells(goal({ progressMode: mode, targetSessions: target }), ctx());
        for (const cell of cells) {
          expect(cell.value, `${mode}/${target}`).not.toMatch(/NaN|Infinity|null|undefined/);
        }
      }
    }
  });
});
