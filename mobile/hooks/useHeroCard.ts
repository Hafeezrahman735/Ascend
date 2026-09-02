import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useGamificationStore } from '../stores/gamificationStore';
import type { Task, TaskGoal } from '../types';
import type { SessionRecord } from '../store/sync';
import { daysUntilDue } from '../utils/date';

export type HeroCardType =
  | 'urgency'
  | 'goal_progress'
  | 'time_nudge'
  | 'momentum'
  | 'self_comparison'
  | 'recent_activity';

export const CARD_ORDER: HeroCardType[] = [
  'momentum',
  'goal_progress',
  'time_nudge',
  'self_comparison',
  'recent_activity',
  'urgency',
];

// ─── Pure date helpers ────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isTodayLocal(ts: number): boolean {
  return localDateStr(new Date(ts)) === localDateStr(new Date());
}

function diffMinutes(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 60_000);
}

// ─── Pure selection function — NO store reads ─────────────────────────────────

// Note: 'recent_activity' is deliberately absent from the priority chain below.
// Every other card is a nudge — it asks for an action right now. The activity log
// is a backward-looking record, so it earns a place in the rotation (swipe or tap
// a dot) but never preempts a card that is trying to get the user working.
export function selectHeroCard(params: {
  tasks: Task[];
  goals: TaskGoal[];
  sessionHistory: SessionRecord[];
  currentStreak: number;
  peakHour: number | null;
  now?: Date;
}): HeroCardType {
  const { tasks, goals, sessionHistory, currentStreak, peakHour, now = new Date() } = params;
  const hour = now.getHours();

  // Priority 1 — Urgency: any task due within 3 calendar days
  const hasUrgent = tasks.some((t) => {
    if (t.isCompleted || t.isArchived || !t.dueDate) return false;
    const days = daysUntilDue(t.dueDate, now);
    return days !== null && days >= 0 && days <= 3;
  });
  if (hasUrgent) return 'urgency';

  // Priority 2 — Time nudge: within ±30 min of peak hour, no session in last 60 min
  if (peakHour !== null && sessionHistory.length >= 5) {
    const nowMins = hour * 60 + now.getMinutes();
    const peakMins = peakHour * 60;
    const diff = Math.min(Math.abs(nowMins - peakMins), 1440 - Math.abs(nowMins - peakMins));
    const withinWindow = diff <= 30;
    const todaySessions = sessionHistory
      .filter((s) => isTodayLocal(s.completedAt))
      .sort((a, b) => b.completedAt - a.completedAt);
    const minsSinceLast = todaySessions[0]
      ? diffMinutes(now, new Date(todaySessions[0].completedAt))
      : Infinity;
    if (withinWindow && minsSinceLast > 60) return 'time_nudge';
  }

  // Priority 3 — Goal progress: 10am–6pm, active goals exist
  const activeGoals = goals.filter((g) => !g.isCompleted && !g.isArchived);
  if (hour >= 10 && hour < 18 && activeGoals.length > 0) return 'goal_progress';

  // Priority 4 — Momentum: morning or Mon/Tue and streak active
  const day = now.getDay();
  if (((hour >= 6 && hour < 10) || day === 1 || day === 2) && currentStreak > 0) {
    return 'momentum';
  }

  return 'self_comparison';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHeroCard(params: {
  tasks: Task[];
  goals: TaskGoal[];
  sessionHistory: SessionRecord[];
  peakHour: number | null;
}): {
  activeCard: HeroCardType;
  cardIndex: number;
  setCard: (card: HeroCardType) => void;
} {
  const currentStreak = useGamificationStore((s) => s.currentStreak);
  const [manualOverride, setManualOverride] = useState<HeroCardType | null>(null);

  // Reset manual override on every tab focus so auto-selection runs fresh
  useFocusEffect(
    useCallback(() => {
      setManualOverride(null);
    }, []),
  );

  const activeCard = manualOverride ?? selectHeroCard({ ...params, currentStreak });
  const cardIndex = CARD_ORDER.indexOf(activeCard);

  return { activeCard, cardIndex, setCard: setManualOverride };
}
