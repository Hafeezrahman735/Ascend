import { useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import {
  climbSeries, nextMilestone, weekRange, weekBars, weekLabel, groupGoals, paceShares, paceCopy,
  compactHours, monthYearLabel,
} from '../../lib/timeAnalytics';
import { useTimeReportRange, type TimeHistoryState } from '../../hooks/useTimeReport';
import { useTimerStore } from '../../stores/timerStore';
import { useGoalStore } from '../../stores/goalStore';
import type { TaskGoal, TimeHistory, TimeReport } from '../../types';
import ClimbChart from './ClimbChart';
import { WeekBars, PaceBar } from './charts';
import { SectionTitle, DeltaText, ShareBar, SkeletonBlocks, ErrorRetry, DrillRow, Rule } from './parts';
import type { SessionsTarget } from './SessionsSheet';

/**
 * Overview: the climb first, because it only ever goes up, then this week
 * against the daily target, then planned goals. Comparisons are context under
 * the headline, never the headline.
 */

const OVERVIEW_GOALS = 3;
const WEEK_GOAL_ROWS = 3;
/** Below this many active days the climb gets a word of encouragement under it. */
const LITTLE_HISTORY_DAYS = 3;

export default function OverviewLens({ history, today, onOpenGoals, onDrill }: {
  /** Lifted to the screen so every lens shares one history request. */
  history: TimeHistoryState;
  today: string;
  onOpenGoals: () => void;
  onDrill: (target: SessionsTarget) => void;
}) {
  const Colors = useTheme();
  const [weekOffset, setWeekOffset] = useState(0);
  const week = weekRange(today, weekOffset);
  const weekReport = useTimeReportRange(week.from, week.to);
  const goals = useGoalStore((s) => s.goals);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);

  const refresh = () => { history.reload(); weekReport.reload(); fetchGoals(true); };
  const refreshing = (history.loading && !!history.history) || (weekReport.loading && !!weekReport.report);

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingBottom: Space.page }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
    >
      {!history.history && history.loading && <SkeletonBlocks heights={[52, 170]} />}
      {!history.history && !history.loading && history.error && (
        <ErrorRetry title="Could not load your history" body={history.error} onRetry={history.reload} />
      )}
      {history.history && <Climb history={history.history} today={today} />}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Space.section, marginBottom: Space.md }}>
        <Text style={{
          flex: 1, color: Colors.textBright, fontSize: 13, fontWeight: '700',
          letterSpacing: 1.1, textTransform: 'uppercase', fontFamily: Font.mono,
        }}>
          {weekOffset === 0 ? 'This week' : weekLabel(week.from, week.to)}
        </Text>
        <WeekNav
          onPrev={() => setWeekOffset((w) => w - 1)}
          onNext={() => setWeekOffset((w) => Math.min(0, w + 1))}
          canNext={weekOffset < 0}
        />
      </View>
      {!weekReport.report && weekReport.loading && <SkeletonBlocks heights={[36, 110]} />}
      {!weekReport.report && !weekReport.loading && weekReport.error && (
        <ErrorRetry title="Could not load this week" body={weekReport.error} onRetry={weekReport.reload} />
      )}
      {weekReport.report && (
        <Week report={weekReport.report} from={week.from} to={week.to} today={today} onDrill={onDrill} />
      )}

      <SectionTitle>Planned vs done</SectionTitle>
      <PlannedGoals goals={goals} onOpenGoals={onOpenGoals} />
    </ScrollView>
  );
}

function Climb({ history, today }: { history: TimeHistory; today: string }) {
  const Colors = useTheme();
  const points = useMemo(() => climbSeries(history.daily, today), [history.daily, today]);
  const { allTime } = history;

  if (allTime.sessions === 0) {
    return (
      <View style={{ paddingVertical: Space.xl }}>
        <Text style={{ color: Colors.textBright, fontSize: 22, fontFamily: Font.editorialBold }}>
          Your climb starts with one session.
        </Text>
        <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 20, marginTop: Space.sm }}>
          Every minute you focus adds to a line that only goes up. Run a session from the Focus tab and it
          starts here.
        </Text>
      </View>
    );
  }

  const milestone = nextMilestone(allTime.seconds);
  return (
    <View style={{ paddingTop: Space.md }}>
      <Text style={{ color: Colors.textBright, fontSize: 44, lineHeight: 50, fontFamily: Font.editorialBold }}>
        {compactHours(allTime.seconds)}
      </Text>
      <Text style={{ color: Colors.text, fontSize: 14, marginTop: 2 }}>
        focused since {allTime.firstDate ? monthYearLabel(allTime.firstDate) : 'you started'} ·{' '}
        {allTime.sessions} session{allTime.sessions === 1 ? '' : 's'} on {allTime.activeDays} day
        {allTime.activeDays === 1 ? '' : 's'}
      </Text>
      <View style={{ marginTop: Space.lg }}>
        <ClimbChart points={points} milestoneSeconds={milestone.hours * 3600} />
      </View>
      <Text style={{ color: Colors.textBright, fontSize: 14, marginTop: Space.md }}>
        <Text style={{ fontFamily: Font.mono, fontWeight: '700' }}>{formatSeconds(milestone.remainingSeconds)}</Text>
        {' '}to your next {milestone.hours}h.
      </Text>
      {allTime.activeDays < LITTLE_HISTORY_DAYS && (
        <Text style={{ color: Colors.text, fontSize: 12.5, lineHeight: 18, marginTop: Space.xs }}>
          A few more days and this line becomes your history. Patterns show up on the Activity tab once
          there is a week or two to read.
        </Text>
      )}
    </View>
  );
}

