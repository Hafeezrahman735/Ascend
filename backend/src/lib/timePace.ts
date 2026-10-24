import { daysBetweenKeys } from './localParts';

/**
 * Planned focus time against an EVEN schedule from a goal's start to its
 * deadline. A comparison, not a prediction: "ahead" means more time has gone
 * in than an evenly spread plan would have by today, not that the goal will
 * finish on time. It is also not the task pace in mobile/lib/goalStats.ts,
 * which measures finished tasks; the two answer different questions.
 *
 * All days are local calendar days in the caller's zone. The deadline day is
 * inclusive, and so is the start day.
 *
 * Status precedence, first match wins:
 *   completed   the goal is done; pace no longer applies
 *   no_plan     no plannedMinutes
 *   reached     actual ≥ planned, even past the deadline
 *   past_due    today is after the deadline
 *   no_deadline nothing to spread the plan over
 *   ahead / behind / on_pace   actual vs expected, outside or inside a
 *               tolerance of max(15 min, 5% of planned)
 */

export type TimePaceStatus =
  | 'completed' | 'no_plan' | 'reached' | 'past_due' | 'no_deadline'
  | 'ahead' | 'behind' | 'on_pace';

export interface TimePace {
  status: TimePaceStatus;
  /** Planned minus actual, floored at 0. Null with no plan. */
  remainingSeconds: number | null;
  /** Where an even schedule would be by the end of today. Null when no schedule applies. */
  expectedSeconds: number | null;
  /** actual − expected. Null when no schedule applies. */
  deltaSeconds: number | null;
  /** Per day, today included, to finish by the deadline. Only when behind. */
  perDayToFinishSeconds: number | null;
}

export interface TimePaceInput {
  plannedMinutes: number | null;
  actualSeconds: number;
  isCompleted: boolean;
  /** Local date the goal was created, 'YYYY-MM-DD'. */
  startDay: string;
  /** 'YYYY-MM-DD' or null. */
  deadline: string | null;
  /** Today, 'YYYY-MM-DD', in the same zone as startDay. */
  today: string;
}

/** Below this, ahead and behind are noise; above it, 5% of the plan. */
export const PACE_TOLERANCE_FLOOR_SECONDS = 15 * 60;
export const PACE_TOLERANCE_SHARE = 0.05;

export function computeTimePace(input: TimePaceInput): TimePace {
  const { plannedMinutes, actualSeconds, isCompleted, startDay, deadline, today } = input;
  const none = { expectedSeconds: null, deltaSeconds: null, perDayToFinishSeconds: null };

  const planned = plannedMinutes === null ? null : plannedMinutes * 60;
  const remainingSeconds = planned === null ? null : Math.max(0, planned - actualSeconds);

  if (isCompleted) return { status: 'completed', remainingSeconds, ...none };
  if (planned === null) return { status: 'no_plan', remainingSeconds, ...none };
  if (actualSeconds >= planned) return { status: 'reached', remainingSeconds, ...none };
  if (deadline !== null && today > deadline) return { status: 'past_due', remainingSeconds, ...none };
  if (deadline === null) return { status: 'no_deadline', remainingSeconds, ...none };

  // A deadline before the start day (edited into the past, relative to the
  // goal's creation) leaves no schedule to spread over: the whole plan is due.
  let expectedSeconds = planned;
  if (deadline >= startDay) {
    const totalDays = daysBetweenKeys(startDay, deadline) + 1;
    const elapsedDays = Math.min(totalDays, Math.max(0, daysBetweenKeys(startDay, today) + 1));
    expectedSeconds = Math.round((planned * elapsedDays) / totalDays);
  }
  const deltaSeconds = actualSeconds - expectedSeconds;
  const tolerance = Math.max(PACE_TOLERANCE_FLOOR_SECONDS, planned * PACE_TOLERANCE_SHARE);

  if (deltaSeconds >= tolerance) {
    return { status: 'ahead', remainingSeconds, expectedSeconds, deltaSeconds, perDayToFinishSeconds: null };
  }
  if (deltaSeconds <= -tolerance) {
    const daysLeft = daysBetweenKeys(today, deadline) + 1;
    return {
      status: 'behind',
      remainingSeconds,
      expectedSeconds,
      deltaSeconds,
      perDayToFinishSeconds: Math.ceil((planned - actualSeconds) / daysLeft),
    };
  }
  return { status: 'on_pace', remainingSeconds, expectedSeconds, deltaSeconds, perDayToFinishSeconds: null };
}
