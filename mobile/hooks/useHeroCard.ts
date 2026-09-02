import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useGamificationStore } from '../stores/gamificationStore';
import type { Task, TaskGoal } from '../types';
import type { SessionRecord } from '../store/sync';
import { CARD_ORDER, selectHeroCard, type HeroCardType } from '../lib/heroCard';

/**
 * The store read and the manual override. Every decision lives in
 * lib/heroCard.ts, which is importable under Node; this file is not, because of
 * expo-router and the gamification store above.
 *
 * Re-exported below rather than moved outright so call sites keep one import.
 */
export { CARD_ORDER, selectHeroCard };
export type { HeroCardType };

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
