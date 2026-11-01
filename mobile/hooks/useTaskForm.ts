import { useCallback, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Alert } from 'react-native';
import type { Task } from '../types';
import { useTaskStore } from '../stores/taskStore';
import { useGoalStore } from '../stores/goalStore';
import { useSettings } from '../store/hooks';
import { formDate, type FormSaveData, type TaskFormPrefill } from '../lib/taskForm';
import type TaskFormModal from '../components/TaskFormModal';

/** What changed, so a screen can follow the task (the calendar re-anchors on it). */
export interface TaskFormChange {
  kind: 'created' | 'updated' | 'deleted';
  taskId: string | null;
  /** The task's day after the change, 'YYYY-MM-DD', or null if it has none. */
  dueDate: string | null;
}

type FormProps = ComponentProps<typeof TaskFormModal>;

interface OpenState {
  task: Task | null;
  prefill?: TaskFormPrefill;
  note?: string;
}

/**
 * The one way to open the task form.
 *
 * Owns which task is being edited, the save path (create with a retry prompt,
 * edit, and the recurring refresh an edit can need) and delete, and reads the
 * stores the form needs itself. Today and the calendar both render
 * `<TaskFormModal {...form.props} />`, so a task saves the same way from either.
 */
export function useTaskForm(options?: { onChanged?: (change: TaskFormChange) => void }) {
  const tasks = useTaskStore((s) => s.tasks);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const refreshRecurring = useTaskStore((s) => s.refreshRecurring);
  const goals = useGoalStore((s) => s.goals);
  const settings = useSettings();
  const sessionLengthMinutes = Math.round(settings.workDuration / 60);

  const [open, setOpen] = useState<OpenState | null>(null);

  // Read through a ref so a screen can pass an inline callback without
  // rebuilding every handler below on each render.
  const onChangedRef = useRef(options?.onChanged);
  onChangedRef.current = options?.onChanged;

  const existingTags = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) t.tags.forEach((tag) => s.add(tag));
    return Array.from(s);
  }, [tasks]);

  const openCreate = useCallback((prefill?: TaskFormPrefill, note?: string) => {
    setOpen({ task: null, prefill, note });
  }, []);
  const openEdit = useCallback((task: Task, prefill?: TaskFormPrefill, note?: string) => {
    setOpen({ task, prefill, note });
  }, []);
  const close = useCallback(() => setOpen(null), []);

  // A failed create is said out loud, with the same task one tap from a retry.
  const createWithRetry = useCallback(async function attempt(data: FormSaveData): Promise<void> {
    const { task, error } = await createTask(data);
    if (!error) {
      onChangedRef.current?.({
        kind: 'created', taskId: task?.id ?? null, dueDate: data.dueDate ?? null,
      });
      return;
    }
    Alert.alert('Task not saved', error, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Try again', onPress: () => { void attempt(data); } },
    ]);
  }, [createTask]);

  const save = useCallback(async (data: FormSaveData) => {
    const editing = open?.task ?? null;
    setOpen(null);
    // Any edit that touches a recurring task can change what represents it
    // today: its day row, its entry in the recurring list, or neither.
    const touchesRecurring = !!editing && (!!data.isRecurring || editing.isRecurring);
    if (editing) {
      // A recurring task's day row carries the task's own id, so the edit goes
      // to the task itself, schedule and all.
      await updateTask(editing.id, data);
      onChangedRef.current?.({
        kind: 'updated',
        taskId: editing.id,
        dueDate: 'dueDate' in data ? data.dueDate ?? null : formDate(editing),
      });
    } else {
      await createWithRetry(data);
    }
    if (touchesRecurring) await refreshRecurring();
  }, [open, updateTask, createWithRetry, refreshRecurring]);

  const remove = useCallback((task: Task) => {
    // A recurring task's day row is the task itself: delete means the task.
    const [title, message] = task.isRecurring
      ? ['Delete recurring task?', "This stops the task repeating and removes it from your list. Focus time you've already logged on it is kept. This can't be undone."]
      : ['Delete task?', "This removes the task from your list. Focus time you've already logged on it is kept. This can't be undone."];
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          // Focus time is kept either way, so there are no totals to refresh.
          await deleteTask(task.id);
          setOpen(null);
          onChangedRef.current?.({ kind: 'deleted', taskId: task.id, dueDate: null });
        },
      },
    ]);
  }, [deleteTask]);

  const editing = open?.task ?? null;
  const props: FormProps = {
    visible: open !== null,
    task: editing,
    prefill: open?.prefill,
    note: open?.note,
    existingTags,
    sessionLengthMinutes,
    goals,
    onSave: save,
    onClose: close,
    onDelete: editing ? () => remove(editing) : undefined,
  };

  return { props, openCreate, openEdit, close };
}
