import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { topMovers, moverSentence } from '../../lib/timeAnalytics';
import { useTimeReport, REPORT_PERIODS, type ReportPeriod } from '../../hooks/useTimeReport';
import type { TimeReport } from '../../types';
import { Rule, SectionTitle, DeltaText, LedgerRow, DrillRow, Notice, SkeletonBlocks, ErrorRetry } from './parts';
import type { SessionsTarget } from './SessionsSheet';

/**
 * Breakdown: where a period's time went, by goal, task or category, with
 * every goal and task row opening the sessions behind it.
 *
 * Every row here reads GET /time-report, and the session list behind a row
 * reads GET /time-report/sessions with the same window and zone; the server
 * guarantees the two agree (sessions.integration.test.ts). Categories have no
 * drill-down yet: the session route groups by goal and task only.
 */

type Grouping = 'goals' | 'tasks' | 'tags';

const GROUPINGS: { key: Grouping; label: string }[] = [
  { key: 'goals', label: 'Goals' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'tags', label: 'Categories' },
];

const PERIOD_NOUN: Record<ReportPeriod, string> = {
  today: 'day', week: 'week', month: 'month', quarter: 'quarter', all: 'period',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function BreakdownLens({ period, onPeriodChange, onDrill, onLongPressTag }: {
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  onDrill: (target: SessionsTarget) => void;
  onLongPressTag: (tag: string) => void;
}) {
  const Colors = useTheme();
  const { report, loading, error, reload } = useTimeReport(period);
  const [grouping, setGrouping] = useState<Grouping>('goals');

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingBottom: Space.page }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading && !!report} onRefresh={reload} tintColor={Colors.primary} />}
    >
      <Segmented
        options={REPORT_PERIODS}
        value={period}
        onChange={onPeriodChange}
        style={{ marginTop: Space.md }}
      />

      {loading && !report && <SkeletonBlocks heights={[60, 44, 44, 44]} />}
      {!loading && error && !report && <ErrorRetry title="Could not load your report" body={error} onRetry={reload} />}
      {report && (
        <ReportBody
          report={report}
          noun={PERIOD_NOUN[period]}
          grouping={grouping}
          onGrouping={setGrouping}
          onDrill={onDrill}
          onLongPressTag={onLongPressTag}
        />
      )}
    </ScrollView>
  );
}

