import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import type { Task, TaskGoal } from '../types';

/**
 * Choosing the tasks a goal is made of.
 *
 * Two pieces, deliberately split. `TaskPicker` is the menu you open to ADD, and
 * `SelectedTaskList` is the running checklist of what you have picked. A single
 * always-open list of every task, with the chosen ones checked somewhere inside
 * it, made the answer to "what is on this goal" something you had to go hunting
 * for among fifty rows.
 *
 * The menu shows only tasks NOT yet on the goal, so nothing appears twice and
 * the menu shrinks as you work — the list of things left to add is the thing
 * that should be getting shorter.
 *
 * Both write the same `Task.taskGoalId` column, which holds exactly ONE goal,
 * so adding a task MOVES it off whatever goal it was on. That is what
 * `movedFrom` exists to say out loud: without it the other goal's progress
 * quietly drops and nothing explains why. It is derived from goals already in
 * the store, so it costs no request and no extra field on the wire.
 */

/** Height cap so the menu cannot itself overflow the modal it lives in. */
const MENU_MAX_HEIGHT = 220;

export default function TaskPicker({
  tasks,
  goals,
  goalId,
  onPick,
}: {
  /** Only tasks NOT already on this goal. Archived rows excluded upstream. */
  tasks: Task[];
  /** Every goal, for naming the one a task would move away from. */
  goals: TaskGoal[];
  /** The goal being edited, or null while creating. */
  goalId: string | null;
  onPick: (taskId: string) => void;
}) {
  const Colors = useTheme();
  const goalTitles = useMemo(() => new Map(goals.map((g) => [g.id, g.title])), [goals]);

  if (tasks.length === 0) {
    return (
      <Text style={{ color: Colors.subtext, fontSize: 13, paddingVertical: 14, paddingHorizontal: 12 }}>
        Nothing left to add. Every task is already on this goal.
      </Text>
    );
  }

  return (
    <ScrollView
      style={{ maxHeight: MENU_MAX_HEIGHT }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {tasks.map((task) => {
        const movedFrom =
          task.taskGoalId && task.taskGoalId !== goalId
            ? goalTitles.get(task.taskGoalId)
            : null;

        return (
          <TouchableOpacity
            key={task.id}
            onPress={() => onPick(task.id)}
            accessibilityRole="button"
            accessibilityLabel={
              `Add ${task.title}${task.isCompleted ? ', completed' : ''}` +
              (movedFrom ? `, moves from ${movedFrom}` : '')
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 11,
              paddingHorizontal: 12,
              borderBottomWidth: 0.5,
              borderBottomColor: Colors.border,
            }}
          >
            <Ionicons name="add-circle-outline" size={19} color={Colors.primarySoft} style={{ marginRight: 11 }} />
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
            {task.isCompleted && <Ionicons name="checkmark-circle" size={15} color={Colors.accent} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/**
 * What is on the goal, in the order it was added.
 *
 * Rendered below the picker rather than inside it: this is the answer to "what
 * did I just build", and it should be readable without opening anything. New
 * picks land at the bottom, so the list reads as a record of what you did.
 *
 * Completed tasks are shown, never filtered. They are what a goal's "3 of 6" is
 * made of, and hiding them would invite saving a set that silently drops them.
 */
export function SelectedTaskList({
  tasks,
  onRemove,
}: {
  tasks: Task[];
  onRemove: (taskId: string) => void;
}) {
  const Colors = useTheme();

  if (tasks.length === 0) {
    return (
      <Text style={{ color: Colors.subtext, fontSize: 12.5, paddingVertical: 10 }}>
        No tasks on this goal yet. A goal with no tasks cannot show progress.
      </Text>
    );
  }

  return (
    <View>
      {tasks.map((task) => (
        <View
          key={task.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            borderBottomWidth: 0.5,
            borderBottomColor: Colors.border,
          }}
        >
          <Ionicons
            name={task.isCompleted ? 'checkbox' : 'square-outline'}
            size={19}
            color={task.isCompleted ? Colors.accent : Colors.subtext}
            style={{ marginRight: 11 }}
          />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: task.isCompleted ? Colors.subtext : Colors.textBright,
              fontSize: 14,
              fontWeight: '600',
              textDecorationLine: task.isCompleted ? 'line-through' : 'none',
            }}
          >
            {task.title}
          </Text>
          <TouchableOpacity
            onPress={() => onRemove(task.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${task.title} from this goal`}
          >
            <Ionicons name="close-circle" size={19} color={Colors.subtext} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
