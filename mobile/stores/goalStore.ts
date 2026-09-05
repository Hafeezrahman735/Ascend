import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { TaskGoal } from '../types';
import { useAuthStore } from './authStore';

const GOALS_CACHE_KEY = (userId: string) => `goals:cache:${userId}`;

async function persistGoals(goals: TaskGoal[], userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(GOALS_CACHE_KEY(userId), JSON.stringify(goals));
  } catch (err) {
    console.warn('[goalStore] persist failed:', err);
  }
}

/**
 * Fills in fields a cache written by an older build cannot have.
 *
 * The cast below is a lie by necessity — this is unvalidated JSON from disk,
 * and every field added to `TaskGoal` after a release is absent from every
 * cache written before it. `hydrateGoals` seeds the UI from this before any
 * fetch lands, so an absent number reaches a formatter: `formatSeconds` on
 * `undefined` computes NaN and renders the literal string "NaNm" to every
 * existing user on first launch after the update.
 *
 * Defaulting here rather than declaring the fields optional keeps the fallback
 * in one place instead of spreading `?? 0` through every consumer.
 */
function normaliseCachedGoal(goal: TaskGoal): TaskGoal {
  return {
    ...goal,
    totalFocusSeconds: goal.totalFocusSeconds ?? 0,
    elapsedDays: goal.elapsedDays ?? 0,
  };
}

async function readCachedGoals(userId: string): Promise<TaskGoal[] | null> {
  try {
    const raw = await AsyncStorage.getItem(GOALS_CACHE_KEY(userId));
    return raw ? (JSON.parse(raw) as TaskGoal[]).map(normaliseCachedGoal) : null;
  } catch {
    await AsyncStorage.removeItem(GOALS_CACHE_KEY(userId)).catch(() => {});
    return null;
  }
}

function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}

/**
 * The calendar renders a goal with a deadline as a `goal_deadline` row on that
 * day, showing its title and striking it through once complete. So creating,
 * retitling, rescheduling, completing or deleting one makes whatever range the
 * calendar has cached wrong — and that cache is persisted, so without this a
 * deleted goal's deadline survived app restarts.
 *
 * taskStore does the same thing for the same reason; see the note there. Only
 * the flag is set: the calendar screen refetches when it next gains focus, so
 * the user pays for a request only if they actually open the tab. Imported
 * lazily to keep goalStore out of the store import cycle.
 */
function invalidateCalendar(): void {
  import('./calendarStore')
    .then(({ useCalendarStore }) => useCalendarStore.getState().invalidate())
    .catch((err) => console.warn('[goals] calendar invalidate failed:', err));
}

interface CreateGoalInput {
  title: string;
  tag?: string | null;
  /** Calendar day, 'YYYY-MM-DD'. */
  deadline?: string | null;
  /**
   * Linked in the SAME request that creates the goal. Creation used to be two
   * calls — create, then attach — which left a third outcome to handle: a goal
   * that exists without the tasks the user just picked. One request removes
   * that state rather than handling it.
   */
  taskIds?: string[];
}

/** Add and remove task links on an existing goal. Deltas, never a whole set. */
export interface GoalLinkDelta {
  link?: string[];
  unlink?: string[];
}

interface GoalStoreState {
  goals: TaskGoal[];
  isLoading: boolean;
  error: string | null;