function ReportBody({ report, noun, grouping, onGrouping, onDrill, onLongPressTag }: {
  report: TimeReport;
  noun: string;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
  onDrill: (target: SessionsTarget) => void;
  onLongPressTag: (tag: string) => void;
}) {
  const Colors = useTheme();
  const { totals, intent, previous, range } = report;
  const subtitle = range.from === range.to ? range.from : `${range.from} → ${range.to}`;
  const drill = (by: 'goal' | 'task', key: string | null, title: string) =>
    onDrill({ by, key, from: range.from, to: range.to, title, subtitle });

  if (totals.sessions === 0) {
    return (
      <Notice
        title={`No focus time logged this ${noun}.`}
        body="Run a session from the Focus tab and it will show up here, with what it was for."
      />
    );
  }

  const movers = topMovers([
    ...report.goals.map((g) => ({ name: g.title, seconds: g.seconds, previousSeconds: g.previousSeconds })),
    ...report.tags.map((t) => ({ name: t.tag, seconds: t.seconds, previousSeconds: t.previousSeconds })),
  ]);

  return (
    <View>
      {/* The answer, in two lines: how much, and how much of it was aimed. */}
      <View style={{ paddingTop: Space.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
          <Text style={{ color: Colors.textBright, fontSize: 36, fontFamily: Font.editorialBold }}>
            {formatSeconds(totals.seconds)}
          </Text>
          <DeltaText current={totals.seconds} previous={previous.seconds} />
        </View>
        <Text style={{ color: Colors.text, fontSize: 13, marginTop: 2 }}>
          {totals.sessions} session{totals.sessions === 1 ? '' : 's'} on {totals.activeDays} day
          {totals.activeDays === 1 ? '' : 's'}
          {totals.avgSessionSeconds > 0 ? `, averaging ${formatSeconds(totals.avgSessionSeconds)}` : ''}
        </Text>
        {intent.goalLinkedShare !== null && (
          <Text style={{ color: Colors.textBright, fontSize: 14, lineHeight: 21, marginTop: Space.md }}>
            <Text style={{ fontFamily: Font.mono, fontWeight: '700' }}>{pct(intent.goalLinkedShare)}</Text>
            {' '}went to work linked to a goal
            {intent.urgentShare !== null && intent.urgentShare > 0 ? `, ${pct(intent.urgentShare)} to high or urgent work` : ''}.
          </Text>
        )}
        <Text style={{ color: Colors.text, fontSize: 11, marginTop: Space.sm, fontFamily: Font.mono }}>{subtitle}</Text>
      </View>

      <Segmented options={GROUPINGS} value={grouping} onChange={onGrouping} style={{ marginTop: Space.xl }} />

      <View style={{ marginTop: Space.md }}>
        {grouping === 'goals' && <GoalRows report={report} drill={drill} />}
        {grouping === 'tasks' && <TaskRows report={report} drill={drill} />}
        {grouping === 'tags' && <TagRows report={report} onLongPressTag={onLongPressTag} />}
      </View>

      {movers.length > 0 && (
        <>
          <SectionTitle>What moved</SectionTitle>
          {movers.map((m) => (
            <Text key={m.name} style={{ color: Colors.textBright, fontSize: 14, lineHeight: 21, marginBottom: Space.sm }}>
              {moverSentence(m, noun)}
            </Text>
          ))}
        </>
      )}

      {report.truncated && (
        <Text style={{ color: Colors.warning, fontSize: 12, lineHeight: 17, marginTop: Space.lg }}>
          This range holds more sessions than one report reads, so these totals leave out the oldest ones.
          Pick a shorter period for exact figures.
        </Text>
      )}
      {report.approxShare > 0.05 && (
        <Text style={{ color: Colors.text, fontSize: 11, lineHeight: 16, marginTop: Space.md }}>
          {pct(report.approxShare)} of this time was recorded before Ascend stored your timezone. Its day is
          worked out from your current one.
        </Text>
      )}
    </View>
  );
}

type Drill = (by: 'goal' | 'task', key: string | null, title: string) => void;

function GoalRows({ report, drill }: { report: TimeReport; drill: Drill }) {
  const Colors = useTheme();
  const goals = [...report.goals].sort((a, b) => b.seconds - a.seconds);
  if (goals.length === 0 && report.intent.unlinkedSeconds === 0) {
    return <Text style={{ color: Colors.text, fontSize: 13 }}>No goals yet.</Text>;
  }
  return (
    <>
      {goals.map((g, i) => (
        <View key={g.goalId}>
          {i > 0 && <Rule />}
          <DrillRow
            title={g.title}
            seconds={g.seconds}
            share={g.share}
            tint={g.status === 'starved' ? Colors.warning : undefined}
            subtitle={g.seconds === 0 ? 'no time this period'
              : `${g.sessions} session${g.sessions === 1 ? '' : 's'} · ${pct(g.share)} of goal time`
                + (g.status === 'starved' ? ' · needs time' : '')}
            onPress={g.seconds > 0 ? () => drill('goal', g.goalId, g.title) : undefined}
          />
        </View>
      ))}
      {report.intent.unlinkedSeconds > 0 && (
        <>
          {goals.length > 0 && <Rule />}
          <DrillRow
            title="Not linked to a goal"
            seconds={report.intent.unlinkedSeconds}
            subtitle="tasks without a goal, and timer-only sessions"
            onPress={() => drill('goal', null, 'Not linked to a goal')}
          />
        </>
      )}
    </>
  );
}

function TaskRows({ report, drill }: { report: TimeReport; drill: Drill }) {
  return (
    <>
      {report.tasks.map((t, i) => (
        <View key={t.taskId ?? `t${i}`}>
          {i > 0 && <Rule />}
          <DrillRow
            title={t.title}
            seconds={t.seconds}
            subtitle={[t.goalTitle, t.wasRecurring ? 'recurring' : null].filter(Boolean).join(' · ') || null}
            onPress={t.taskId ? () => drill('task', t.taskId, t.title) : undefined}
          />
        </View>
      ))}
      {report.tasksOther.count > 0 && (
        <>
          <Rule />
          <LedgerRow
            title={`${report.tasksOther.count} more task${report.tasksOther.count === 1 ? '' : 's'}`}
            seconds={report.tasksOther.seconds}
            subtitle="smaller tasks, together"
          />
        </>
      )}
      {report.unattributedSeconds > 0 && (
        <>
          <Rule />
          <DrillRow
            title="Timer, no task"
            seconds={report.unattributedSeconds}
            subtitle="free-form timer sessions"
            onPress={() => drill('task', null, 'Timer, no task')}
          />
        </>
      )}
    </>
  );
}

function TagRows({ report, onLongPressTag }: { report: TimeReport; onLongPressTag: (tag: string) => void }) {
  const Colors = useTheme();
  if (report.tags.length === 0) return <Text style={{ color: Colors.text, fontSize: 13 }}>No categories this period.</Text>;
  return (
    <>
      {report.tags.map((tag, i) => (
        <View key={tag.tag}>
          {i > 0 && <Rule />}
          <AppPressable
            onLongPress={() => onLongPressTag(tag.tag)}
            accessibilityRole="button"
            accessibilityLabel={`${tag.tag}, ${formatSeconds(tag.seconds)}. Long press to change its colour or icon.`}
            scaleOnPress={false}
          >
            <LedgerRow title={tag.tag} seconds={tag.seconds} share={tag.share} subtitle={`${pct(tag.share)} of tagged time`} />
          </AppPressable>
        </View>
      ))}
    </>
  );
}

export function Segmented<K extends string>({ options, value, onChange, style }: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  style?: object;
}) {
  const Colors = useTheme();
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: Colors.raised, borderRadius: Radius.md, padding: Space.xs }, style]}>
      {options.map(({ key, label }) => (
        <AppPressable
          key={key}
          onPress={() => onChange(key)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === key }}
          scaleOnPress={false}
          style={{
            flex: 1, minHeight: 36, justifyContent: 'center', borderRadius: Radius.sm, alignItems: 'center',
            backgroundColor: value === key ? Colors.primary : 'transparent',
          }}
        >
          <Text numberOfLines={1} style={{ color: value === key ? '#fff' : Colors.text, fontSize: 12.5, fontWeight: '700' }}>
            {label}
          </Text>
        </AppPressable>
      ))}
    </View>
  );
}
