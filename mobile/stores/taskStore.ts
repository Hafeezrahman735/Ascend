import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { Task, DayOfWeek } from '../types';
import { useAuthStore } from './authStore';
import { getLocalDateString } from '../utils/date';
import { canSelectTask, isSessionLocked } from './sessionLock';

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
    // Tasks cached by an older build predate these, so undefined is expected.
    startMinutes: t.startMinutes ?? null,
    endMinutes: t.endMinutes ?? null,
    isOccurrence: t.isOccurrence ?? false,
    occurrenceDate: t.occurrenceDate ?? null,
    repeatsUntil: t.repeatsUntil ?? null,
    currentStreak: t.currentStreak ?? 0,
    longestStreak: t.longestStreak ?? 0,
    totalCompletions: t.totalCompletions ?? 0,
    totalFocusSeconds: t.totalFocusSeconds ?? 0,
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

// The calendar places tasks by due date, so creating, rescheduling, completing
// or deleting one makes whatever range the calendar has cached wrong. Flagging
// is enough: the calendar screen refetches when it next gains focus, so the
// user pays for one request only if they actually open the tab. Imported lazily
// for the same reason as refreshGoals — a static import would close the
// authStore -> timerStore -> taskStore cycle noted at initTaskStore below.
function invalidateCalendar(): void {
  import('./calendarStore')
    .then(({ useCalendarStore }) => useCalendarStore.getState().invalidate())
    .catch((err) => console.warn('[tasks] calendar invalidate failed:', err));
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
  // Minutes from local midnight. Send both or neither — the backend rejects a
  // half-open pair, and null on either clears the slot.
  startMinutes?: number | null;
  endMinutes?: number | null;
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
  // Minutes from local midnight. Send both or neither — the backend rejects a
  // half-open pair, and null on either clears the slot.
  startMinutes?: number | null;
  endMinutes?: number | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  isCompleted?: boolean;
  completedAt?: string | null;
  taskGoalId?: string | null;
  order?: number | null;
  isRecurring?: boolean;
  recurringDays?: DayOfWeek[];
}

/**
 * Tick off, or un-tick, one day of a recurring task. A recurring task is done
 * per day, in its completion log; the server rejects a PATCH of isCompleted on
 * one. The local day goes in the query because a DELETE carries no body.
 */
function setOccurrenceDone(id: string, date: string, done: boolean) {
  const url = `/tasks/${id}/completions/${date}?localDate=${encodeURIComponent(getLocalDateString())}`;
  return done ? api.put(url, {}) : api.delete(url);
}

function isTempId(id: string): boolean {
  return id.startsWith('temp-');
}

/**
 * A recurring task as itself, not as one day's row. The list shows recurring
 * tasks only as day rows from GET /tasks, so a row like this — what POST and
 * PATCH return — must not be merged into it.
 */
function isRecurringTask(t: Task): boolean {
  return t.isRecurring && !t.isOccurrence;
}

/**
 * What an edit may change on a recurring task's day row without a refetch. The
 * row's dueDate is its day, not the task's end date, and its schedule fields
 * decide whether it is listed at all, so those wait for the server.
 */
function optimisticEdit(row: Task, data: TaskUpdateInput): Task {
  if (!row.isOccurrence) return { ...row, ...data } as Task;
  const { dueDate: _dueDate, isRecurring: _isRecurring, recurringDays: _days, ...safe } = data;
  return { ...row, ...safe } as Task;
}

/**
 * Now as a local-time ISO string with its offset, so the date portion is the
 * user's day: "2026-06-15T23:00:00+05:00", not "2026-06-16T06:00:00.000Z".
 */
function localTimestamp(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset(); // minutes ahead of UTC
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
         `${sign}${pad(off/60)}:${pad(off%60)}`;
}

export interface CreateTaskResult {
  task: Task | null;
  /** Why the task was not saved, fit to show the user. Null on success. */
  error: string | null;
}

interface TaskStoreState {
  tasks: Task[];
  recurringTemplates: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  /**
   * True once tasks have come from the server or the device cache. Before that,
   * an empty list means "not loaded yet", not "this user has no tasks" — the
   * difference between a loading state and the first-run prompt on Today.
   */
  hasLoaded: boolean;
  error: string | null;

