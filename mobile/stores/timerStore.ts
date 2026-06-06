import { create } from 'zustand';
import { api } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTaskStore } from './taskStore';
import { useAuthStore } from './authStore';
import { useGamificationStore } from './gamificationStore';
import { recordCompletedSession, generateSessionId } from '../store/sync';
import type { SessionReward } from '../types';

type TimerStatus = 'idle' | 'running' | 'paused' | 'break';
type TimerPhase = 'focus' | 'shortBreak' | 'longBreak';

interface Settings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsUntilLong: number;
}

// Device-level keys — shared across all accounts
const TIMER_SETTINGS_KEY = 'timer:settings';
const TIMER_ROUNDS_KEY = 'timer:pomodoroRounds';

// User-level key builders — scoped per account
const timerStatsKeys = (userId: string) => ({
  globalSessions:  `timer:${userId}:globalSessions`,
  globalTotalTime: `timer:${userId}:globalTotalTime`,
  lastSessionDate: `timer:${userId}:lastSessionDate`,
});

// Old device-level keys — used only for one-time migration
const LEGACY_KEYS = {
  globalSessions:  'timer:globalSessions',
  globalTotalTime: 'timer:globalTotalTime',
  lastSessionDate: 'timer:lastSessionDate',
};

interface TimerState {
  status: TimerStatus;
  currentPhase: TimerPhase;
  timeLeft: number;
  pomodoroRounds: number;
  settings: Settings;
  globalSessions: number;
  globalTotalTime: number;
  lastSessionDate: string | null;
  lastCompletedSessionId: string | null;
  weekActiveDates: string[];
  isLoadingWeek: boolean;
  // Wall-clock timing: immune to multiple-interval stacking
  startedAt: number | null;    // Date.now() when current running segment began
  elapsedAtPause: number;      // cumulative elapsed seconds from previous start→pause cycles

  start: () => void;
  pause: () => void;
  resume: () => void;
  tick: () => void;
  complete: () => void;
  skip: () => void;
  reset: () => void;
  clearUserData: (userId: string) => Promise<void>;
  setWorkDuration: (minutes: number) => void;
  setShortBreakDuration: (minutes: number) => void;
  setLongBreakDuration: (minutes: number) => void;
  hydrate: (userId: string) => Promise<void>;
  fetchWeekSessions: () => Promise<void>;
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
  lastCompletedSessionId: null,
  weekActiveDates: [],
  isLoadingWeek: false,
  startedAt: null,
  elapsedAtPause: 0,

  start: () => {
    const { status, currentPhase, settings } = get();
    if (status !== 'idle' && status !== 'break') return;

    const now = Date.now();
    if (currentPhase === 'focus') {
      set({ status: 'running', timeLeft: settings.workDuration, startedAt: now, elapsedAtPause: 0 });
      api.post('/timer/start', { durationSeconds: settings.workDuration, startedAt: now })
        .catch((err) => console.warn('[timer] start sync failed:', err));
    } else {
      // Break phase: timeLeft already set by complete(), start the clock fresh
      set({ status: 'running', startedAt: now, elapsedAtPause: 0 });
    }
  },

  pause: () => {
    const { status, startedAt, elapsedAtPause, currentPhase, settings } = get();
    if (status !== 'running' || !startedAt) return;

    const elapsed = elapsedAtPause + Math.floor((Date.now() - startedAt) / 1000);
    const phaseDuration = getPhaseDuration(currentPhase, settings);
    const timeLeft = Math.max(0, phaseDuration - elapsed);

    set({ status: 'paused', elapsedAtPause: elapsed, startedAt: null, timeLeft });
    api.post('/timer/pause', { elapsedSeconds: elapsed })
      .catch((err) => console.warn('[timer] pause sync failed:', err));
  },

  resume: () => {
    if (get().status !== 'paused') return;
    const now = Date.now();
    set({ status: 'running', startedAt: now });
    api.post('/timer/resume', { resumedAt: now })
      .catch((err) => console.warn('[timer] resume sync failed:', err));
  },

  tick: () => {
    const { status, startedAt, elapsedAtPause, currentPhase, settings } = get();
    if (status !== 'running' || !startedAt) return;

    const phaseDuration = getPhaseDuration(currentPhase, settings);
    const elapsed = elapsedAtPause + Math.floor((Date.now() - startedAt) / 1000);
    const timeLeft = Math.max(0, phaseDuration - elapsed);

    set({ timeLeft });

    if (timeLeft <= 0) {
      get().complete();
    }
  },

