import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { formatDeadlineLabel } from '../../utils/date';
import { groupGoals, paceShares, paceCopy, shiftKey } from '../../lib/timeAnalytics';
import { useGoalStore } from '../../stores/goalStore';
import type { TaskGoal } from '../../types';
import { PaceBar } from './charts';
import GoalClimbChart from './GoalClimbChart';
import { SectionTitle, Notice, Rule } from './parts';
import type { SessionsTarget } from './SessionsSheet';

/**
 * Goals: planned time against time spent, with the even-schedule tick.
 *
 * Every figure is the server's: `totalFocusSeconds` follows each task's
 * CURRENT goal (lib/goalAttribution.ts), and `timePace` is computed in the
 * device's zone. Nothing here re-derives either. Planned time never changes
 * whether a goal is complete; that stays task-based.
 *
 * Tap a goal to open its climb (GoalClimbChart): focus over time against the
 * even-pace line, from /time-report/goals/:id/daily.
 */

/** The session list reaches back as far as the server allows (730 days). */
const DRILL_DAYS = 730;

export default function GoalsLens({ today, onEditGoal, onDrill }: {
  today: string;
  /** Opens the goal form, where planned time is set. */
  onEditGoal: (goal: TaskGoal) => void;
  onDrill: (target: SessionsTarget) => void;
}) {
  const Colors = useTheme();
  const goals = useGoalStore((s) => s.goals);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);
  // Local, because a silent fetch never touches the store's isLoading.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await fetchGoals(true); setRefreshing(false); };
  const [showCompleted, setShowCompleted] = useState(false);
  // One goal open at a time: each open chart is a request, and a column of
  // charts is harder to read than the one you asked about.
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const { planned, unplanned, completed } = groupGoals(goals);

  const drill = (g: TaskGoal) => onDrill({
    by: 'goal', key: g.id, from: shiftKey(today, -(DRILL_DAYS - 1)), to: today,
    title: g.title, subtitle: 'Sessions in the last two years',
  });

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingBottom: Space.page }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
    >
      {planned.length + unplanned.length + completed.length === 0 && (
        <Notice
          title="No goals yet."
          body="A goal groups the tasks that serve one outcome. Give it a planned amount of focus time and this screen shows whether you are on pace."
        />
      )}

      {planned.length > 0 && <SectionTitle note="planned · done · pace">On a plan</SectionTitle>}
      {planned.map((g, i) => (
        <View key={g.id}>
          {i > 0 && <Rule />}
          <PlannedGoalRow goal={g} open={openId === g.id} onToggle={() => toggle(g.id)} onEdit={() => onEditGoal(g)} />
          {openId === g.id && <GoalDetail goal={g} today={today} onDrill={() => drill(g)} />}
        </View>
      ))}

      {unplanned.length > 0 && <SectionTitle note="focus so far">No planned time</SectionTitle>}
      {unplanned.map((g, i) => (
        <View key={g.id}>
          {i > 0 && <Rule />}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: Space.md, gap: Space.md }}>
            <AppPressable onPress={() => toggle(g.id)} scaleOnPress={false} style={{ flex: 1 }} accessibilityRole="button"
              accessibilityState={{ expanded: openId === g.id }}
              accessibilityLabel={`${g.title}, ${formatSeconds(g.totalFocusSeconds)} focused. ${openId === g.id ? 'Hide' : 'Show'} its climb.`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>{g.title}</Text>
                <Ionicons name={openId === g.id ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.text} />
              </View>
              <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono, marginTop: 2 }}>
                {formatSeconds(g.totalFocusSeconds)} focused
              </Text>
            </AppPressable>
            <AppPressable
              onPress={() => onEditGoal(g)}
              accessibilityRole="button"
              accessibilityLabel={`Set a plan for ${g.title}`}
              style={{
                paddingHorizontal: Space.md, minHeight: 36, justifyContent: 'center',
                borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.primary,
              }}
            >
              <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '700' }}>Set a plan</Text>
            </AppPressable>
          </View>
          {openId === g.id && <GoalDetail goal={g} today={today} onDrill={() => drill(g)} />}
        </View>
      ))}

      {completed.length > 0 && (
        <>
          <AppPressable
            onPress={() => setShowCompleted((v) => !v)}
            scaleOnPress={false}
            accessibilityRole="button"
            accessibilityState={{ expanded: showCompleted }}
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: Space.section, minHeight: 44 }}
          >
            <Text style={{
              flex: 1, color: Colors.textBright, fontSize: 13, fontWeight: '700',
              letterSpacing: 1.1, textTransform: 'uppercase', fontFamily: Font.mono,
            }}>
              Completed · {completed.length}
            </Text>
            <Ionicons name={showCompleted ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.text} />
          </AppPressable>
          {showCompleted && completed.map((g, i) => (
            <View key={g.id}>
              {i > 0 && <Rule />}
              <AppPressable onPress={() => drill(g)} scaleOnPress={false} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: Space.md, gap: Space.md }}>
                <Text numberOfLines={1} style={{ flex: 1, color: Colors.textBright, fontSize: 14 }}>{g.title}</Text>
                <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
                  {formatSeconds(g.totalFocusSeconds)}
                  {g.plannedMinutes !== null ? ` / ${formatSeconds(g.plannedMinutes * 60)}` : ''}
                </Text>
              </AppPressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

/** The open state of a goal: its climb, and the way into its sessions. */
function GoalDetail({ goal, today, onDrill }: { goal: TaskGoal; today: string; onDrill: () => void }) {
  const Colors = useTheme();
  return (
    <View style={{ paddingBottom: Space.md }}>
      <GoalClimbChart goal={goal} today={today} />
      <AppPressable onPress={onDrill} accessibilityRole="button" scaleOnPress={false}
        style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Sessions ›</Text>
      </AppPressable>
    </View>
  );
}

function PlannedGoalRow({ goal, open, onToggle, onEdit }: {
  goal: TaskGoal;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const Colors = useTheme();
  const planned = goal.plannedMinutes! * 60;
  const shares = paceShares(goal.totalFocusSeconds, goal.plannedMinutes!, goal.timePace.expectedSeconds);
  const copy = paceCopy(goal.timePace, formatSeconds);
  const due = formatDeadlineLabel(goal.deadline);

  return (
    <View style={{ paddingVertical: Space.md }}>
      <AppPressable onPress={onToggle} scaleOnPress={false} accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${goal.title}: ${formatSeconds(goal.totalFocusSeconds)} of ${formatSeconds(planned)} planned. ${copy.text}. ${open ? 'Hide' : 'Show'} its climb.`}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
          <Text numberOfLines={1} style={{ flex: 1, color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>{goal.title}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.text} />
          <Text style={{ color: Colors.textBright, fontSize: 13, fontFamily: Font.mono, fontVariant: ['tabular-nums'] }}>
            {formatSeconds(goal.totalFocusSeconds)}
            <Text style={{ color: Colors.text }}> / {formatSeconds(planned)}</Text>
          </Text>
        </View>
        <PaceBar done={shares.done} expected={shares.expected} tone={copy.tone} />
      </AppPressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Space.xs, gap: Space.md }}>
        <Text style={{ flex: 1, color: copy.tone === 'warning' ? Colors.warning : Colors.text, fontSize: 12 }}>
          {copy.text}{due ? ` · ${due}` : ''}
        </Text>
        <AppPressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit plan for ${goal.title}`}
          hitSlop={8} style={{ minHeight: 32, justifyContent: 'center' }}>
          <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '600' }}>Edit plan</Text>
        </AppPressable>
      </View>
    </View>
  );
}
