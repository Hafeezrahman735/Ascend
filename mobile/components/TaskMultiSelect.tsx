import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import type { Task, TaskGoal } from '../types';

/**
 * Pick the tasks that belong to a goal.
 *
 * The mirror of the task form's single-goal picker: there you say which goal one
 * task belongs to, here you say which tasks belong to one goal. Both write the
 * same `Task.taskGoalId` column, which holds exactly ONE goal — so checking a
 * task here MOVES it off whatever goal it was on.
 *
 * That move is the reason for `movedFrom`. Without it the other goal's progress
 * quietly drops and nothing on screen explains why, which reads as the app
 * losing your work. The label is derived locally from goals already in the
 * store, so it costs no request and no extra field on the wire.
 *
 * Completed tasks are shown, not filtered out. They are what a goal's
 * "3 of 6" is made of, and a picker that hid them would invite the user to save
 * a set that silently drops them.
 */
export default function TaskMultiSelect({
  tasks,
  goals,
  goalId,
  selectedIds,
  onToggle,
}: {
  /** Candidates to choose from. Archived rows must already be excluded. */
  tasks: Task[];
  /** Every goal, for naming the one a task would move away from. */
  goals: TaskGoal[];
  /** The goal being edited, or null while creating. */
  goalId: string | null;
  selectedIds: string[];
  onToggle: (taskId: string) => void;
}) {
  const Colors = useTheme();
  const goalTitles = useMemo(
    () => new Map(goals.map((g) => [g.id, g.title])),
    [goals],
  );

  if (tasks.length === 0) {
    return (
      <Text style={{ color: Colors.subtext, fontSize: 13, paddingVertical: 12 }}>
        No tasks yet. Create a task first, then link it here.
      </Text>
    );
  }

  const selected = new Set(selectedIds);

  return (
    <ScrollView
      style={{ maxHeight: 240 }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {tasks.map((task) => {
        const isSelected = selected.has(task.id);
        // Only worth saying when checking this box would actually take the task
        // away from a different goal.
        const movedFrom =
          isSelected && task.taskGoalId && task.taskGoalId !== goalId
            ? goalTitles.get(task.taskGoalId)
            : null;

        return (
          <TouchableOpacity
            key={task.id}
            onPress={() => onToggle(task.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={
              `${task.title}${task.isCompleted ? ', completed' : ''}` +
              (movedFrom ? `, moves from ${movedFrom}` : '')
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 11,
              borderBottomWidth: 0.5,
              borderBottomColor: Colors.border,
            }}
          >
            <Ionicons
              name={isSelected ? 'checkbox' : 'square-outline'}
              size={20}
              color={isSelected ? Colors.primary : Colors.subtext}
              style={{ marginRight: 12 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: task.isCompleted ? Colors.subtext : Colors.textBright,
                  fontSize: 14,
                  fontWeight: '600',
                  textDecorationLine: task.isCompleted ? 'line-through' : 'none',
                }}
              >
                {task.title}
              </Text>
              {movedFrom && (
                <Text style={{ color: Colors.warning, fontSize: 11, marginTop: 1 }}>
                  Moves from {movedFrom}
                </Text>
              )}
            </View>
            {task.isCompleted && (
              <Ionicons name="checkmark-circle" size={15} color={Colors.trace} />
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
