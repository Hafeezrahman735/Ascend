import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { Task } from '../types';
import { getAllTaskStatsFromHistory } from '../store/sync';
import { useAuthStore } from './authStore';

const taskCacheKey = (userId: string) => `tasks:cache:${userId}`;

async function writeCachedTasks(userId: string, tasks: Task[]) {
  try {
    await AsyncStorage.setItem(taskCacheKey(userId), JSON.stringify(tasks));
  } catch {}
}

async function readCachedTasks(userId: string): Promise<Task[] | null> {
  try {
    const raw = await AsyncStorage.getItem(taskCacheKey(userId));
    return raw ? (JSON.parse(raw) as Task[]) : null;
  } catch {
    return null;
  }
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
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,

  hydrateTasks: async (userId: string) => {
    const cached = await readCachedTasks(userId);
    if (cached && cached.length > 0) {
      set({ tasks: cached });
    }
  },

  fetchTasks: async (silent = false) => {
    if (!silent) set({ isLoading: true, error: null });
    try {
      const res = await api.get<Task[]>('/tasks');
      if (res.success && res.data) {
        const rawTasks = res.data.map((t) => ({ ...t, priority: t.priority ?? 'medium' }));
        const taskIds = rawTasks.map((t) => t.id);
        const statsMap = await getAllTaskStatsFromHistory(taskIds);
        const tasks = rawTasks.map((t) => {
          const stats = statsMap.get(t.id);
          return stats ? { ...t, ...stats } : t;
        });
        set({ tasks, isLoading: false });
        const userId = useAuthStore.getState().user?.id;
        if (userId) writeCachedTasks(userId, tasks);
      } else {
        set({ error: res.error || 'Failed to fetch tasks', isLoading: false });
      }
    } catch {
      set({ error: 'Failed to fetch tasks', isLoading: false });
    }
  },

  createTask: async (data) => {
    const userId = useAuthStore.getState().user?.id;
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    // Fix 3: persist optimistic state immediately so a kill-during-POST survives restart
    if (userId) writeCachedTasks(userId, withTemp);
    try {
      const res = await api.post<Task>('/tasks', data);
      if (res.success && res.data) {
        // Fix 2: handle race where background fetchTasks already evicted the temp entry
        const current = get().tasks;
        const hasTemp = current.some((t) => t.id === tempId);
        const hasReal = current.some((t) => t.id === res.data!.id);
        const confirmed = hasTemp
          ? current.map((t) => (t.id === tempId ? res.data! : t))
          : hasReal
          ? current
          : [res.data!, ...current];
        set({ tasks: confirmed });
        // Fix 1: keep cache in sync after confirmed creation
        if (userId) writeCachedTasks(userId, confirmed);
        return res.data;
      }
      return tempTask;
    } catch {
      return tempTask;
    }
  },

  updateTask: async (id, data) => {
    try {
      const res = await api.patch<Task>(`/tasks/${id}`, data);
      if (res.success && res.data) {
        const tasks = get().tasks.map((t) => (t.id === id ? { ...t, ...res.data } : t));
        set({ tasks });
        // Fix 1: write cache after confirmed update
        const userId = useAuthStore.getState().user?.id;
        if (userId) writeCachedTasks(userId, tasks);
      }
    } catch (err) {
      console.warn('[tasks] updateTask failed:', err);
    }
  },

  deleteTask: async (id) => {
    try {
      const res = await api.delete(`/tasks/${id}`);
      if (res.success) {
        const tasks = get().tasks.filter((t) => t.id !== id);
        const selectedTaskId = get().selectedTaskId === id ? null : get().selectedTaskId;
        set({ tasks, selectedTaskId });
        // Fix 1: write cache after confirmed deletion
        const userId = useAuthStore.getState().user?.id;
        if (userId) writeCachedTasks(userId, tasks);
      }
    } catch (err) {
      console.warn('[tasks] deleteTask failed:', err);
    }
  },

  selectTask: (id) => {
    set({ selectedTaskId: id });
  },

  toggleComplete: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const userId = useAuthStore.getState().user?.id;
    const nowCompleted = !task.isCompleted;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    const optimistic = get().tasks.map((t) =>
      t.id === id ? { ...t, isCompleted: nowCompleted, completedAt: completedAt ?? undefined } : t
    );
    set({ tasks: optimistic });
    // Fix 1: persist optimistic toggle — server confirmation rarely fails
    if (userId) writeCachedTasks(userId, optimistic);
    try {
      await api.patch(`/tasks/${id}`, {
        isCompleted: nowCompleted,
        completedAt: completedAt,
      });
    } catch {
      const reverted = get().tasks.map((t) =>
        t.id === id ? { ...t, isCompleted: task.isCompleted, completedAt: task.completedAt } : t
      );
      set({ tasks: reverted });
      // Fix 1: revert cache on failure
      if (userId) writeCachedTasks(userId, reverted);
    }
  },

  incrementTaskSession: (id: string, duration: number) => {
    const today = new Date().toISOString().split('T')[0];
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id !== id ? task : {
          ...task,
          sessionsOnTask: task.sessionsOnTask + 1,
          totalTimeOnTask: task.totalTimeOnTask + duration,
          sessionDates: [...new Set([...task.sessionDates, today])],
        }
      ),
    }));
  },
}));
