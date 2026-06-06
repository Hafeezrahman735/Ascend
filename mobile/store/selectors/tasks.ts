import { Task } from '../../types';

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

export function calcDaysUntilDue(task: Task): number | null {
  if (!task.dueDate) return null;
  // Normalize both "YYYY-MM-DD" (local form) and full ISO strings from the backend
  const dateOnly = task.dueDate.substring(0, 10);
  const due = new Date(dateOnly + 'T00:00:00').getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.ceil((due - now) / 86_400_000);
}