function Week({ report, from, to, today, onDrill }: {
  report: TimeReport;
  from: string;
  to: string;
  today: string;
  onDrill: (target: SessionsTarget) => void;
}) {
  const Colors = useTheme();
  const targetSeconds = useTimerStore((s) => s.settings.dailyFocusMinutes) * 60;
  const bars = weekBars(report.series.daily, from, today);
  const daysMet = targetSeconds > 0 ? bars.filter((b) => b.seconds >= targetSeconds).length : 0;
  const topGoals = [...report.goals]
    .filter((g) => g.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, WEEK_GOAL_ROWS);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
        <Text style={{ color: Colors.textBright, fontSize: 28, fontFamily: Font.display }}>
          {formatSeconds(report.totals.seconds)}
        </Text>
        <DeltaText current={report.totals.seconds} previous={report.previous.seconds} />
      </View>
      <Text style={{ color: Colors.text, fontSize: 12, marginBottom: Space.md }}>
        {targetSeconds > 0
          ? `daily target ${formatSeconds(targetSeconds)} · met on ${daysMet} day${daysMet === 1 ? '' : 's'}`
          : `${report.totals.sessions} sessions`}
      </Text>
      <WeekBars bars={bars} targetSeconds={targetSeconds} />

      {/* Where the week went: one share, then the goals that took it. */}
      {report.intent.goalLinkedShare !== null && (
        <View style={{ marginTop: Space.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ color: Colors.text, fontSize: 13 }}>Linked to a goal</Text>
            <Text style={{ color: Colors.textBright, fontSize: 13, fontFamily: Font.mono, fontWeight: '700' }}>
              {Math.round(report.intent.goalLinkedShare * 100)}%
            </Text>
          </View>
          <ShareBar share={report.intent.goalLinkedShare} color={Colors.accent} height={6} />
          <View style={{ marginTop: Space.sm }}>
            {topGoals.map((g, i) => (
              <View key={g.goalId}>
                {i > 0 && <Rule />}
                <DrillRow
                  title={g.title}
                  seconds={g.seconds}
                  onPress={() => onDrill({
                    by: 'goal', key: g.goalId, from, to, title: g.title, subtitle: weekLabel(from, to),
                  })}
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function PlannedGoals({ goals, onOpenGoals }: { goals: TaskGoal[]; onOpenGoals: () => void }) {
  const Colors = useTheme();
  const planned = groupGoals(goals).planned.slice(0, OVERVIEW_GOALS);

  if (planned.length === 0) {
    return (
      <AppPressable onPress={onOpenGoals} accessibilityRole="button" scaleOnPress={false} style={{ minHeight: 44 }}>
        <Text style={{ color: Colors.text, fontSize: 13, lineHeight: 19 }}>
          Give a goal a planned amount of focus time and you will see here whether you are on pace for it.{' '}
          <Text style={{ color: Colors.primary, fontWeight: '700' }}>Set a plan →</Text>
        </Text>
      </AppPressable>
    );
  }

  return (
    <View style={{ gap: Space.lg }}>
      {planned.map((g) => {
        const plannedSeconds = g.plannedMinutes! * 60;
        const shares = paceShares(g.totalFocusSeconds, g.plannedMinutes!, g.timePace.expectedSeconds);
        const copy = paceCopy(g.timePace, formatSeconds);
        return (
          <AppPressable
            key={g.id}
            onPress={onOpenGoals}
            scaleOnPress={false}
            accessibilityRole="button"
            accessibilityLabel={`${g.title}: ${formatSeconds(g.totalFocusSeconds)} of ${formatSeconds(plannedSeconds)}. ${copy.text}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
              <Text numberOfLines={1} style={{ flex: 1, color: Colors.textBright, fontSize: 15, fontWeight: '600' }}>
                {g.title}
              </Text>
              <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
                {formatSeconds(g.totalFocusSeconds)} / {formatSeconds(plannedSeconds)}
              </Text>
            </View>
            <PaceBar done={shares.done} expected={shares.expected} tone={copy.tone} />
            <Text style={{ color: copy.tone === 'warning' ? Colors.warning : Colors.text, fontSize: 12, marginTop: Space.xs }}>
              {copy.text}
            </Text>
          </AppPressable>
        );
      })}
      <AppPressable onPress={onOpenGoals} accessibilityRole="button" scaleOnPress={false} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>All goals →</Text>
      </AppPressable>
    </View>
  );
}

function WeekNav({ onPrev, onNext, canNext }: { onPrev: () => void; onNext: () => void; canNext: boolean }) {
  const Colors = useTheme();
  const btn = { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={{ flexDirection: 'row' }}>
      <AppPressable onPress={onPrev} accessibilityRole="button" accessibilityLabel="Previous week" style={btn}>
        <Ionicons name="chevron-back" size={20} color={Colors.text} />
      </AppPressable>
      <AppPressable
        onPress={onNext}
        disabled={!canNext}
        accessibilityRole="button"
        accessibilityLabel="Next week"
        accessibilityState={{ disabled: !canNext }}
        style={{ ...btn, opacity: canNext ? 1 : 0.3 }}
      >
        <Ionicons name="chevron-forward" size={20} color={Colors.text} />
      </AppPressable>
    </View>
  );
}
