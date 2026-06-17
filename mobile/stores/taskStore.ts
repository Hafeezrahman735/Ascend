import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { Task } from '../types';
import { useAuthStore } from './authStore';

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
    sessionDates: t.sessionDates ?? [],
  };
}

function normalizeTasks(raw: Task[]): Task[] {
  return raw.map(normalizeTask);
}

function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}

interface TaskStoreState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  hydrateTasks: (userId: string) => Promise<void>;
  fetchTasks: (silent?: boolean) => Promise<void>;
  createTask: (data: {
    title: string;
    description?: string;
    dueDate?: string;
    tags?: string[];
    estimatedMinutes?: number;
  }) => Promise<Task | null>;
  updateTask: (id: string, data: Partial<{
    title: string;
    description: string | null;
    dueDate: string | null;
    tags: string[];
    estimatedMinutes: number | null;
  }>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  selectTask: (id: string | null) => void;
  incrementTaskSession: (id: string, duration: number) => void;
  toggleComplete: (id: string) => Promise<void>;
  clearTasks: (userId?: string) => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
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
      priority: 'medium',
      isArchived: false,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      sessionsOnTask: 0,
      totalTimeOnTask: 0,
      sessionDates: [],
    };
    const withTemp = [tempTask, ...get().tasks];
    set({ tasks: withTemp });
    persistTasks(withTemp, userId); // Survive an app kill during the POST

    try {
      const res = await api.post<Task>('/tasks', data);
      if (res.success && res.data) {
        const confirmed = normalizeTask(res.data);
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
    set({ tasks: [], selectedTaskId: null, isLoading: false, error: null });
    if (resolvedUserId) {
      AsyncStorage.removeItem(TASKS_CACHE_KEY(resolvedUserId)).catch(() => {});
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