  complete: () => {
    const { pomodoroRounds, settings, status, currentPhase, startedAt, elapsedAtPause } = get();

    if (currentPhase === 'focus') {
      // Focus session completed — update stats, save, transition to break
      const elapsed = startedAt
        ? elapsedAtPause + Math.floor((Date.now() - startedAt) / 1000)
        : elapsedAtPause;
      const sessionDuration = Math.min(settings.workDuration, Math.max(0, elapsed));
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
        startedAt: null,
        elapsedAtPause: 0,
      });

      // Device-level key (unchanged)
      AsyncStorage.setItem(TIMER_ROUNDS_KEY, String(newRounds))
        .catch((err) => console.warn('[timer] persist pomodoroRounds failed:', err));

      // User-scoped stat keys
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const keys = timerStatsKeys(userId);
        AsyncStorage.multiSet([
          [keys.globalSessions,  String(newGlobalSessions)],
          [keys.globalTotalTime, String(newGlobalTotalTime)],
          [keys.lastSessionDate, today],
        ]).catch((err) => console.warn('[timer] persist user stats failed:', err));
      } else {
        console.warn('[timerStore] complete: no userId — stats will not persist');
      }

      if (status === 'running') {
        const selectedTaskId = useTaskStore.getState().selectedTaskId;
        const taskLabel = selectedTaskId
          ? useTaskStore.getState().tasks.find((t) => t.id === selectedTaskId)?.title ?? null
          : null;
        const sessionId = generateSessionId();
        set({ lastCompletedSessionId: sessionId });

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

        api.post<SessionReward>('/timer/complete', {
          completedAt: Date.now(),
          actualElapsedSeconds: sessionDuration,
          taskId: selectedTaskId ?? null,
          taskLabel,
          clientSessionId: sessionId,
          plannedDurationSeconds: settings.workDuration,
        })
        .then((res) => {
          if (res.success && res.data) {
            useGamificationStore.getState().applySessionReward(res.data, sessionDuration);
          }
          // Refresh week dots so today's dot fills in immediately
          get().fetchWeekSessions();
        })
        .catch((err) => console.warn('[timer] complete sync failed:', err));
      }
    } else {
      // Break completed — return to focus idle, no stats update
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
        startedAt: null,
        elapsedAtPause: 0,
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
        startedAt: null,
        elapsedAtPause: 0,
      });
      AsyncStorage.setItem(TIMER_ROUNDS_KEY, String(newRounds))
        .catch((err) => console.warn('[timer] persist pomodoroRounds failed:', err));
    } else {
      // Skip break: return to focus idle
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
        startedAt: null,
        elapsedAtPause: 0,
      });
    }
  },

  reset: () => {
    set({
      status: 'idle',
      currentPhase: 'focus',
      timeLeft: get().settings.workDuration,
      startedAt: null,
      elapsedAtPause: 0,
    });
  },

  clearUserData: async (userId: string) => {
    if (!userId) {
      console.warn('[timerStore] clearUserData called without userId');
      return;
    }

    const keys = timerStatsKeys(userId);

    try {
      await AsyncStorage.multiRemove([
        keys.globalSessions,
        keys.globalTotalTime,
        keys.lastSessionDate,
        // timer:settings and timer:pomodoroRounds are device-level — intentionally NOT removed
      ]);
      console.log('[timerStore] cleared user stats for:', userId);
    } catch (err) {
      console.warn('[timerStore] clearUserData failed:', err);
    }

    set({
      globalSessions: 0,
      globalTotalTime: 0,
      lastSessionDate: null,
      startedAt: null,
      elapsedAtPause: 0,
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

  fetchWeekSessions: () => fetchWeekSessionsImpl(),

  hydrate: async (userId: string) => {
    if (!userId) {
      console.warn('[timerStore] hydrate called without userId — skipping stat hydration');
      // Still load device-level settings so the timer UI is correct
      try {
        const settingsRaw = await AsyncStorage.getItem(TIMER_SETTINGS_KEY);
        const roundsRaw   = await AsyncStorage.getItem(TIMER_ROUNDS_KEY);
        const settings = settingsRaw
          ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) }
          : { ...DEFAULT_SETTINGS };
        set({
          settings,
          timeLeft: settings.workDuration,
          pomodoroRounds: parseInt(roundsRaw ?? '0', 10),
          startedAt: null,
          elapsedAtPause: 0,
        });
      } catch (err) {
        console.warn('[timerStore] hydrate settings failed:', err);
      }
      return;
    }

    const keys = timerStatsKeys(userId);
    const today = getTodayString();

    try {
      // ONE-TIME MIGRATION — move legacy device-level stats to user-scoped keys.
      // Runs once per user per device: present only while legacySessionsRaw !== null.
      const legacySessionsRaw = await AsyncStorage.getItem(LEGACY_KEYS.globalSessions);
      if (legacySessionsRaw !== null) {
        console.log('[timerStore] migrating legacy timer stats for userId:', userId);
        const legacyDate = await AsyncStorage.getItem(LEGACY_KEYS.lastSessionDate);
        const legacyTime = await AsyncStorage.getItem(LEGACY_KEYS.globalTotalTime);

        // Only migrate if the legacy date is today — stale data from a previous user must not carry over
        if (legacyDate === today) {
          await AsyncStorage.multiSet([
            [keys.globalSessions,  legacySessionsRaw],
            [keys.globalTotalTime, legacyTime ?? '0'],
            [keys.lastSessionDate, legacyDate ?? today],
          ]);
        }

        await AsyncStorage.multiRemove([
          LEGACY_KEYS.globalSessions,
          LEGACY_KEYS.globalTotalTime,
          LEGACY_KEYS.lastSessionDate,
        ]);

        console.log('[timerStore] legacy migration complete — keys removed');
      }

      // Load device-level keys (settings and rounds — shared across accounts)
      const settingsRaw  = await AsyncStorage.getItem(TIMER_SETTINGS_KEY);
      const roundsRaw    = await AsyncStorage.getItem(TIMER_ROUNDS_KEY);

      // Load user-scoped stat keys
      const sessionsRaw  = await AsyncStorage.getItem(keys.globalSessions);
      const totalTimeRaw = await AsyncStorage.getItem(keys.globalTotalTime);
      const lastDateRaw  = await AsyncStorage.getItem(keys.lastSessionDate);

      const lastSessionDate = lastDateRaw ?? null;
      const isNewDay = lastSessionDate !== null && lastSessionDate !== today;

      // New-day reset: zero stats and persist immediately so a crash before the next
      // write doesn't leave the previous day's totals visible on next launch.
      const globalSessions  = isNewDay ? 0 : parseInt(sessionsRaw  ?? '0', 10);
      const globalTotalTime = isNewDay ? 0 : parseInt(totalTimeRaw ?? '0', 10);

      if (isNewDay) {
        await AsyncStorage.multiSet([
          [keys.globalSessions,  '0'],
          [keys.globalTotalTime, '0'],
          [keys.lastSessionDate, today],
        ]);
      }

      const settings = settingsRaw
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) }
        : { ...DEFAULT_SETTINGS };
      const pomodoroRounds = parseInt(roundsRaw ?? '0', 10);

      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: settings.workDuration,
        globalSessions,
        globalTotalTime,
        lastSessionDate: isNewDay ? today : (lastSessionDate ?? today),
        settings,
        pomodoroRounds,
        startedAt: null,
        elapsedAtPause: 0,
      });

      console.log('[timerStore] hydrated for userId:', userId);
      console.log('[timerStore] globalSessions:', globalSessions, 'globalTotalTime:', globalTotalTime);

    } catch (err) {
      console.warn('[timerStore] hydrate failed:', err);
    }
  },
}));

