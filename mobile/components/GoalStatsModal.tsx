import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useGoalStore } from '../stores/goalStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { BottomSheet, StatBox, SCREEN_H, MONO } from './SheetPrimitives';
import {
  goalStatusLine, goalStatCells, formatSeconds, daysUntil,
  type GoalStatusAction,
} from '../lib/goalStats';

/**
 * What a goal has cost you so far, and the one sentence worth saying about it.
 *
 * Two deliberate departures from `TaskStatsModal`, which is otherwise the
 * template:
 *
 * 1. **It takes a goalId and reads the goal live from the store**, rather than
 *    holding the object it was opened with. A goal changes while this is open —
 *    ticking off a task from underneath, a background `fetchGoals`, a delete
 *    from another surface — and a frozen snapshot would show numbers that are
 *    already wrong, or render a ghost of a deleted goal. If somebody "fixes"
 *    this back to a snapshot prop for symmetry, that is the bug they are adding.
 *
 * 2. **There is no loading or error state, because there is no fetch.** Every
 *    number here already arrived with `GET /task-goals`. `TaskStatsModal` needs
 *    its spinner because it fetches per-task analytics; copying that machinery
 *    would be building a state that cannot occur.
 *
 * The hierarchy is not the task modal's either. A task's first question is "how
 * much have I done"; a goal's is "am I going to finish". So the status line
 * leads, and the hero numeral is TOTAL FOCUS TIME rather than a percentage —
 * focus time is monotonic. It can never go down whatever the user does, which
 * is exactly what makes it safe to lead with. `taskProgress` is
 * `completedTaskCount / linkedTaskCount`, so linking a new task to a goal makes
 * the percentage DROP: the app would be punishing the user for planning.
 */
export default function GoalStatsModal({
  goalId,
  lastSessionAt,
  onClose,
  onAction,
  onEdit,
}: {
  /** null when closed. */
  goalId: string | null;
  /** Newest session on this goal's tasks, epoch ms, or null if unknown. */
  lastSessionAt: number | null;
  onClose: () => void;
  onAction: (action: GoalStatusAction, goalId: string) => void;
  onEdit: (goalId: string) => void;
}) {
  const Colors = useTheme();
  const goal = useGoalStore((s) => s.goals.find((g) => g.id === goalId) ?? null);
  const totalFocusMinutes = useGamificationStore((s) => s.totalFocusMinutes);

  // `now` is read once per open rather than memoised on the goal: whether a
  // deadline has passed changes with the clock, not with the data.
  const ctx = useMemo(
    () => ({ now: new Date(), totalFocusMinutes, lastSessionAt }),
    [totalFocusMinutes, lastSessionAt],
  );

  // Closed, or the goal was deleted while open. Render nothing rather than
  // reaching into `undefined` for a title.
  if (!goalId || !goal) return null;

  const status = goalStatusLine(goal, ctx);
  const cells = goalStatCells(goal, ctx);
  const pct = Math.round(goal.overallProgress * 100);
  const daysLeft = daysUntil(goal.deadline, ctx.now);
  const overdue = daysLeft !== null && daysLeft < 0 && !goal.isCompleted;
  const barColor = goal.isCompleted || pct >= 100 ? Colors.accent : Colors.primary;

  const actionLabel: Record<GoalStatusAction, string> = {
    'link-task': 'Link a task',
    'change-deadline': 'Change deadline',
    'start-session': 'Start a session',
  };

  return (
    <BottomSheet visible onClose={onClose} sheetHeight={SCREEN_H * 0.75}>
      {/* header */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text numberOfLines={2} style={{ flex: 1, marginRight: 12, color: Colors.textBright, fontSize: 19, fontWeight: '700', lineHeight: 24, letterSpacing: -0.3 }}>
            {goal.title}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.raised, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color={Colors.subtext} />
          </TouchableOpacity>
        </View>

        {/* The status line sits ABOVE the bar on purpose: it is the only element
            that can reframe a bad number before the reader gets to it. */}
        <View style={{
          backgroundColor: overdue ? Colors.ROSE_DIM : Colors.raised,
          borderRadius: 12, padding: 13,
          borderWidth: 1, borderColor: overdue ? Colors.ROSE + '40' : Colors.border,
        }}>
          <Text style={{ color: Colors.textBright, fontSize: 13.5, lineHeight: 19 }}>
            {status.text}
          </Text>
          {status.action && (
            <TouchableOpacity
              onPress={() => onAction(status.action!, goal.id)}
              accessibilityRole="button"
              style={{ marginTop: 9, alignSelf: 'flex-start' }}
            >
              <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '700' }}>
                {actionLabel[status.action]} →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {/* progress */}
        <View style={{ marginBottom: 18 }}>
          <View style={{ height: 7, backgroundColor: Colors.inactive, borderRadius: 4, overflow: 'hidden', marginBottom: 9 }}>
            <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 4, backgroundColor: barColor }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[25, 50, 75, 100].map((m) => (
              <View key={m} style={{ alignItems: 'center', gap: 3 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pct >= m ? Colors.accent : Colors.inactive }} />
                <Text style={{ color: Colors.subtext, fontSize: 9 }}>{m}%</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Hero: total focus. Monotonic, so it is the one number that is always
            safe to put in the largest type on the screen. */}
        <View style={{
          backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary,
          borderRadius: 16, padding: 18, marginBottom: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Ionicons name="time-outline" size={14} color={Colors.primarySoft} />
            <Text style={{ fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Colors.primarySoft, fontFamily: MONO }}>
              TOTAL FOCUS
            </Text>
          </View>
          <Text style={{ color: Colors.textBright, fontWeight: '700', fontSize: 36, letterSpacing: -1.2 }}>
            {formatSeconds(goal.totalFocusSeconds)}
          </Text>
          {/* The F1 caption. The server counts sessions on archived tasks but
              not archived tasks themselves, so for a goal linked to a recurring
              habit this number and the task count come from different universes.
              Saying so is cheaper and more honest than silently disagreeing. */}
          <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: 4 }}>
            all time, every instance
          </Text>
        </View>

        {/* supporting cells, gated by progressMode */}
        {cells.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 8 }}>
            {cells.map((cell) => (
              <StatBox
                key={cell.key}
                bg={Colors.raised}
                border={Colors.border}
                icon={
                  cell.key === 'tasks' ? 'checkmark-done-outline'
                    : cell.key === 'sessions' ? 'timer-outline'
                      : cell.key === 'avgSession' ? 'pulse-outline'
                        : 'flame-outline'
                }
                iconColor={Colors.subtext}
                label={cell.label}
                labelColor={Colors.subtext}
                value={cell.value}
                sub={cell.sub}
                Colors={Colors}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* footer */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }}>
        {!goal.isCompleted && (
          <TouchableOpacity
            onPress={() => onAction('start-session', goal.id)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15 }}
          >
            <Ionicons name="play" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Start a session</Text>
          </TouchableOpacity>
        )}
        {/* Edit lives here, matching TaskStatsModal. This is the only path to
            editing or deleting a goal now that the card's tap opens stats —
            long-press was not available as a second hatch, it already belongs
            to the tag handler on the same card. */}
        <TouchableOpacity
          onPress={() => onEdit(goal.id)}
          accessibilityRole="button"
          style={{ alignItems: 'center', marginTop: goal.isCompleted ? 0 : 12 }}
        >
          <Text style={{ color: Colors.subtext, fontSize: 12.5, fontWeight: '500' }}>Edit goal details</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}
