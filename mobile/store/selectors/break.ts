import { calcSessionInCycle, computeIsLongBreak } from './timer';

export function calcBreakBlocks(pomodoroRounds: number, sessionsUntilLong: number, currentPhase: string): boolean[] {
  const filled = calcSessionInCycle(pomodoroRounds, sessionsUntilLong, currentPhase);
  return Array.from({ length: sessionsUntilLong }, (_, i) => i < filled);
}

export function calcBreakLabel(currentPhase: string): string {
  return currentPhase !== 'focus' ? 'Recovery' : 'Mindful';
}

export function calcRewardEmoji(currentPhase: string): string {
  return computeIsLongBreak(currentPhase) ? '☕' : '🌿';
}

export function calcRewardLabel(currentPhase: string): string {
  return computeIsLongBreak(currentPhase) ? 'Long break ready' : 'Short break';
}
