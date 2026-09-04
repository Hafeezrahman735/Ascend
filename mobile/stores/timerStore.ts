import { create } from 'zustand';
import { api } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTaskStore } from './taskStore';
import { useAuthStore } from './authStore';
import { useGamificationStore } from './gamificationStore';
import { recordCompletedSession, generateSessionId } from '../store/sync';
import { getLocalDateString, getDeviceTimeZone } from '../utils/date';
import type { SessionReward } from '../types';
import { elapsedInPhase, remainingInPhase, type TimerPhase } from '../lib/phaseDuration';
import { nextPlannedFocusSeconds } from '../lib/sessionPlan';
import { creditableSessionSeconds, MAX_SESSION_SECONDS } from '../lib/sessionCredit';
import { log } from '../lib/log';
import { migrateDailyGoal, clampGoalMinutes } from '../lib/dailyTarget';

type TimerStatus = 'idle' | 'running' | 'paused' | 'break';
export type { TimerPhase };

interface Settings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsUntilLong: number;
  /** Minutes of focus the user is aiming for each day. Set directly, never derived. */
  dailyFocusMinutes: number;
}

// Device-level key — shared across all accounts (settings only)
const TIMER_SETTINGS_KEY = 'timer:settings';

// The chosen mode, device-level for the same reason the durations are: it is a
// preference about this device's timer, not part of any account's data. Kept in
// its own key rather than folded into TIMER_SETTINGS_KEY so `Settings` stays the
// four durations and a target, and nothing that spreads it inherits a mode.
const TIMER_MODE_KEY = 'timer:mode';

// Active running/paused session snapshot. Because JS is frozen when the app is
// backgrounded/killed, the timer can't literally keep ticking — instead we save the
// wall-clock anchors (startedAt + elapsedAtPause) so a relaunch reconstructs the exact
// remaining time from Date.now() rather than resetting to the beginning. Stamped with
// userId so another account never inherits a leftover session.
const ACTIVE_SESSION_KEY = 'timer:activeSession';

