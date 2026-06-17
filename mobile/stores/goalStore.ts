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

async function readCachedGoals(userId: string): Promise<TaskGoal[] | null> {
  try {
    const raw = await AsyncStorage.getItem(GOALS_CACHE_KEY(userId));
    return raw ? (JSON.parse(raw) as TaskGoal[]) : null;
  } catch {
    await AsyncStorage.removeItem(GOALS_CACHE_KEY(userId)).catch(() => {});
    return null;
  }
}

function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}

interface CreateGoalInput {
  title: string;
  tag?: string | null;
  targetSessions?: number | null;
  deadline?: string | null;
}

interface GoalStoreState {
  goals: TaskGoal[];
  isLoading: boolean;
  error: string | null;

  hydrateGoals: (userId: string) => Promise<void>;
  fetchGoals: (silent?: boolean) => Promise<void>;
  createGoal: (data: CreateGoalInput) => Promise<TaskGoal | null>;
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
      targetSessions: data.targetSessions ?? null,
      deadline: data.deadline ?? null,
      isCompleted: false,
      completedAt: null,
      isArchived: false,
      createdAt: new Date().toISOString(),
      linkedTaskCount: 0,
      completedTaskCount: 0,
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
        return confirmed;
      }
      return tempGoal;
    } catch {
      return tempGoal;
    }
  },

  updateGoal: async (id, data) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().goals;
    const optimistic = previous.map((g) => (g.id === id ? { ...g, ...data } : g));
    set({ goals: optimistic });
    persistGoals(optimistic, userId);
    try {
      const res = await api.patch<TaskGoal>(`/task-goals/${id}`, data);
      if (res.success && res.data) {
        const goals = get().goals.map((g) => (g.id === id ? { ...g, ...res.data } : g));
        set({ goals });
        persistGoals(goals, userId);
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
    const goals = previous.filter((g) => g.id !== id);
    set({ goals });
    persistGoals(goals, userId);
    try {
      const res = await api.delete(`/task-goals/${id}`);
      if (!res.success) {
        set({ goals: previous });
        persistGoals(previous, userId);
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
