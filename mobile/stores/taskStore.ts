import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { Task, DayOfWeek } from '../types';
import { useAuthStore } from './authStore';
import { removeTaskSessionsFromHistory } from '../store/sync';
import { getLocalDateString } from '../utils/date';

const TASKS_CACHE_KEY = (userId: string) => `tasks:cache:${userId}`;

// userId is passed explicitly so failures are visible (console.warn) rather than silent.
async function persistTasks(tasks: Task[], userId: string | null | undefined): Promise<void> {
  if (!userId) {
    console.warn('[taskStore] persistTasks: no userId — cache write skipped');
    return;
  }
  try {
    await AsyncStorage.setItem(TASKS_CACHE_KEY(userId), JSON.stringify(tasks));
  } catch (err) {
    console.warn('[taskStore] persistTasks failed:', err);
  }
}

async function readCachedTasks(userId: string): Promise<Task[] | null> {
  try {
    const raw = await AsyncStorage.getItem(TASKS_CACHE_KEY(userId));
    return raw ? (JSON.parse(raw) as Task[]) : null;
  } catch {
    await AsyncStorage.removeItem(TASKS_CACHE_KEY(userId)).catch(() => {});
    return null;
  }
}

function normalizeTask(t: Task): Task {
  return {
    ...t,
    priority: t.priority ?? 'medium',
    sessionsOnTask: t.sessionsOnTask ?? 0,
    totalTimeOnTask: t.totalTimeOnTask ?? 0,
    sessionDates: Array.isArray(t.sessionDates) ? t.sessionDates : [],
    isRecurring: t.isRecurring ?? false,
    recurringDays: t.recurringDays ?? [],
    lastSpawnedDate: t.lastSpawnedDate ?? null,
    parentTaskId: t.parentTaskId ?? null,
    // Template lifetime stats:
    currentStreak: t.currentStreak ?? 0,
    longestStreak: t.longestStreak ?? 0,
    totalCompletions: t.totalCompletions ?? 0,
    totalFocusTimeMs: t.totalFocusTimeMs ?? 0,
    // Instance display copies:
    lifetimeStreak: t.lifetimeStreak ?? 0,
    lifetimeTotalCompletions: t.lifetimeTotalCompletions ?? 0,
    lifetimeTotalFocusTime: t.lifetimeTotalFocusTime ?? 0,
  };
}

function normalizeTasks(raw: Task[]): Task[] {
  return raw.map(normalizeTask);
}

// Goal progress (linked/completed task counts, session counts, auto-completion)
// is computed server-side. Any task change that could move it is followed by a
// silent goal refetch so the two never drift. Imported lazily to avoid a static
// circular import between the task and goal stores.
function refreshGoals(): void {
  import('./goalStore')
    .then(({ useGoalStore }) => useGoalStore.getState().fetchGoals(true))
    .catch((err) => console.warn('[tasks] goal refresh failed:', err));
}

// Payloads mirroring the backend's createTaskSchema / updateTaskSchema. These
// were previously narrower than what the form actually sends, so call sites used
// `as any` — which is exactly how taskGoalId went missing on create without
// anything failing to compile.
export interface TaskCreateInput {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  isRecurring?: boolean;
  recurringDays?: DayOfWeek[];
  taskGoalId?: string | null;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
  estimatedMinutes?: number | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  isCompleted?: boolean;
  completedAt?: string | null;
  taskGoalId?: string | null;
  order?: number | null;
  isRecurring?: boolean;
  recurringDays?: DayOfWeek[];
}

function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}

