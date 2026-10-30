/**
 * The goal form with its data and save/delete behaviour, in one place.
 *
 * Today mounts it in three views and the Time tab in one; each placement is
 * `<GoalEditor goal visible onClose />`. It reads tasks and goals from the
 * stores itself, so the list the picker shows and the list the link deltas are
 * computed from are always the same one.
 */
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { TaskGoal } from '../../types';
import { useTasksList, useTaskActions } from '../../store/hooks';
import { useGoalStore } from '../../stores/goalStore';
import { useTaskStore } from '../../stores/taskStore';
import { goalLinkDeltas } from '../../lib/goalLinkDeltas';
import GoalFormModal, { type GoalSaveData } from './GoalFormModal';

export default function GoalEditor({ goal, visible, onClose }: {
  /** The goal to edit, or null to create one. */
  goal: TaskGoal | null;
  visible: boolean;
  onClose: () => void;
}) {
  // Kept mounted while closed so the sheet can animate out; the derived lists
  // below are memoised on the task list, so a closed editor costs nothing per render.
  const tasks = useTasksList();
  const taskActions = useTaskActions();
  const goals = useGoalStore((s) => s.goals);
  const goalActions = useGoalStore(
    useShallow((s) => ({
      createGoal: s.createGoal,
      updateGoal: s.updateGoal,
      linkTasks: s.linkTasks,
      deleteGoal: s.deleteGoal,
    })),
  );

  // Unarchived tasks, completed ones included — see TaskMultiSelect.
  const linkableTasks = useMemo(() => tasks.filter((t) => !t.isArchived), [tasks]);
  const existingTags = useMemo(() => {
    const tags = new Set<string>();
    for (const t of tasks) t.tags.forEach((tag) => tags.add(tag));
    return Array.from(tags);
  }, [tasks]);

  const handleSave = useCallback(async (data: GoalSaveData) => {
    onClose();
    const { taskIds, ...fields } = data;

    if (!goal) {
      // One request: the tasks go in WITH the create, so there is no window in
      // which a goal exists without the tasks the user just picked.
      await goalActions.createGoal({ ...fields, taskIds });
      return;
    }

    await goalActions.updateGoal(goal.id, fields);
    const linkedBefore = tasks.filter((t) => t.taskGoalId === goal.id).map((t) => t.id);
    const { link, unlink } = goalLinkDeltas(linkedBefore, taskIds);
    if (link.length > 0 || unlink.length > 0) {
      await goalActions.linkTasks(goal.id, { link, unlink });
      // Linking can move a task off another goal, so the task rows are stale.
      await taskActions.fetchTasks();
    }
  }, [goal, goalActions, taskActions, tasks, onClose]);

  const handleDelete = useCallback(() => {
    if (!goal) return;
    Alert.alert(
      'Delete goal?',
      `"${goal.title}" will be removed. Linked tasks are kept — they just won't belong to a goal any more.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            onClose();
            await goalActions.deleteGoal(goal.id);
            // The server clears taskGoalId on every linked task, so refetch to
            // drop the now-stale goal chips.
            await useTaskStore.getState().fetchTasks(true);
          },
        },
      ],
    );
  }, [goal, goalActions, onClose]);

  return (
    <GoalFormModal
      visible={visible}
      goal={goal}
      existingTags={existingTags}
      linkableTasks={linkableTasks}
      goals={goals}
      onSave={handleSave}
      onClose={onClose}
      onDelete={goal ? handleDelete : undefined}
    />
  );
}