// User-level key builders — scoped per account
const timerStatsKeys = (userId: string) => ({
  pomodoroRounds:  `timer:${userId}:pomodoroRounds`,
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

type TimerMode = 'pomodoro' | 'stopwatch';

// Serialized shape of an in-progress session written to ACTIVE_SESSION_KEY.
interface PersistedSession {
  userId: string | null;
  status: TimerStatus;
  currentPhase: TimerPhase;
  mode: TimerMode;
  startedAt: number | null;
  elapsedAtPause: number;
  stopwatchElapsed: number;
  timeLeft: number;
  // The running focus block’s length. Persisted because it is part of the
  // running session’s identity, exactly like timeLeft: without it a force-quit
  // would reconstruct a 20-minute block against the 25-minute default and the
  // timer would silently gain five minutes mid-session.
  plannedFocusSeconds: number | null;
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
  lastCompletedSessionId: string | null;
  weekActiveDates: string[];
  isLoadingWeek: boolean;
  // Wall-clock timing: immune to multiple-interval stacking
  startedAt: number | null;    // Date.now() when current running segment began
  elapsedAtPause: number;      // cumulative elapsed seconds from previous start→pause cycles
  // Stopwatch mode — counts up; on pause its elapsed is committed as focus time
  // through the exact same path complete() uses (globalTotalTime + POST /timer/complete).
  mode: TimerMode;
  stopwatchElapsed: number;
  // Per-task plan overlay, frozen when a focus block starts. null = no plan,
  // use the user’s configured workDuration. Never written into settings:
  // workDuration is a deliberate user preference and a derived value must not
  // overwrite it.
  plannedFocusSeconds: number | null;

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
  setDailyFocusMinutes: (minutes: number) => void;
  setMode: (mode: TimerMode) => void;
  startStopwatch: () => void;
  /** Commits the run and returns the seconds actually credited to focus time. */
  pauseStopwatch: () => number;
  hydrate: (userId: string) => Promise<void>;
  fetchWeekSessions: () => Promise<void>;
}

const DEFAULT_SETTINGS: Settings = {
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  sessionsUntilLong: 4,
  dailyFocusMinutes: 200,
};

// Single definition of the local-date convention lives in utils/date.ts.
const getTodayString = () => getLocalDateString();


/**
 * The focus length the currently selected task calls for, in seconds, or null
 * when it has no usable plan.
 *
 * Planned from what is LEFT, not the original estimate, so a task that is
 * mostly done stops offering a full fresh plan every time it is selected.
 *
 * Reads taskStore through getState() at call time rather than at module scope.
 * timerStore and taskStore already import each other; deferring the read is what
 * keeps that cycle harmless, and a top-level read would turn it into a crash on
 * app load.
 */
function plannedFocusForSelectedTask(settings: Settings): number | null {
  const { tasks, selectedTaskId } = useTaskStore.getState();
  if (!selectedTaskId) return null;
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task?.estimatedMinutes) return null;

  const loggedMinutes = Math.round((task.totalTimeOnTask ?? 0) / 60);
  const remainingMinutes = task.estimatedMinutes - loggedMinutes;
  return nextPlannedFocusSeconds(remainingMinutes, Math.round(settings.workDuration / 60));
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
  mode: 'pomodoro',
  stopwatchElapsed: 0,
  plannedFocusSeconds: null,

  start: () => {
    const { status, currentPhase, settings } = get();
    if (status !== 'idle' && status !== 'break') return;

    const now = Date.now();
    if (currentPhase === 'focus') {
      // Frozen here and nowhere else. Deriving this on every read would let a
      // background task refresh, an edited estimate, or a deselected task change
      // the length of a session already in flight.
      const planned = plannedFocusForSelectedTask(settings);
      const focusSeconds = planned ?? settings.workDuration;
      set({ status: 'running', timeLeft: focusSeconds, startedAt: now, elapsedAtPause: 0, plannedFocusSeconds: planned });
      api.post('/timer/start', { durationSeconds: focusSeconds, startedAt: now })
        .catch((err) => console.warn('[timer] start sync failed:', err));
    } else {
      // Break phase: timeLeft already set by complete(), start the clock fresh
      set({ status: 'running', startedAt: now, elapsedAtPause: 0 });
    }
    persistActiveSession();
  },

  pause: () => {
    const { status, startedAt, elapsedAtPause, currentPhase, settings, plannedFocusSeconds } = get();
    if (status !== 'running' || !startedAt) return;

    const now = Date.now();
    const elapsed = elapsedInPhase(elapsedAtPause, startedAt, now);
    const timeLeft = remainingInPhase(
      { phase: currentPhase, settings, plannedFocusSeconds, elapsedAtPause, startedAt },
      now,
    );

    set({ status: 'paused', elapsedAtPause: elapsed, startedAt: null, timeLeft });
    persistActiveSession();
    // Send both: remainingSeconds is what the server column means, elapsedSeconds
    // keeps older server builds working during a rollout.
    api.post('/timer/pause', { remainingSeconds: timeLeft, elapsedSeconds: elapsed })
      .catch((err) => console.warn('[timer] pause sync failed:', err));
  },

  resume: () => {
    if (get().status !== 'paused') return;
    const now = Date.now();
    set({ status: 'running', startedAt: now });
    persistActiveSession();
    api.post('/timer/resume', { resumedAt: now })
      .catch((err) => console.warn('[timer] resume sync failed:', err));
  },

  tick: () => {
    const { status, startedAt, elapsedAtPause, currentPhase, settings, mode, plannedFocusSeconds } = get();
    if (status !== 'running' || !startedAt) return;

    // Stopwatch counts up; never auto-completes.
    if (mode === 'stopwatch') {
      set({ stopwatchElapsed: elapsedInPhase(elapsedAtPause, startedAt, Date.now()) });
      return;
    }

    const timeLeft = remainingInPhase(
      { phase: currentPhase, settings, plannedFocusSeconds, elapsedAtPause, startedAt },
      Date.now(),
    );

    set({ timeLeft });

    if (timeLeft <= 0) {
      get().complete();
    }
  },

  complete: () => {
    const { pomodoroRounds, settings, status, currentPhase, startedAt, elapsedAtPause } = get();

    if (currentPhase === 'focus') {
      // Focus session completed — update stats, save, transition to break
      const elapsed = elapsedInPhase(elapsedAtPause, startedAt, Date.now());
      // Clamp against the block that actually ran, not the global default. This
      // runs BEFORE anything is recorded, so a wrong bound here destroys the
      // time permanently — no later backend change can recover it. With a plan,
      // a grace-zone block can legitimately exceed workDuration by up to 10
      // minutes, and clamping to the default would under-credit every one of
      // them, leaving the task short of its estimate and re-planning forever.
      //
      // The plan itself is bounded too: workDuration has no upper limit of its
      // own, and `plannedDurationSeconds` goes on the wire under the same
      // `.max()` the elapsed figure does.
      const plannedDuration = Math.min(
        get().plannedFocusSeconds ?? settings.workDuration,
        MAX_SESSION_SECONDS,
      );
      const sessionDuration = creditableSessionSeconds(elapsed, plannedDuration);
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
      persistActiveSession();

      // User-scoped stat keys (including pomodoroRounds)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const keys = timerStatsKeys(userId);
        AsyncStorage.multiSet([
          [keys.pomodoroRounds,  String(newRounds)],
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
          localDate: getTodayString(),
          tz: getDeviceTimeZone(),
          actualElapsedSeconds: sessionDuration,
          taskId: selectedTaskId ?? null,
          taskLabel,
          clientSessionId: sessionId,
          plannedDurationSeconds: plannedDuration,
        })
        .then((res) => {
          if (res.success && res.data) {
            useGamificationStore.getState().applySessionReward(res.data, sessionDuration);
          } else {
            // Local stats have already moved; the server's have not. Silence here
            // is what made the old stopwatch overflow invisible.
            console.warn('[timer] session rejected by server:', res.error);
          }
          // Refresh week dots so today's dot fills in immediately
          get().fetchWeekSessions();
        })
        .catch((err) => console.warn('[timer] complete sync failed:', err));
      }
    } else {
      // Break completed — return to focus idle, no stats update.
      // Re-derived rather than read from a stored queue: the task’s logged time
      // has just grown by the block that finished, so the remainder produces the
      // tail of the plan on its own. That is why no plan array or active index
      // is stored anywhere.
      const nextPlanned = plannedFocusForSelectedTask(settings);
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: nextPlanned ?? settings.workDuration,
        startedAt: null,
        elapsedAtPause: 0,
        plannedFocusSeconds: nextPlanned,
      });
      persistActiveSession();
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
      const skipUserId = useAuthStore.getState().user?.id;
      if (skipUserId) {
        const keys = timerStatsKeys(skipUserId);
        AsyncStorage.setItem(keys.pomodoroRounds, String(newRounds))
          .catch((err) => console.warn('[timer] persist pomodoroRounds failed:', err));
      }
    } else {
      // Skip break: return to focus idle
      const nextPlanned = plannedFocusForSelectedTask(settings);
      set({
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: nextPlanned ?? settings.workDuration,
        startedAt: null,
        elapsedAtPause: 0,
        plannedFocusSeconds: nextPlanned,
      });
    }
    persistActiveSession();
  },

  reset: () => {
    set({
      status: 'idle',
      currentPhase: 'focus',
      timeLeft: get().settings.workDuration,
      startedAt: null,
      elapsedAtPause: 0,
      plannedFocusSeconds: null,
    });
    persistActiveSession();
  },

  clearUserData: async (userId: string) => {
    if (!userId) {
      console.warn('[timerStore] clearUserData called without userId');
      return;
    }

    const keys = timerStatsKeys(userId);

    try {
      await AsyncStorage.multiRemove([
        keys.pomodoroRounds,
        keys.globalSessions,
        keys.globalTotalTime,
        keys.lastSessionDate,
        ACTIVE_SESSION_KEY, // drop any in-progress session so the next account starts clean
      ]);
      log('[timerStore] cleared user stats for:', userId);
    } catch (err) {
      console.warn('[timerStore] clearUserData failed:', err);
    }

    // Logging out ends the session, so the status has to go with it. Clearing
    // only the anchors left status on 'running' with a null startedAt — a state
    // nothing else in the store can produce, where tick() returns early and the
    // UI shows a running timer that cannot advance. It also stranded the Live
    // Activity, which reads status to decide whether a card should exist.
    set({
      pomodoroRounds: 0,
      globalSessions: 0,
      globalTotalTime: 0,
      lastSessionDate: null,
      status: 'idle',
      currentPhase: 'focus',
      timeLeft: get().settings.workDuration,
      startedAt: null,
      elapsedAtPause: 0,
      stopwatchElapsed: 0,
      plannedFocusSeconds: null,
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

  setDailyFocusMinutes: (minutes: number) => {
    const dailyFocusMinutes = clampGoalMinutes(minutes);
    set((state) => ({
      settings: { ...state.settings, dailyFocusMinutes },
    }));
    saveSettings();
  },

  setMode: (mode: TimerMode) => {
    // Switching modes always lands on a clean idle state for the target mode.
    if (mode === 'stopwatch') {
      set({ mode, status: 'idle', stopwatchElapsed: 0, startedAt: null, elapsedAtPause: 0, plannedFocusSeconds: null });
    } else {
      set({
        mode,
        status: 'idle',
        currentPhase: 'focus',
        timeLeft: get().settings.workDuration,
        stopwatchElapsed: 0,
        startedAt: null,
        elapsedAtPause: 0,
        plannedFocusSeconds: null,
      });
    }
    persistActiveSession();
    AsyncStorage.setItem(TIMER_MODE_KEY, mode)
      .catch((err) => console.warn('[timer] persist mode failed:', err));
  },

  startStopwatch: () => {
    if (get().status === 'running') return;
    set({ status: 'running', startedAt: Date.now(), elapsedAtPause: 0, stopwatchElapsed: 0 });
    persistActiveSession();
  },

  pauseStopwatch: () => {
    const { status, startedAt, elapsedAtPause } = get();
    if (status !== 'running' || !startedAt) return 0;
    const elapsed = elapsedInPhase(elapsedAtPause, startedAt, Date.now());
    // Commit the worked time to today + all-time focus stats via the shared path.
    // The credited figure comes back so the screen can report what was actually
    // saved: `stopwatchElapsed` is a tick behind the wall clock, and is not
    // subject to the ceiling the recorded session is.
    const credited = recordFocusSession(elapsed);
    // Reset the stopwatch back to 00:00 / idle.
    set({ status: 'idle', startedAt: null, elapsedAtPause: 0, stopwatchElapsed: 0 });
    persistActiveSession();
    return credited;
  },

  fetchWeekSessions: () => fetchWeekSessionsImpl(),

  hydrate: async (userId: string) => {
    if (!userId) {
      console.warn('[timerStore] hydrate called without userId — skipping stat hydration');
      // Still load device-level settings so the timer UI is correct
      try {
        const settingsRaw = await AsyncStorage.getItem(TIMER_SETTINGS_KEY);
        const settings = await readSettings(settingsRaw);
        const mode = await readSavedMode();
        set({
          settings,
          mode,
          timeLeft: settings.workDuration,
          stopwatchElapsed: 0,
          pomodoroRounds: 0,
          startedAt: null,
          elapsedAtPause: 0,
          plannedFocusSeconds: null,
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
        log('[timerStore] migrating legacy timer stats for userId:', userId);
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

        log('[timerStore] legacy migration complete — keys removed');
      }

      // Load device-level key (settings only)
      const settingsRaw  = await AsyncStorage.getItem(TIMER_SETTINGS_KEY);

      // Load user-scoped stat keys
      const roundsRaw    = await AsyncStorage.getItem(keys.pomodoroRounds);
      const sessionsRaw  = await AsyncStorage.getItem(keys.globalSessions);
      const totalTimeRaw = await AsyncStorage.getItem(keys.globalTotalTime);
      const lastDateRaw  = await AsyncStorage.getItem(keys.lastSessionDate);

      const lastSessionDate = lastDateRaw ?? null;
      const isNewDay = lastSessionDate !== null && lastSessionDate !== today;

      // New-day reset: zero all daily stats and persist immediately so a crash before the
      // next write doesn't leave the previous day's totals visible on next launch.
      const pomodoroRounds  = isNewDay ? 0 : parseInt(roundsRaw   ?? '0', 10);
      const globalSessions  = isNewDay ? 0 : parseInt(sessionsRaw  ?? '0', 10);
      const globalTotalTime = isNewDay ? 0 : parseInt(totalTimeRaw ?? '0', 10);

      if (isNewDay) {
        await AsyncStorage.multiSet([
          [keys.pomodoroRounds,  '0'],
          [keys.globalSessions,  '0'],
          [keys.globalTotalTime, '0'],
          [keys.lastSessionDate, today],
        ]);
      }

      const settings = await readSettings(settingsRaw);

      // Restore an in-progress session so a closed/killed app resumes from the correct
      // remaining time instead of starting over. Skipped on a new day (a session left
      // running across midnight is stale) and for a snapshot from a different account.
      let restored: Partial<TimerState> | null = null;
      if (!isNewDay) {
        try {
          const sessionRaw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
          if (sessionRaw) {
            const snap = JSON.parse(sessionRaw) as PersistedSession;
            if (snap.userId === userId && snap.status !== 'idle') {
              restored = reconstructSession(snap, settings);
            } else {
              await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
            }
          }
        } catch (err) {
          console.warn('[timerStore] restore active session failed:', err);
          await AsyncStorage.removeItem(ACTIVE_SESSION_KEY).catch(() => {});
        }
      } else {
        await AsyncStorage.removeItem(ACTIVE_SESSION_KEY).catch(() => {});
      }

      const mode = await readSavedMode();

      set({
        status: 'idle',
        currentPhase: 'focus',
        mode,
        timeLeft: settings.workDuration,
        // Reset alongside timeLeft, not left behind it. Without this, a stopwatch
        // running across midnight came back to a foregrounded app that skipped
        // the restore as stale, dropped to idle — and still displayed the elapsed
        // time from a session that no longer existed.
        stopwatchElapsed: 0,
        // Cleared before `restored` is spread below, so a snapshot that carries
        // an overlay still wins, but a stale one can never leak across a day.
        plannedFocusSeconds: null,
        globalSessions,
        globalTotalTime,
        lastSessionDate: isNewDay ? today : (lastSessionDate ?? today),
        settings,
        pomodoroRounds,
        startedAt: null,
        elapsedAtPause: 0,
        // Spread last so a restored running/paused session overrides the idle defaults.
        ...(restored ?? {}),
      });

      log('[timerStore] hydrated for userId:', userId);
      log('[timerStore] globalSessions:', globalSessions, 'globalTotalTime:', globalTotalTime);

    } catch (err) {
      console.warn('[timerStore] hydrate failed:', err);
    }
  },
}));

// Records `sessionDuration` seconds of focus time through the exact same source the
// pomodoro timer uses: updates today's globalTotalTime/globalSessions, appends to local
// session history, and POSTs /timer/complete (which increments all-time User.totalFocusTime).
// Used by the stopwatch on pause. Does NOT touch pomodoroRounds or the break phase.
function recordFocusSession(elapsedSeconds: number): number {
  // Clamped here rather than at the call site so every caller is bounded by
  // construction. The stopwatch has no plan to clamp against, so the ceiling is
  // the only thing standing between an overnight run and a rejected session.
  const sessionDuration = creditableSessionSeconds(elapsedSeconds, null);
  if (sessionDuration <= 0) return 0;

  const today = getTodayString();
  const { lastSessionDate, globalSessions, globalTotalTime } = useTimerStore.getState();
  const isNewDay = lastSessionDate !== null && lastSessionDate !== today;
  const newGlobalSessions = isNewDay ? 1 : globalSessions + 1;
  const newGlobalTotalTime = isNewDay ? sessionDuration : globalTotalTime + sessionDuration;

  useTimerStore.setState({
    globalSessions: newGlobalSessions,
    globalTotalTime: newGlobalTotalTime,
    lastSessionDate: today,
  });

  const userId = useAuthStore.getState().user?.id;
  if (userId) {
    const keys = timerStatsKeys(userId);
    AsyncStorage.multiSet([
      [keys.globalSessions,  String(newGlobalSessions)],
      [keys.globalTotalTime, String(newGlobalTotalTime)],
      [keys.lastSessionDate, today],
    ]).catch((err) => console.warn('[timer] persist stopwatch stats failed:', err));
  }

  const selectedTaskId = useTaskStore.getState().selectedTaskId;
  const taskLabel = selectedTaskId
    ? useTaskStore.getState().tasks.find((t) => t.id === selectedTaskId)?.title ?? null
    : null;
  const sessionId = generateSessionId();
  useTimerStore.setState({ lastCompletedSessionId: sessionId });

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
    localDate: today,
    tz: getDeviceTimeZone(),
    actualElapsedSeconds: sessionDuration,
    taskId: selectedTaskId ?? null,
    taskLabel,
    clientSessionId: sessionId,
    plannedDurationSeconds: null,
  })
  .then((res) => {
    if (res.success && res.data) {
      useGamificationStore.getState().applySessionReward(res.data, sessionDuration);
    } else {
      console.warn('[timer] stopwatch session rejected by server:', res.error);
    }
    useTimerStore.getState().fetchWeekSessions();
  })
  .catch((err) => console.warn('[timer] stopwatch complete sync failed:', err));

  return sessionDuration;
}