interface TaskStoreState {
  tasks: Task[];
  recurringTemplates: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  hydrateTasks: (userId: string) => Promise<void>;
  fetchTasks: (silent?: boolean) => Promise<void>;
  createTask: (data: TaskCreateInput) => Promise<Task | null>;
  updateTask: (id: string, data: TaskUpdateInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  selectTask: (id: string | null) => void;
  incrementTaskSession: (id: string, duration: number) => void;
  toggleComplete: (id: string) => Promise<void>;
  clearTasks: (userId?: string) => Promise<void>;
  spawnRecurringTasks: () => Promise<void>;
  fetchRecurringTemplates: () => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
  recurringTemplates: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,

  hydrateTasks: async (userId: string) => {
    const cached = await readCachedTasks(userId);
    if (!cached || cached.length === 0) return;
    // Strip any temp-ID tasks left from a previous session that was killed mid-POST.
    // They are unconfirmed and will never be synced — load only server-confirmed tasks.
    const confirmed = normalizeTasks(cached.filter((t) => !isTempId(t.id)));
    if (confirmed.length > 0) {
      set({ tasks: confirmed });
    } else {
      // Only stale temp tasks in cache — clean the file so we don't loop.
      await AsyncStorage.removeItem(TASKS_CACHE_KEY(userId)).catch(() => {});
    }
  },

  fetchTasks: async (silent = false) => {
    const userId = useAuthStore.getState().user?.id;
    if (!silent) set({ isLoading: true, error: null });
    try {
      const res = await api.get<Task[]>('/tasks');
      if (res.success && res.data) {
        // Guard: never overwrite a populated store with an empty server response.
        if (!res.data.length && get().tasks.length > 0) {
          if (!silent) set({ isLoading: false });
          return;
        }
        const rawTasks = normalizeTasks(res.data);
        // Use server fields directly — normalizeTasks already applies ?? defaults
        const serverTasks = rawTasks;

        // Preserve locally-created temp tasks whose POST is still in flight.
        const serverIds = new Set(serverTasks.map((t) => t.id));
        const orphanedTemps = get().tasks.filter(
          (t) => isTempId(t.id) && !serverIds.has(t.id),
        );
        const tasks = orphanedTemps.length > 0
          ? [...orphanedTemps, ...serverTasks]
          : serverTasks;

        set({ tasks, isLoading: false });
        persistTasks(tasks, userId);
      } else {
        set({ error: res.error || 'Failed to fetch tasks', isLoading: false });
      }
    } catch {
      set({ error: 'Failed to fetch tasks', isLoading: false });
    }
  },

  createTask: async (data) => {
    const userId = useAuthStore.getState().user?.id;
    // Show the task instantly. The temp ID is swapped for the server ID once the POST resolves.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempTask: Task = {
      id: tempId,
      title: data.title,
      description: data.description || undefined,
      dueDate: data.dueDate || undefined,
      tags: data.tags || [],
      estimatedMinutes: data.estimatedMinutes || undefined,
      priority: data.priority ?? 'medium',
      isArchived: false,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      sessionsOnTask: 0,
      totalTimeOnTask: 0,
      sessionDates: [],
      isRecurring: data.isRecurring ?? false,
      recurringDays: data.recurringDays ?? [],
      taskGoalId: data.taskGoalId ?? null,
      lastSpawnedDate: null,
      parentTaskId: null,
      currentStreak: 0,
      longestStreak: 0,
      totalCompletions: 0,
      totalFocusTimeMs: 0,
      lifetimeStreak: 0,
      lifetimeTotalCompletions: 0,
      lifetimeTotalFocusTime: 0,
    };
    const withTemp = [tempTask, ...get().tasks];
    set({ tasks: withTemp });
    persistTasks(withTemp, userId); // Survive an app kill during the POST

    try {
      const res = await api.post<Task>('/tasks', { ...data, localDate: getLocalDateString() });
      if (res.success && res.data) {
        const confirmed = normalizeTask(res.data);
        // Recurring tasks: the POST returns the TEMPLATE, which must never appear in
        // the list. Drop the temp task and refetch — the backend already spawned
        // today's instance, so fetchTasks pulls it in (templates are filtered out).
        if (confirmed.isRecurring) {
          const withoutTemp = get().tasks.filter((t) => t.id !== tempId);
          set({ tasks: withoutTemp });
          persistTasks(withoutTemp, userId);
          await get().fetchTasks(true);
          return confirmed;
        }
        // fetchTasks may have run while the POST was in flight, evicting the temp task.
        const current = get().tasks;
        const hasTemp = current.some((t) => t.id === tempId);
        const hasReal = current.some((t) => t.id === confirmed.id);
        const next = hasTemp
          ? current.map((t) => (t.id === tempId ? confirmed : t))
          : hasReal
          ? current
          : [confirmed, ...current];
        set({ tasks: next });
        persistTasks(next, userId);
        // A task created into a goal changes that goal's linked count.
        if (confirmed.taskGoalId) refreshGoals();
        return confirmed;
      }
      // Server rejected — temp task stays visible; next fetchTasks will reconcile.
      return tempTask;
    } catch {
      // Network failure — temp task stays in store and cache for the next session.
      return tempTask;
    }
  },

