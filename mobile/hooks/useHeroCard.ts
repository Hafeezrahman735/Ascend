import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { useGamificationStore } from '../stores/gamificationStore';
import { useAuthStore } from '../stores/authStore';
import type { Task, TaskGoal } from '../types';
import type { SessionRecord } from '../store/sync';
import {
  CARD_ORDER, selectHeroCard, overdueCount, type HeroCardType,
} from '../lib/heroCard';
import { useHeroCardStore } from '../stores/heroCardStore';
import { getLocalDateString } from '../utils/date';

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
  const memory = useHeroCardStore((s) => s.memory);
  const [manualOverride, setManualOverride] = useState<HeroCardType | null>(null);

  // Reset manual override on every tab focus so auto-selection runs fresh
  useFocusEffect(
    useCallback(() => {
      setManualOverride(null);
    }, []),
  );

  const activeCard = manualOverride ?? selectHeroCard({ ...params, currentStreak, memory });
  const cardIndex = CARD_ORDER.indexOf(activeCard);

  // Record that overdue work took the slot, so it yields to the rotation until
  // tomorrow or until the pile grows. Written on the way out rather than inside
  // selectHeroCard, which stays pure. Guarded on `manualOverride` so swiping TO
  // the card by hand does not burn the day's lead.
  const auto = manualOverride === null;
  useEffect(() => {
    if (!auto || activeCard !== 'urgency') return;
    const count = overdueCount(params.tasks, new Date());
    if (count <= 0) return;
    const userId = useAuthStore.getState().user?.id ?? '';
    useHeroCardStore.getState().markLed(userId, count, getLocalDateString());
  }, [auto, activeCard, params.tasks]);

  return { activeCard, cardIndex, setCard: setManualOverride };
}
