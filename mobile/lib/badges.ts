import type { SubjectBadge, BadgeLevel } from '../types/profile';
import { BADGE_THRESHOLDS } from '../types/profile';
import type { Task } from '../types';

const LEVEL_ORDER: BadgeLevel[] = ['gold', 'silver', 'bronze', 'locked'];

function toLevel(count: number): BadgeLevel {
  if (count >= BADGE_THRESHOLDS.gold)   return 'gold';
  if (count >= BADGE_THRESHOLDS.silver) return 'silver';
  if (count >= BADGE_THRESHOLDS.bronze) return 'bronze';
  return 'locked';
}

export function computeSubjectBadges(tasks: Task[]): SubjectBadge[] {
  const tagCounts: Record<string, number> = {};

  for (const task of tasks) {
    for (const tag of task.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + task.sessionsOnTask;
    }
  }

  return Object.entries(tagCounts)
    .map(([tag, count]) => ({
      tag,
      icon: '📚',
      level: toLevel(count),
      sessionCount: count,
    }))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
}