  updateTask: async (id, data) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().tasks;
    const optimistic = previous.map((t) => (t.id === id ? { ...t, ...data } : t));
    set({ tasks: optimistic });
    persistTasks(optimistic, userId);
    try {
      const res = await api.patch<Task>(`/tasks/${id}`, data);
      if (res.success && res.data) {
        const tasks = get().tasks.map((t) => (t.id === id ? { ...t, ...res.data } : t));
        set({ tasks });
        persistTasks(tasks, userId);
        // Completion or a goal re-link both move goal progress server-side.
        if (data.isCompleted !== undefined || data.taskGoalId !== undefined) refreshGoals();
      } else {
        set({ tasks: previous });
        persistTasks(previous, userId);
      }
    } catch (err) {
      console.warn('[tasks] updateTask failed:', err);
      set({ tasks: previous });
      persistTasks(previous, userId);
    }
  },

  deleteTask: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().tasks;
    const previousSelectedId = get().selectedTaskId;
    const tasks = previous.filter((t) => t.id !== id);
    set({ tasks, selectedTaskId: previousSelectedId === id ? null : previousSelectedId });
    persistTasks(tasks, userId);
    try {
      const res = await api.delete(`/tasks/${id}`);
      if (!res.success) {
        set({ tasks: previous, selectedTaskId: previousSelectedId });
        persistTasks(previous, userId);
      } else {
        // The task's focus sessions were deleted server-side — drop them from the
        // local time-tracker cache too so its stats update without a full reconcile.
        removeTaskSessionsFromHistory(id).catch(() => {});
      }
    } catch (err) {
      console.warn('[tasks] deleteTask failed:', err);
      set({ tasks: previous, selectedTaskId: previousSelectedId });
      persistTasks(previous, userId);
    }
  },

  selectTask: (id) => {
    set({ selectedTaskId: id });
  },

  toggleComplete: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const nowCompleted = !task.isCompleted;
    // Build a local-timezone ISO string so the date portion reflects the user's local date,
    // not UTC. e.g. "2026-06-15T23:00:00+05:00" instead of "2026-06-16T06:00:00.000Z"
    const completedAt = nowCompleted ? (() => {
      const d = new Date();
      const off = -d.getTimezoneOffset(); // minutes ahead of UTC
      const sign = off >= 0 ? '+' : '-';
      const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
             `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
             `${sign}${pad(off/60)}:${pad(off%60)}`;
    })() : null;
    const optimistic = get().tasks.map((t) =>
      t.id === id ? { ...t, isCompleted: nowCompleted, completedAt: completedAt ?? undefined } : t,
    );
    set({ tasks: optimistic });
    persistTasks(optimistic, userId);
    try {
      await api.patch(`/tasks/${id}`, { isCompleted: nowCompleted, completedAt });
      // The server owns goal progress and may have just auto-completed this
      // task's goal. Reconcile rather than recomputing locally.
      if (task.taskGoalId) refreshGoals();
    } catch {
      const reverted = get().tasks.map((t) =>
        t.id === id ? { ...t, isCompleted: task.isCompleted, completedAt: task.completedAt } : t,
      );
      set({ tasks: reverted });
      persistTasks(reverted, userId);
    }
  },

  incrementTaskSession: (id: string, duration: number) => {
    const userId = useAuthStore.getState().user?.id;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const updated = get().tasks.map((task) =>
      task.id !== id ? task : {
        ...task,
        sessionsOnTask: task.sessionsOnTask + 1,
        totalTimeOnTask: task.totalTimeOnTask + duration,
        sessionDates: [...new Set([...task.sessionDates, today])],
      },
    );
    set({ tasks: updated });
    persistTasks(updated, userId);
  },

  clearTasks: async (userId?: string) => {
    const resolvedUserId = userId ?? useAuthStore.getState().user?.id;
    set({ tasks: [], recurringTemplates: [], selectedTaskId: null, isLoading: false, error: null });
    if (resolvedUserId) {
      AsyncStorage.removeItem(TASKS_CACHE_KEY(resolvedUserId)).catch(() => {});
    }
  },

  // Asks the backend to spawn today's instances for any recurring templates that
  // haven't spawned yet today. Non-critical and never throws.
  spawnRecurringTasks: async () => {
    try {
      // localDate makes the server spawn against the user's calendar day. Without
      // it the server falls back to its own UTC date, which ends the day early
      // for anyone west of UTC and resets their habit streak a day sooner.
      const res = await api.post<{ spawned: number; archived?: number; templateIds: string[] }>(
        '/tasks/spawn-recurring',
        { localDate: getLocalDateString() },
      );
      // Refetch when anything changed — not just on spawn. A new day can archive a
      // missed instance without spawning one (non-scheduled day, or already spawned),
      // and without a refetch that stale instance lingers locally as "overdue".
      const changed = res.success && res.data && ((res.data.spawned ?? 0) > 0 || (res.data.archived ?? 0) > 0);
      if (changed) {
        await get().fetchTasks(true);
        console.log('[taskStore] recurring: spawned', res.data!.spawned, 'archived', res.data!.archived ?? 0);
      }
    } catch (err) {
      console.warn('[taskStore] spawnRecurringTasks failed:', err);
    }
  },

  fetchRecurringTemplates: async () => {
    try {
      const res = await api.get<Task[]>('/tasks/recurring');
      if (res.success && res.data) {
        set({ recurringTemplates: normalizeTasks(res.data) });
      }
    } catch (err) {
      console.warn('[taskStore] fetchRecurringTemplates failed:', err);
    }
  },
}));

// Called from _layout.tsx bootstrap after all modules are loaded.
// Keeping this out of module scope breaks the circular import crash:
//   authStore → timerStore → taskStore → authStore
export function initTaskStore(): void {
  useAuthStore.subscribe((state, prevState) => {
    if (prevState.user && !state.user) {
      const userId = prevState.user.id;
      useTaskStore.getState().clearTasks(userId);
      // Lazy import to avoid circular deps
      import('./goalStore').then(({ useGoalStore }) => useGoalStore.getState().clearGoals(userId));
    }
  });
}
