import { localPartsOf, weekdayOfDateKey } from './localParts';

/**
 * What a focus session was FOR, frozen at the moment it is saved.
 *
 * Attribution used to be resolved at read time, by looking the session's task
 * up in `GET /tasks` — which filters `isArchived: false`. Recurring habits
 * archive yesterday's instance every day, so a habit's sessions stopped
 * resolving overnight and fell through to "Untagged". A month of habit work
 * silently became uncategorised.
 *
 * Stamping instead of joining fixes that by construction, and buys two more
 * things: reports become a join-free GROUP BY on indexed columns, and a
 * February report still reads correctly after the task or goal behind it has
 * been renamed or deleted.
 *
 * The trade is that retagging a task does not rewrite history. That is the
 * intended behaviour, not a limitation: history records what was true then.
 */

export interface AttributionTask {
  title: string;
  tags: string[];
  priority: string | null;
  taskGoalId: string | null;
  isRecurring: boolean;
  parentTaskId: string | null;
}

export interface AttributionGoal {
  id: string;
  title: string;
}

export interface AttributionStamp {
  taskGoalId: string | null;
  goalTitleSnapshot: string | null;
  taskTitleSnapshot: string | null;
  primaryTag: string | null;
  tags: string[];
  priority: string | null;
  wasRecurring: boolean;
  localDate: string;
  localHour: number;
  localWeekday: number;
  localDateApprox: boolean;
}

export function buildAttribution(input: {
  /** Null for a free-form timer session with no task attached. */
  task: AttributionTask | null;
  /** The goal the task was linked to, if any. Null is normal. */
  goal: AttributionGoal | null;
  completedAt: Date;
  /**
   * Already resolved by `resolveLocalDate` — the client's own calendar day,
   * validated for plausibility. Authoritative: the device knows what day it is
   * for its user better than any zone we could infer server-side.
   */
  localDate: string;
  /** IANA zone from the client. Absent means the hour has to be inferred. */
  timeZone: string | null | undefined;
}): AttributionStamp {
  const { task, goal, completedAt, localDate, timeZone } = input;

  // Weekday is derived from localDate rather than from the timezone so it can
  // never disagree with the day it belongs to.
  const localWeekday = weekdayOfDateKey(localDate);

  let localHour: number;
  let localDateApprox: boolean;

  if (timeZone) {
    const parts = localPartsOf(completedAt, timeZone);
    localHour = parts.hour;
    // If the zone puts this instant on a different calendar day than the client
    // claimed, one of the two is wrong. Keep the client's date (it is
    // validated) but stop advertising the hour as exact.
    localDateApprox = parts.dateKey !== localDate;
  } else {
    // No zone sent: UTC is the only hour available. Marked approximate so the
    // report can footnote it instead of presenting a guess as a measurement.
    localHour = completedAt.getUTCHours();
    localDateApprox = true;
  }

  if (!task) {
    return {
      taskGoalId: null,
      goalTitleSnapshot: null,
      taskTitleSnapshot: null,
      primaryTag: null,
      tags: [],
      priority: null,
      wasRecurring: false,
      localDate,
      localHour,
      localWeekday,
      localDateApprox,
    };
  }

  const tags = task.tags ?? [];

  return {
    taskGoalId: task.taskGoalId ?? null,
    // Only stamped when the goal was actually resolved. A dangling goal id with
    // no title would render as a blank row in the report.
    goalTitleSnapshot: goal?.title ?? null,
    taskTitleSnapshot: task.title,
    // tags[0] drives the one breakdown that has to sum to 100%. The full set is
    // kept beside it so a multi-tag task is not reduced to its first tag, which
    // is what the old read-time path did.
    primaryTag: tags[0] ?? null,
    tags,
    priority: task.priority ?? null,
    // Sessions run against spawned instances (which carry parentTaskId), not
    // against the template (which carries isRecurring). Accept either so the
    // flag is right whichever row the session landed on.
    wasRecurring: !!(task.parentTaskId || task.isRecurring),
    localDate,
    localHour,
    localWeekday,
    localDateApprox,
  };
}
