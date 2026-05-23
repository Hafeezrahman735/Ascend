export function computeIsLongBreak(currentPhase: string): boolean {
  return currentPhase === 'longBreak';
}

export function calcIsIdle(status: string, currentPhase: string): boolean {
  return status === 'idle' && currentPhase === 'focus';
}

export function calcIsPaused(status: string): boolean {
  return status === 'paused';
}

export function calcPhaseLabel(status: string, currentPhase: string): string {
  if (currentPhase === 'longBreak') return 'LONG BREAK';
  if (currentPhase === 'shortBreak') return 'BREAK';
  if (status === 'idle') return 'READY';
  return 'FOCUS';
}

export function calcSessionInCycle(pomodoroRounds: number, sessionsUntilLong: number, currentPhase: string): number {
  if (currentPhase === 'longBreak') return sessionsUntilLong;
  return pomodoroRounds % sessionsUntilLong;
}