  hydrateTasks: (userId: string) => Promise<void>;
  fetchTasks: (silent?: boolean) => Promise<void>;
  createTask: (data: TaskCreateInput) => Promise<CreateTaskResult>;
  updateTask: (id: string, data: TaskUpdateInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  /** Returns false when refused because a focus session is running (see sessionLock). */
  selectTask: (id: string | null) => boolean;
  incrementTaskSession: (id: string, duration: number) => void;
  toggleComplete: (id: string) => Promise<void>;
  /** Tick or un-tick one day of a recurring task, for any day (the calendar). */
  setOccurrenceCompletion: (id: string, date: string, done: boolean) => Promise<boolean>;
  clearTasks: (userId?: string) => Promise<void>;
  fetchRecurringTemplates: () => Promise<void>;
  refreshRecurring: () => Promise<void>;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  tasks: [],
  recurringTemplates: [],
  selectedTaskId: null,
  isLoading: false,
  hasLoaded: false,
  error: null,

  hydrateTasks: async (userId: string) => {
    const cached = await readCachedTasks(userId);
    if (!cached || cached.length === 0) return;
    // Strip any temp-ID tasks left from a previous session that was killed mid-POST.
    // They are unconfirmed and will never be synced — load only server-confirmed tasks.
    const confirmed = normalizeTasks(cached.filter((t) => !isTempId(t.id)));
    if (confirmed.length > 0) {
      set({ tasks: confirmed, hasLoaded: true });
    } else {
      // Only stale temp tasks in cache — clean the file so we don't loop.
      await AsyncStorage.removeItem(TASKS_CACHE_KEY(userId)).catch(() => {});
    }
  },

  fetchTasks: async (silent = false) => {
    const userId = useAuthStore.getState().user?.id;
    if (!silent) set({ isLoading: true, error: null });
    try {
      // localDate decides which recurring tasks have a row today, and whether
      // it is done. Without it the server uses its own UTC day, which is
      // already tomorrow for anyone west of UTC each evening.
      const res = await api.get<Task[]>(`/tasks?localDate=${encodeURIComponent(getLocalDateString())}`);
      if (res.success && res.data) {
        // Guard: never overwrite a populated store with an empty server response.
        if (!res.data.length && get().tasks.length > 0) {
          set({ hasLoaded: true });
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

        set({ tasks, isLoading: false, hasLoaded: true, error: null });
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
      startMinutes: data.startMinutes ?? null,
      endMinutes: data.endMinutes ?? null,
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
      isOccurrence: false,
      occurrenceDate: null,
      repeatsUntil: null,
      currentStreak: 0,
      longestStreak: 0,
      totalCompletions: 0,
      totalFocusSeconds: 0,
    };
    const withTemp = [tempTask, ...get().tasks];
    set({ tasks: withTemp });
    persistTasks(withTemp, userId); // Survive an app kill during the POST

    // A failed save must not look like a successful one. The temp row used to
    // stay on screen "for the next session", but hydrateTasks strips temp rows
    // on launch, so the task silently vanished the next time the app opened.
    const discardTemp = (): void => {
      const withoutTemp = get().tasks.filter((t) => t.id !== tempId);
      set({ tasks: withoutTemp });
      persistTasks(withoutTemp, userId);
    };

    try {
      const res = await api.post<Task>('/tasks', data);
      if (!res.success || !res.data) {
        discardTemp();
        return { task: null, error: res.error || 'The task could not be saved.' };
      }
      const confirmed = normalizeTask(res.data);
      // A recurring task is listed as a day row, which the POST does not return.
      // Drop the temp task and fetch whatever now represents it: today's row if
      // it is due today, else its entry in the recurring list.
      if (isRecurringTask(confirmed)) {
        discardTemp();
        await get().refreshRecurring();
        if (confirmed.taskGoalId) refreshGoals();
        return { task: confirmed, error: null };
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
      invalidateCalendar();
      return { task: confirmed, error: null };
    } catch (err) {
      console.warn('[tasks] createTask failed:', err);
      discardTemp();
      return { task: null, error: 'The task could not be saved. Check your connection and try again.' };
    }
  },

  updateTask: async (id, data) => {
    const userId = useAuthStore.getState().user?.id;
    const previous = get().tasks;
    const optimistic = previous.map((t) => (t.id === id ? optimisticEdit(t, data) : t));
    set({ tasks: optimistic });
    persistTasks(optimistic, userId);
    try {
      const res = await api.patch<Task>(`/tasks/${id}`, data);
      if (res.success && res.data) {
        const saved = normalizeTask(res.data);
        // A recurring task comes back as itself, not as today's row, so its
        // row is re-read rather than merged; a task just switched to recurring
        // is replaced the same way.
        if (isRecurringTask(saved)) {
          await get().refreshRecurring();
        } else {
          const tasks = get().tasks.map((t) => (t.id === id ? { ...t, ...saved } : t));
          set({ tasks });
          persistTasks(tasks, userId);
        }
        // Completion or a goal re-link both move goal progress server-side.
        if (data.isCompleted !== undefined || data.taskGoalId !== undefined) refreshGoals();
        invalidateCalendar();
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
    const previousTemplates = get().recurringTemplates;
    const previousSelectedId = get().selectedTaskId;
    // A recurring task's day row carries its id, so deleting the task removes it.
    const tasks = previous.filter((t) => t.id !== id);
    const selectedStillExists = tasks.some((t) => t.id === previousSelectedId);
    set({
      tasks,
      recurringTemplates: previousTemplates.filter((t) => t.id !== id),
      selectedTaskId: selectedStillExists ? previousSelectedId : null,
    });
    persistTasks(tasks, userId);
    const restore = (): void => {
      set({ tasks: previous, recurringTemplates: previousTemplates, selectedTaskId: previousSelectedId });
      persistTasks(previous, userId);
    };
    try {
      const res = await api.delete(`/tasks/${id}`);
      if (!res.success) {
        restore();
      } else {
        // The server archives the task and keeps its focus sessions, so the
        // local session history is left exactly as it is.
        invalidateCalendar();
      }
    } catch (err) {
      console.warn('[tasks] deleteTask failed:', err);
      restore();
    }
  },

  selectTask: (id) => {
    if (!canSelectTask(isSessionLocked(), get().selectedTaskId, id)) return false;
    set({ selectedTaskId: id });
    return true;
  },

  toggleComplete: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const nowCompleted = !task.isCompleted;
    const completedAt = nowCompleted ? localTimestamp() : null;
    const setCompletion = (isCompleted: boolean, at: string | null | undefined): void => {
      const tasks = get().tasks.map((t) => (t.id === id ? { ...t, isCompleted, completedAt: at ?? undefined } : t));
      set({ tasks });
      persistTasks(tasks, userId);
    };
    setCompletion(nowCompleted, completedAt);
    try {
      const res = task.isOccurrence && task.occurrenceDate
        ? await setOccurrenceDone(id, task.occurrenceDate, nowCompleted)
        : await api.patch(`/tasks/${id}`, { isCompleted: nowCompleted, completedAt });
      if (!res.success) throw new Error(res.error || 'Completion was not saved');
      // The day's streak moved with the tick; read it back.
      if (task.isOccurrence) await get().fetchTasks(true);
      // The server owns goal progress and may have just auto-completed this
      // task's goal. Reconcile rather than recomputing locally.
      if (task.taskGoalId) refreshGoals();
      invalidateCalendar();
    } catch (err) {
      console.warn('[tasks] toggleComplete failed:', err);
      setCompletion(task.isCompleted, task.completedAt);
    }
  },

  setOccurrenceCompletion: async (id, date, done) => {
    try {
      const res = await setOccurrenceDone(id, date, done);
      if (!res.success) throw new Error(res.error || 'Completion was not saved');
      // Today's row and its streak may have moved with the tick.
      await get().fetchTasks(true);
      const template = get().recurringTemplates.find((t) => t.id === id);
      if (template?.taskGoalId) refreshGoals();
      invalidateCalendar();
      return true;
    } catch (err) {
      console.warn('[tasks] setOccurrenceCompletion failed:', err);
      return false;
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
    set({ tasks: [], recurringTemplates: [], selectedTaskId: null, isLoading: false, hasLoaded: false, error: null });
    if (resolvedUserId) {
      AsyncStorage.removeItem(TASKS_CACHE_KEY(resolvedUserId)).catch(() => {});
    }
  },

  fetchRecurringTemplates: async () => {
    try {
      // localDate so the server decides scheduledToday against the user calendar
      // day. Without it the server falls back to its own UTC date, and a user
      // west of UTC sees the wrong schedule for several hours each night.
      const res = await api.get<Task[]>(
        `/tasks/recurring?localDate=${encodeURIComponent(getLocalDateString())}`,
      );
      if (res.success && res.data) {
        set({ recurringTemplates: normalizeTasks(res.data) });
      }
    } catch (err) {
      console.warn('[taskStore] fetchRecurringTemplates failed:', err);
    }
  },

  // After anything that changes a recurring task — creating one, switching a
  // task to recurring, editing its days — and when a new day may have begun,
  // so the list shows what represents each one today.
  refreshRecurring: async () => {
    await Promise.all([get().fetchTasks(true), get().fetchRecurringTemplates()]);
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
      // The hero baseline is keyed per user, so this is belt-and-braces — but the
      // in-memory copy would otherwise carry one account's overdue count into the
      // next sign-in on the same device.
      import('./heroCardStore').then(({ useHeroCardStore }) => useHeroCardStore.getState().clear(userId));
    }
  });
}