  hydrateGoals: (userId: string) => Promise<void>;
  fetchGoals: (silent?: boolean) => Promise<void>;
  createGoal: (data: CreateGoalInput) => Promise<TaskGoal | null>;
  linkTasks: (id: string, delta: GoalLinkDelta) => Promise<boolean>;
  updateGoal: (id: string, data: Partial<TaskGoal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  toggleGoalComplete: (id: string) => Promise<void>;
  clearGoals: (userId?: string) => void;
}

export const useGoalStore = create<GoalStoreState>((set, get) => ({
  goals: [],
  isLoading: false,
  error: null,

  hydrateGoals: async (userId: string) => {
    const cached = await readCachedGoals(userId);
    if (!cached || cached.length === 0) return;
    const confirmed = cached.filter((g) => !isTempId(g.id));
    if (confirmed.length > 0) set({ goals: confirmed });
  },

  fetchGoals: async (silent = false) => {
    const userId = useAuthStore.getState().user?.id;
    if (!silent) set({ isLoading: true, error: null });
    try {
      const res = await api.get<TaskGoal[]>('/task-goals');
      if (res.success && res.data) {
        const goals = res.data;
        set({ goals, isLoading: false });
        persistGoals(goals, userId);
      } else {
        set({ error: res.error || 'Failed to fetch goals', isLoading: false });
      }
    } catch {
      set({ error: 'Failed to fetch goals', isLoading: false });
    }
  },

  createGoal: async (data) => {
    const userId = useAuthStore.getState().user?.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempGoal: TaskGoal = {
      id: tempId,
      title: data.title,
      tag: data.tag ?? null,
      targetSessions: null,
      progressMode: 'tasks',
      deadline: data.deadline ?? null,
      isCompleted: false,
      completedAt: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      // Placeholder until the server responds. linkedTaskCount is the count the
      // user just chose, not zero — the tasks go in with the create, so showing
      // 0 would flash a wrong number before the response lands.
      linkedTaskCount: data.taskIds?.length ?? 0,
      completedTaskCount: 0,
      actualSessions: 0,
      totalFocusSeconds: 0,
      elapsedDays: 0,
      taskProgress: 0,
      sessionProgress: null,
      overallProgress: 0,
    };
    const withTemp = [tempGoal, ...get().goals];
    set({ goals: withTemp });
    persistGoals(withTemp, userId);

    try {
      const res = await api.post<TaskGoal>('/task-goals', data);
      if (res.success && res.data) {
        const confirmed = res.data;
        const current = get().goals;
        const next = current.some((g) => g.id === tempId)
          ? current.map((g) => (g.id === tempId ? confirmed : g))
          : current.some((g) => g.id === confirmed.id)
          ? current
          : [confirmed, ...current];
        set({ goals: next });
        persistGoals(next, userId);
        // Only a goal with a deadline has a day to appear on.
        if (confirmed.deadline) invalidateCalendar();
        return confirmed;
      }
      return tempGoal;
    } catch {
      return tempGoal;
    }
  },

  /**
   * Add and remove task links on one goal.
   *
   * No optimistic write: the counts this moves (linkedTaskCount,
   * completedTaskCount, overallProgress) are server-computed and the client is
   * explicitly not allowed to recompute them — see the note on TaskGoal in
   * types/index.ts. Guessing them here is how the client and server came to
   * disagree about the same goal before.
   */
  linkTasks: async (id, delta) => {
    const userId = useAuthStore.getState().user?.id;
    try {
      const res = await api.post<TaskGoal>(`/task-goals/${id}/tasks`, delta);
      if (!res.success || !res.data) return false;
      const goals = get().goals.map((g) => (g.id === id ? { ...g, ...res.data } : g));
      set({ goals });
      persistGoals(goals, userId);
      return true;
    } catch {
      return false;
    }
  },

  updateGoal: async (id, data) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().goals;
    const deadlineBefore = previous.find((g) => g.id === id)?.deadline ?? null;
    const optimistic = previous.map((g) => (g.id === id ? { ...g, ...data } : g));
    set({ goals: optimistic });
    persistGoals(optimistic, userId);
    try {
      const res = await api.patch<TaskGoal>(`/task-goals/${id}`, data);
      if (res.success && res.data) {
        const goals = get().goals.map((g) => (g.id === id ? { ...g, ...res.data } : g));
        set({ goals });
        persistGoals(goals, userId);
        // Both ends matter: clearing a deadline removes a row, and adding one
        // creates a row on a day the calendar may already have cached.
        if (deadlineBefore || res.data.deadline) invalidateCalendar();
      } else {
        set({ goals: previous });
        persistGoals(previous, userId);
      }
    } catch {
      set({ goals: previous });
      persistGoals(previous, userId);
    }
  },

  deleteGoal: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().goals;
    const removedDeadline = previous.find((g) => g.id === id)?.deadline ?? null;
    const goals = previous.filter((g) => g.id !== id);
    set({ goals });
    persistGoals(goals, userId);
    try {
      const res = await api.delete(`/task-goals/${id}`);
      if (!res.success) {
        set({ goals: previous });
        persistGoals(previous, userId);
      } else if (removedDeadline) {
        invalidateCalendar();
      }
    } catch {
      set({ goals: previous });
      persistGoals(previous, userId);
    }
  },

  toggleGoalComplete: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    const nowCompleted = !goal.isCompleted;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    const optimistic = get().goals.map((g) =>
      g.id === id ? { ...g, isCompleted: nowCompleted, completedAt } : g,
    );
    set({ goals: optimistic });
    persistGoals(optimistic, userId);
    try {
      await api.patch(`/task-goals/${id}`, { isCompleted: nowCompleted, completedAt });
      // The calendar strikes a completed goal's deadline row through, so the
      // toggle changes what it draws even though the day is unchanged.
      if (goal.deadline) invalidateCalendar();
    } catch {
      const reverted = get().goals.map((g) =>
        g.id === id ? { ...g, isCompleted: goal.isCompleted, completedAt: goal.completedAt } : g,
      );
      set({ goals: reverted });
      persistGoals(reverted, userId);
    }
  },

  clearGoals: (userId?: string) => {
    const resolvedUserId = userId ?? useAuthStore.getState().user?.id;
    set({ goals: [], isLoading: false, error: null });
    if (resolvedUserId) {
      AsyncStorage.removeItem(GOALS_CACHE_KEY(resolvedUserId)).catch(() => {});
    }
  },
}));