/**
 * The saved mode, defaulting to pomodoro.
 *
 * Read on hydrate for the same reason the durations are: every other choice the
 * user makes about the timer survives a relaunch, and a mode toggle that quietly
 * reverted to a countdown on every cold start was the one that did not.
 */
async function readSavedMode(): Promise<TimerMode> {
  try {
    return (await AsyncStorage.getItem(TIMER_MODE_KEY)) === 'stopwatch' ? 'stopwatch' : 'pomodoro';
  } catch {
    return 'pomodoro';
  }
}

// Separate function so it can call useTimerStore.getState() after the store is created
async function fetchWeekSessionsImpl() {
  useTimerStore.setState({ isLoadingWeek: true });
  try {
    // tzOffset: minutes the local timezone is ahead of UTC (positive = east, negative = west)
    const tzOffset = -new Date().getTimezoneOffset();
    const res = await api.get<{ sessions: unknown[]; activeDates: string[] }>(`/timer/sessions/week?tzOffset=${tzOffset}`);
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

/**
 * Turns the stored settings blob into a Settings object, migrating the retired
 * session-based daily goal on the way through.
 *
 * This exists as one function rather than three inline lines because the
 * migration has to happen at BOTH load sites — the no-userId early return and
 * the main path. Sharing the reader makes that structural instead of something
 * to remember.
 */
async function readSettings(settingsRaw: string | null): Promise<Settings> {
  if (!settingsRaw) return { ...DEFAULT_SETTINGS };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(settingsRaw) as Record<string, unknown>;
  } catch (err) {
    console.warn('[timer] settings blob unreadable, using defaults:', err);
    return { ...DEFAULT_SETTINGS };
  }

  const { settings: migrated, changed } = migrateDailyGoal(parsed, DEFAULT_SETTINGS.workDuration);
  if (changed) {
    // Persist immediately: that is what makes the conversion run exactly once,
    // and stops a later saveSettings() writing the retired key back.
    await AsyncStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(migrated)).catch((err) =>
      console.warn('[timer] persist migrated settings failed:', err),
    );
  }

  return { ...DEFAULT_SETTINGS, ...migrated } as Settings;
}

