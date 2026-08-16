import { useTimerStore } from '../../stores/timerStore';
import { useShallow } from 'zustand/react/shallow';
import {
  calcIsIdle,
  calcPhaseLabel,
  calcSessionInCycle,
  computeIsLongBreak,
} from '../selectors/timer';

const TIMER_SELECTOR = (s: any) => ({
  status: s.status,
  currentPhase: s.currentPhase,
  timeLeft: s.timeLeft,
  pomodoroRounds: s.pomodoroRounds,
  settings: s.settings,
});

const ACTIONS_SELECTOR = (s: any) => ({
  start: s.start,
  pause: s.pause,
  resume: s.resume,
  skip: s.skip,
  setWorkDuration: s.setWorkDuration,
  setShortBreakDuration: s.setShortBreakDuration,
  setLongBreakDuration: s.setLongBreakDuration,
});

export function useTimerState() {
  return useTimerStore(useShallow(TIMER_SELECTOR));
}

export function useTimerActions() {
  return useTimerStore(useShallow(ACTIONS_SELECTOR));
}

export function useIsIdle() {
  const status = useTimerStore((s) => s.status);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcIsIdle(status, currentPhase);
}

export function useIsPaused() {
  return useTimerStore((s) => s.status === 'paused');
}

export function useIsRunning() {
  return useTimerStore((s) => s.status === 'running');
}

export function useStatus() {
  return useTimerStore((s) => s.status);
}

export function useCurrentPhase() {
  return useTimerStore((s) => s.currentPhase);
}

export function useTimeLeft() {
  return useTimerStore((s) => s.timeLeft);
}

export function usePomodoroRounds() {
  return useTimerStore((s) => s.pomodoroRounds);
}

export function useSettings() {
  return useTimerStore(useShallow((s) => s.settings));
}

export function useIsLongBreak() {
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return computeIsLongBreak(currentPhase);
}

export function useSessionInCycle() {
  const pomodoroRounds = useTimerStore((s) => s.pomodoroRounds);
  const sessionsUntilLong = useTimerStore((s) => s.settings.sessionsUntilLong);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcSessionInCycle(pomodoroRounds, sessionsUntilLong, currentPhase);
}

export function usePhaseLabel() {
  const status = useTimerStore((s) => s.status);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  return calcPhaseLabel(status, currentPhase);
}

export function useDurationOptions() {
  return useTimerStore(
    useShallow((s) => ({
      workDuration: s.settings.workDuration,
      shortBreakDuration: s.settings.shortBreakDuration,
      longBreakDuration: s.settings.longBreakDuration,
      sessionsUntilLong: s.settings.sessionsUntilLong,
      setWorkDuration: s.setWorkDuration,
      setShortBreakDuration: s.setShortBreakDuration,
      setLongBreakDuration: s.setLongBreakDuration,
    })),
  );
}

export function useGlobalSessions() {
  return useTimerStore((s) => s.globalSessions);
}

export function useGlobalTotalTime() {
  return useTimerStore((s) => s.globalTotalTime);
}