// Separate function so it can call useTimerStore.getState() after the store is created
async function fetchWeekSessionsImpl() {
  useTimerStore.setState({ isLoadingWeek: true });
  try {
    const res = await api.get<{ sessions: unknown[]; activeDates: string[] }>('/timer/sessions/week');
    if (res.success && res.data) {
      useTimerStore.setState({ weekActiveDates: res.data.activeDates ?? [], isLoadingWeek: false });
    } else {
      useTimerStore.setState({ isLoadingWeek: false });
    }
  } catch (err) {
    console.warn('[timerStore] fetchWeekSessions failed:', err);
    useTimerStore.setState({ isLoadingWeek: false });
  }
}

function saveSettings() {
  const { settings } = useTimerStore.getState();
  AsyncStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(settings))
    .catch((err) => console.warn('[timer] persist settings failed:', err));
}

// Called from _layout.tsx bootstrap after all modules are loaded.
// Keeping this out of module scope breaks the circular import crash:
//   timerStore → taskStore → authStore → timerStore
export function initTimerStore(): void {
  useTaskStore.subscribe((state, prevState) => {
    if (state.selectedTaskId !== prevState.selectedTaskId) {
      const { status, settings } = useTimerStore.getState();
      // Only reset the timer display when idle — never interrupt a running/paused session.
      // pomodoroRounds is intentionally preserved so the long-break cycle isn't lost.
      if (status === 'idle') {
        useTimerStore.setState({
          currentPhase: 'focus',
          timeLeft: settings.workDuration,
        });
      }
    }
  });
}