function saveSettings() {
  const { settings } = useTimerStore.getState();
  AsyncStorage.setItem(TIMER_SETTINGS_KEY, JSON.stringify(settings))
    .catch((err) => console.warn('[timer] persist settings failed:', err));
}

// Writes (or clears) the active-session snapshot. Called after every action that
// changes the running state — NOT on tick(), since timeLeft is always recomputed
// from startedAt, so the per-second tick needs nothing persisted. When idle there is
// no session to restore, so the key is removed for a clean next launch.
function persistActiveSession(): void {
  const s = useTimerStore.getState();
  if (s.status === 'idle') {
    AsyncStorage.removeItem(ACTIVE_SESSION_KEY).catch(() => {});
    return;
  }
  const snapshot: PersistedSession = {
    userId: useAuthStore.getState().user?.id ?? null,
    status: s.status,
    currentPhase: s.currentPhase,
    mode: s.mode,
    startedAt: s.startedAt,
    elapsedAtPause: s.elapsedAtPause,
    stopwatchElapsed: s.stopwatchElapsed,
    timeLeft: s.timeLeft,
    plannedFocusSeconds: s.plannedFocusSeconds,
  };
  AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(snapshot))
    .catch((err) => console.warn('[timer] persist active session failed:', err));
}

// Rebuilds the live timer fields from a saved snapshot. For a running segment the
// remaining time is recomputed from the wall clock, so it reflects real elapsed time
// while the app was closed (and hits 0 if the deadline already passed, letting the
// normal tick() path complete it). Paused/break states carry no clock, so restore verbatim.
function reconstructSession(snap: PersistedSession, settings: Settings): Partial<TimerState> {
  if (snap.status === 'running' && snap.startedAt != null) {
    const now = Date.now();
    const elapsed = elapsedInPhase(snap.elapsedAtPause, snap.startedAt, now);
    if (snap.mode === 'stopwatch') {
      return {
        status: 'running',
        mode: 'stopwatch',
        currentPhase: snap.currentPhase,
        startedAt: snap.startedAt,
        elapsedAtPause: snap.elapsedAtPause,
        stopwatchElapsed: elapsed,
      };
    }
    // Snapshots written before this field existed have it undefined, which falls
    // back to settings — exactly the old behaviour, so old snapshots keep working.
    const planned = snap.plannedFocusSeconds ?? null;
    return {
      status: 'running',
      mode: 'pomodoro',
      currentPhase: snap.currentPhase,
      startedAt: snap.startedAt,
      elapsedAtPause: snap.elapsedAtPause,
      timeLeft: remainingInPhase(
        {
          phase: snap.currentPhase,
          settings,
          plannedFocusSeconds: planned,
          elapsedAtPause: snap.elapsedAtPause,
          startedAt: snap.startedAt,
        },
        now,
      ),
      plannedFocusSeconds: planned,
    };
  }
  // paused, or 'break' waiting to be started (startedAt null) — no clock advances.
  return {
    status: snap.status,
    mode: snap.mode,
    currentPhase: snap.currentPhase,
    startedAt: snap.startedAt,
    elapsedAtPause: snap.elapsedAtPause,
    stopwatchElapsed: snap.stopwatchElapsed,
    timeLeft: snap.timeLeft,
    plannedFocusSeconds: snap.plannedFocusSeconds ?? null,
  };
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
        const planned = plannedFocusForSelectedTask(settings);
        useTimerStore.setState({
          currentPhase: 'focus',
          timeLeft: planned ?? settings.workDuration,
          plannedFocusSeconds: planned,
        });
      }
    }
  });
}
