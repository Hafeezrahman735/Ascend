import { Task } from '../../types';
import { daysUntilDue } from '../../utils/date';

export function calcSelectedTask(tasks: Task[], selectedTaskId: string | null): Task | null {
  if (!selectedTaskId) return null;
  return tasks.find((t) => t.id === selectedTaskId) ?? null;
}

export function calcTaskProgressFraction(task: Task | null): number | null {
  if (!task || !task.estimatedMinutes) return null;
  return Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60));
}

export function calcDaysWorked(task: Task): number {
  return new Set(task.sessionDates).size;
}

export function calcDaysUntilDue(task: Task, now: Date = new Date()): number | null {
  // Delegates rather than computing. The local-midnight subtraction that used to
  // live here returned -0 across a DST boundary, and `-0 < 0` is false, so every
  // overdue check downstream silently failed on that day.
  return daysUntilDue(task.dueDate, now);
}
