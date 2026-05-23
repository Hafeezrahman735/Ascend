import { create } from 'zustand';
import { api } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTaskStore } from './taskStore';
import { recordCompletedSession, generateSessionId } from '../store/sync';

type TimerStatus = 'idle' | 'running' | 'paused' | 'break';
type TimerPhase = 'focus' | 'shortBreak' | 'longBreak';

interface Settings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsUntilLong: number;
}

interface TimerState {
  status: TimerStatus;
  currentPhase: TimerPhase;
  timeLeft: number;
  pomodoroRounds: number;
  settings: Settings;
  globalSessions: number;
  globalTotalTime: number;
  lastSessionDate: string | null;

  start: () => void;
  pause: () => void;
  resume: () => void;
  tick: () => void;
  complete: () => void;
  skip: () => void;
  reset: () => void;
  setWorkDuration: (minutes: number) => void;
  setShortBreakDuration: (minutes: number) => void;
  setLongBreakDuration: (minutes: number) => void;
  hydrate: () => Promise<void>;
}

const DEFAULT_SETTINGS: Settings = {
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  sessionsUntilLong: 4,
};

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function getPhaseDuration(phase: TimerPhase, settings: Settings): number {
  if (phase === 'longBreak') return settings.longBreakDuration;
  if (phase === 'shortBreak') return settings.shortBreakDuration;
  return settings.workDuration;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  status: 'idle',
  currentPhase: 'focus',
  timeLeft: DEFAULT_SETTINGS.workDuration,
  pomodoroRounds: 0,
  settings: { ...DEFAULT_SETTINGS },
  globalSessions: 0,
  globalTotalTime: 0,
  lastSessionDate: null,

  start: () => {
    const { status, currentPhase, settings } = get();
    if (status !== 'idle' && status !== 'break') return;

    if (currentPhase === 'focus') {
      set({ status: 'running', timeLeft: settings.workDuration });
      api.post('/timer/start', { durationSeconds: settings.workDuration, startedAt: Date.now() })
        .catch((err) => console.warn('[timer] start sync failed:', err));
    } else {
      // Break phase: timeLeft already set by complete(), just start running
      set({ status: 'running' });
    }
  },

  pause: () => {
    const { status, currentPhase, settings, timeLeft } = get();
    if (status !== 'running') return;
    set({ status: 'paused' });

    const phaseDuration = getPhaseDuration(currentPhase, settings);
    const elapsedSeconds = phaseDuration - timeLeft;
    api.post('/timer/pause', { elapsedSeconds })
      .catch((err) => console.warn('[timer] pause sync failed:', err));
  },

  resume: () => {
    if (get().status !== 'paused') return;
    set({ status: 'running' });
    api.post('/timer/resume', { resumedAt: Date.now() })
      .catch((err) => console.warn('[timer] resume sync failed:', err));
  },

  tick: () => {
    if (get().status !== 'running') return;
    const next = get().timeLeft - 1;
    if (next <= 0) {
      set({ timeLeft: 0 });
      get().complete();
    } else {
      set({ timeLeft: next });
    }
  },

  complete: () => {
    const { pomodoroRounds, settings, timeLeft, status, currentPhase } = get();

    if (currentPhase === 'focus') {
      // Focus session completed — update stats, save, transition to break
      const sessionDuration = settings.workDuration - timeLeft;
      const newRounds = pomodoroRounds + 1;
      const isLongBreak = newRounds % settings.sessionsUntilLong === 0;
      const nextPhase: TimerPhase = isLongBreak ? 'longBreak' : 'shortBreak';
      const breakDuration = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;

      const today = getTodayString();
      const { lastSessionDate, globalSessions, globalTotalTime } = get();
      const isNewDay = lastSessionDate !== null && lastSessionDate !== today;
      const newGlobalSessions = isNewDay ? 1 : globalSessions + 1;
      const newGlobalTotalTime = isNewDay ? sessionDuration : globalTotalTime + sessionDuration;

      set({
        status: 'break',
        currentPhase: nextPhase,
        timeLeft: breakDuration,
        pomodoroRounds: newRounds,
        globalSessions: newGlobalSessions,
        globalTotalTime: newGlobalTotalTime,
        lastSessionDate: today,
      });

      AsyncStorage.setItem('timer:pomodoroRounds', String(newRounds))
        .catch((err) => console.warn('[timer] persist pomodoroRounds failed:', err));
      AsyncStorage.setItem('timer:lastSessionDate', JSON.stringify(today))
        .catch((err) => console.warn('[timer] persist lastSessionDate failed:', err));
      AsyncStorage.setItem('timer:globalSessions', JSON.stringify(newGlobalSessions))
        .catch((err) => console.warn('[timer] persist globalSessions failed:', err));
      AsyncStorage.setItem('timer:globalTotalTime', JSON.stringify(newGlobalTotalTime))
        .catch((err) => console.warn('[timer] persist globalTotalTime failed:', err));

      if (status === 'running' || status === 'paused') {
        const selectedTaskId = useTaskStore.getState().selectedTaskId;
        const taskLabel = selectedTaskId
          ? useTaskStore.getState().tasks.find((t) => t.id === selectedTaskId)?.title ?? null
          : null;
        const sessionId = generateSessionId();

        if (selectedTaskId) {
          useTaskStore.getState().incrementTaskSession(selectedTaskId, sessionDuration);
        }

        recordCompletedSession({
          sessionId,
          completedAt: Date.now(),
          durationSeconds: sessionDuration,
          taskLabel,
          taskId: selectedTaskId ?? null,
          type: 'focus',
        });

        api.post('/timer/complete', {
          completedAt: Date.now(),
          actualElapsedSeconds: sessionDuration,
          taskId: selectedTaskId ?? null,
          taskLabel,
          clientSessionId: sessionId,
          plannedDurationSeconds: settings.workDuration,
        }).catch((err) => console.warn('[timer] complete sync failed:', err));
      }
    } else {
      // Break completed — return to focus idle, no stats update
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
      });
    }
  },

  skip: () => {
    const { status, currentPhase, settings, pomodoroRounds } = get();

    if (status === 'idle' && currentPhase === 'focus') return;

    if (currentPhase === 'focus') {
      // Skip focus: advance cycle position without recording session
      const newRounds = pomodoroRounds + 1;
      const isLongBreak = newRounds % settings.sessionsUntilLong === 0;
      const nextPhase: TimerPhase = isLongBreak ? 'longBreak' : 'shortBreak';
      const breakDuration = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
      set({
        status: 'break',
        currentPhase: nextPhase,
        timeLeft: breakDuration,
        pomodoroRounds: newRounds,
      });
      AsyncStorage.setItem('timer:pomodoroRounds', String(newRounds))
        .catch((err) => console.warn('[timer] persist pomodoroRounds failed:', err));
    } else {
      // Skip break: return to focus idle
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
      });
    }
  },

  reset: () => {
    set({
      status: 'idle',
      currentPhase: 'focus',
      timeLeft: get().settings.workDuration,
    });
  },

  setWorkDuration: (minutes: number) => {
    const seconds = Math.max(1, minutes) * 60;
    set((state) => ({
      settings: { ...state.settings, workDuration: seconds },
      timeLeft: state.status === 'idle' && state.currentPhase === 'focus' ? seconds : state.timeLeft,
    }));
    saveSettings();
  },

  setShortBreakDuration: (minutes: number) => {
    const seconds = Math.max(1, minutes) * 60;
    set((state) => ({
      settings: { ...state.settings, shortBreakDuration: seconds },
    }));
    saveSettings();
  },

  setLongBreakDuration: (minutes: number) => {
    const seconds = Math.max(1, minutes) * 60;
    set((state) => ({
      settings: { ...state.settings, longBreakDuration: seconds },
    }));
    saveSettings();
  },

  hydrate: async () => {
    try {
      const [settingsJson, pomodoroRoundsValue, lastDateValue, globalSessionsValue, globalTotalTimeValue] = await Promise.all([
        AsyncStorage.getItem('timer:settings'),
        AsyncStorage.getItem('timer:pomodoroRounds'),
        AsyncStorage.getItem('timer:lastSessionDate'),
        AsyncStorage.getItem('timer:globalSessions'),
        AsyncStorage.getItem('timer:globalTotalTime'),
      ]);

      const settings = { ...DEFAULT_SETTINGS };

      if (settingsJson) {
        const parsed = JSON.parse(settingsJson);
        if (parsed.workDuration) settings.workDuration = parsed.workDuration;
        if (parsed.shortBreakDuration) settings.shortBreakDuration = parsed.shortBreakDuration;
        if (parsed.longBreakDuration) settings.longBreakDuration = parsed.longBreakDuration;
        if (parsed.sessionsUntilLong) settings.sessionsUntilLong = parsed.sessionsUntilLong;
      }

      let pomodoroRounds = 0;
      if (pomodoroRoundsValue) {
        pomodoroRounds = JSON.parse(pomodoroRoundsValue);
      }

      const lastSessionDate = lastDateValue ? JSON.parse(lastDateValue) : null;
      const today = getTodayString();
      const isNewDay = lastSessionDate !== null && lastSessionDate !== today;

      const restoredGlobalSessions = globalSessionsValue ? JSON.parse(globalSessionsValue) : 0;
      const restoredGlobalTotalTime = globalTotalTimeValue ? JSON.parse(globalTotalTimeValue) : 0;

      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
        pomodoroRounds,
        settings,
        globalSessions: isNewDay ? 0 : restoredGlobalSessions,
        globalTotalTime: isNewDay ? 0 : restoredGlobalTotalTime,
        lastSessionDate,
      });
    } catch (e) {
      console.error('Failed to hydrate timer store', e);
    }
  },
}));

function saveSettings() {
  const { settings } = useTimerStore.getState();
  AsyncStorage.setItem('timer:settings', JSON.stringify(settings))
    .catch((err) => console.warn('[timer] persist settings failed:', err));
}

useTaskStore.subscribe((state, prevState) => {
  if (state.selectedTaskId !== prevState.selectedTaskId) {
    const { settings } = useTimerStore.getState();
    useTimerStore.setState({
      status: 'idle',
      currentPhase: 'focus',
      timeLeft: settings.workDuration,
      pomodoroRounds: 0,
    });
  }
});
