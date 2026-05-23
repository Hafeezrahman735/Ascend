import { Task } from '../../types';
import { useTaskStore } from '../../stores/taskStore';
import { useShallow } from 'zustand/react/shallow';
import { calcSelectedTask, calcTaskProgressFraction, calcDaysWorked, calcDaysUntilDue } from '../selectors/tasks';

export function useTasksList() {
  return useTaskStore((s) => s.tasks);
}

export function useSelectedTaskId() {
  return useTaskStore((s) => s.selectedTaskId);
}

export function useSelectedTask() {
  return useTaskStore((s) => calcSelectedTask(s.tasks, s.selectedTaskId));
}

export function useTaskActions() {
  return useTaskStore(
    useShallow((s) => ({
      fetchTasks: s.fetchTasks,
      createTask: s.createTask,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      selectTask: s.selectTask,
      incrementTaskSession: s.incrementTaskSession,
      toggleComplete: s.toggleComplete,
    })),
  );
}

export function useTaskProgressFraction() {
  return useTaskStore((s) => {
    const task = calcSelectedTask(s.tasks, s.selectedTaskId);
    return calcTaskProgressFraction(task);
  });
}

export function useTaskDaysWorked(task: Task | null) {
  return task ? calcDaysWorked(task) : null;
}

export function useTaskDaysUntilDue(task: Task | null) {
  return task ? calcDaysUntilDue(task) : null;
}

export function useTasksLoading() {
  return useTaskStore((s) => s.isLoading);
}
