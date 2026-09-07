import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { useGoalStore } from '../stores/goalStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { BottomSheet, BentoCell, BentoRingCell, SCREEN_H } from './SheetPrimitives';
import AppPressable from './AppPressable';
import { Space, Radius } from '../constants/spacing';
import {
  goalStatusLine, goalStatCells, formatSeconds, daysUntil,
  type GoalStatusAction,
} from '../lib/goalStats';

/** Which Ionicon belongs to each cell `goalStatCells` can emit. */
const CELL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkmark-done-outline',
  sessions: 'timer-outline',
  avgSession: 'pulse-outline',
  shareOfLife: 'flame-outline',
};

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
          <AppPressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            style={{ width: 30, height: 30, borderRadius: Radius.sm, backgroundColor: Colors.raised, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color={Colors.text} />
          </AppPressable>
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
            <AppPressable
              onPress={() => onAction(status.action!, goal.id)}
              accessibilityRole="button"
              scaleOnPress={false}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              style={{ marginTop: Space.sm, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}
            >
              <Text style={{ color: Colors.primarySoft, fontSize: 13, fontWeight: '700' }}>
                {actionLabel[status.action]} →
              </Text>
            </AppPressable>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {/* Stat bento. The progress bar and its 25/50/75/100 dot row are gone:
            the ring says the same thing once instead of twice.

            TOTAL FOCUS stays a feature cell rather than becoming the ring's
            centre, which is deliberate and load-bearing -- see the note at the
            top of this file. `taskProgress` DROPS when a new task is linked, so
            the ring can go backwards through no fault of the user. Focus time
            is monotonic, so it is the number that is always safe to make
            prominent. Do not swap them for symmetry with TaskStatsModal. */}
        <View style={{ gap: Space.sm, marginBottom: Space.sm }}>
          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            <BentoRingCell
              style={{ flex: 1.15 }}
              fraction={goal.overallProgress}
              centerLabel={`${pct}%`}
              caption="Complete"
              sub={goal.progressMode === 'sessions' ? 'by sessions'
                : goal.progressMode === 'both' ? 'tasks + sessions' : 'by tasks'}
              tint={barColor}
              Colors={Colors}
            />
            <View style={{ flex: 1, gap: Space.sm }}>
              <BentoCell
                style={{ flex: 1 }} Colors={Colors} feature
                icon="time-outline" label="Total focus"
                value={formatSeconds(goal.totalFocusSeconds)}
                sub="all time, every instance"
              />
              {cells.length > 0 && (
                <BentoCell
                  style={{ flex: 1 }} Colors={Colors}
                  icon={CELL_ICONS[cells[0].key]}
                  label={cells[0].label}
                  value={cells[0].value}
                  sub={cells[0].sub}
                />
              )}
            </View>
          </View>

          {cells.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
              {cells.slice(1).map((cell) => (
                <BentoCell
                  key={cell.key}
                  style={{ flexGrow: 1, flexBasis: '47%' }}
                  Colors={Colors}
                  icon={CELL_ICONS[cell.key]}
                  label={cell.label}
                  value={cell.value}
                  sub={cell.sub}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* footer */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }}>
        {!goal.isCompleted && (
          <AppPressable
            onPress={() => onAction('start-session', goal.id)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 15 }}
          >
            <Ionicons name="play" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Start a session</Text>
          </AppPressable>
        )}
        {/* Edit lives here, matching TaskStatsModal. This is the only path to
            editing or deleting a goal now that the card's tap opens stats —
            long-press was not available as a second hatch, it already belongs
            to the tag handler on the same card. */}
        <AppPressable
          onPress={() => onEdit(goal.id)}
          accessibilityRole="button"
          scaleOnPress={false}
          style={{ alignItems: 'center', justifyContent: 'center', marginTop: goal.isCompleted ? 0 : Space.sm, minHeight: 44 }}
        >
          <Text style={{ color: Colors.text, fontSize: 13, fontWeight: '600' }}>Edit goal details</Text>
        </AppPressable>
      </View>
    </BottomSheet>
  );
}
