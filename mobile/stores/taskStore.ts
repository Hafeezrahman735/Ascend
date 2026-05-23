import { create } from 'zustand';
import { api } from '../services/api';
import { Task } from '../types';
import { getAllTaskStatsFromHistory } from '../store/sync';

interface TaskStoreState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
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

  fetchTasks: async () => {
    set({ isLoading: true, error: null });
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
      } else {
        set({ error: res.error || 'Failed to fetch tasks', isLoading: false });
      }
    } catch {
      set({ error: 'Failed to fetch tasks', isLoading: false });
    }
  },

  createTask: async (data) => {
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
    const tasks = get().tasks;
    set({ tasks: [tempTask, ...tasks] });
    try {
      const res = await api.post<Task>('/tasks', data);
      if (res.success && res.data) {
        set({ tasks: get().tasks.map((t) => (t.id === tempId ? res.data! : t)) });
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
    const nowCompleted = !task.isCompleted;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, isCompleted: nowCompleted, completedAt: completedAt ?? undefined } : t
      ),
    });
    try {
      await api.patch(`/tasks/${id}`, {
        isCompleted: nowCompleted,
        completedAt: completedAt,
      });
    } catch {
      set({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, isCompleted: task.isCompleted, completedAt: task.completedAt } : t
        ),
      });
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
