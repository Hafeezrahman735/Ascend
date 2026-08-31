import { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { useTimeReport, REPORT_PERIODS, type ReportPeriod } from '../../hooks/useTimeReport';
import type { TimeReport, TimeReportGoal } from '../../types';
import { Rule, SectionTitle, DeltaText, LedgerRow, WeekdayStrip, Notice } from './parts';

/**
 * The time report: where the time went, and whether that was where it was
 * meant to go.
 *
 * Two questions decide everything on this screen, in order:
 *
 *   1. "I spent my time doing what?"
 *   2. "Was that where I actually wanted my time to go?"
 *
 * Which is why GOALS lead and TAGS come last. A tag says what a thing was
 * about; a goal says whether it mattered. Question 2 needs no new input from
 * the user — a goal already carries a deadline and the tasks they chose to
 * attach to it, so the share of goal-linked time answers it in one number.
 *
 * Restraint is a requirement here, not a preference. No tile grid, no
 * hour-by-weekday heatmap, at most one chart per section, and numbers carried
 * in sentences wherever a sentence reads better than a chart. A section that
 * does not help answer one of the two questions does not appear.
 *
 * Extracted from app/(tabs)/tasks.tsx, where this screen lived inline in a
 * 2400-line file.
 */

/** A tag has to move by at least this much to be worth a sentence. */
const TREND_MIN_SECONDS = 15 * 60;

/** How many movers the trends section will name. Three is a paragraph. */
const TREND_LIMIT = 3;

const PERIOD_NOUN: Record<ReportPeriod, string> = {
  today: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  all: 'period',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Whole days between two 'YYYY-MM-DD' keys. */
function daysSince(dateKey: string, today: Date): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - then) / 86_400_000);
}

/**
 * The sentence a starved goal needs. Facts only — a deadline and a date — with
 * no adjective about the user attached to them. A report that editorialises
 * about someone falling behind is a report they stop opening.
 */
function starvedLine(goal: TimeReportGoal, today: Date): string | null {
  const parts: string[] = [];
  if (goal.daysLeft !== null) {
    parts.push(
      goal.daysLeft < 0 ? `${Math.abs(goal.daysLeft)} days overdue`
        : goal.daysLeft === 0 ? 'Due today'
          : `Due in ${goal.daysLeft} days`,
    );
  }
  if (goal.lastWorkedDate) {
    const ago = daysSince(goal.lastWorkedDate, today);
    parts.push(ago <= 0 ? 'worked today' : ago === 1 ? 'last worked yesterday' : `last worked ${ago} days ago`);
  } else {
    parts.push('not touched this period');
  }
  return parts.length ? `${parts.join(' · ')}.` : null;
}

interface Mover {
  name: string;
  seconds: number;
  previousSeconds: number;
}

/** The few things that actually moved, largest change first. */
function topMovers(rows: Mover[]): Mover[] {
  return rows
    .filter((r) => r.previousSeconds >= TREND_MIN_SECONDS || r.seconds >= TREND_MIN_SECONDS)
    .filter((r) => Math.abs(r.seconds - r.previousSeconds) >= TREND_MIN_SECONDS)
    .sort((a, b) => Math.abs(b.seconds - b.previousSeconds) - Math.abs(a.seconds - a.previousSeconds))
    .slice(0, TREND_LIMIT);
}

function moverSentence(m: Mover, noun: string): string {
  if (m.previousSeconds === 0) return `${m.name} is new this ${noun}.`;
  if (m.seconds === 0) return `${m.name} got no time this ${noun}.`;
  const change = (m.seconds - m.previousSeconds) / m.previousSeconds;
  const dir = change > 0 ? 'up' : 'down';
  return `${m.name} is ${dir} ${pct(Math.abs(change))} from the previous ${noun}.`;
}

export default function TimeReportView({
  period, onPeriodChange, onBack, onLongPressTag,
}: {
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  onBack: () => void;
  onLongPressTag: (tag: string) => void;
}) {
  const Colors = useTheme();
  const { report, loading, error, reload } = useTimeReport(period);
  const [showTags, setShowTags] = useState(false);
  const today = useMemo(() => new Date(), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: Space.lg, paddingVertical: Space.md,
      }}>
        <AppPressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          style={{ marginRight: Space.md, padding: Space.xs }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </AppPressable>
        <Text style={{ color: Colors.textBright, fontSize: 18, fontFamily: Font.display }}>
          Time report
        </Text>
      </View>

      {/* Period switcher */}
      <View style={{
        flexDirection: 'row', marginHorizontal: Space.lg, marginBottom: Space.lg,
        backgroundColor: Colors.raised, borderRadius: Radius.md, padding: Space.xs,
      }}>
        {REPORT_PERIODS.map(({ key, label }) => (
          <AppPressable
            key={key}
            onPress={() => onPeriodChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: period === key }}
            scaleOnPress={false}
            style={{
              flex: 1, paddingVertical: Space.sm, borderRadius: Radius.sm, alignItems: 'center',
              backgroundColor: period === key ? Colors.primary : 'transparent',
            }}
          >
            <Text style={{
              color: period === key ? '#fff' : Colors.text,
              fontSize: 12.5, fontWeight: '700',
            }}>
              {label}
            </Text>
          </AppPressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: Space.lg, paddingBottom: Space.page }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading && !!report} onRefresh={reload} tintColor={Colors.primary} />
        }
      >
        {loading && !report && (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Space.page }} />
        )}

        {!loading && error && (
          <View>
            <Notice title="Could not load your report" body={error} />
            <AppPressable
              onPress={reload}
              accessibilityRole="button"
              style={{
                alignSelf: 'center', paddingHorizontal: Space.xxl, paddingVertical: Space.md,
                borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
              }}
            >
              <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>Try again</Text>
            </AppPressable>
          </View>
        )}

        {report && <ReportBody report={report} period={period} today={today} showTags={showTags}
                               onToggleTags={() => setShowTags((v) => !v)}
                               onLongPressTag={onLongPressTag} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportBody({
  report, period, today, showTags, onToggleTags, onLongPressTag,
}: {
  report: TimeReport;
  period: ReportPeriod;
  today: Date;
  showTags: boolean;
  onToggleTags: () => void;
  onLongPressTag: (tag: string) => void;
}) {
  const Colors = useTheme();
  const noun = PERIOD_NOUN[period];
  const { totals, intent, previous } = report;

  // Nothing logged. There used to be a second branch here for "the backfill
  // has not run yet", which can no longer happen: a session with no stamp is
  // resolved from its own timestamp, so it is never invisible.
  if (totals.sessions === 0) {
    return (
      <Notice
        title={`No focus time logged this ${noun}.`}
        body="Run a session from the Focus tab and it will show up here, with what it was for."
      />
    );
  }

  const goalsWithTime = report.goals.filter((g) => g.seconds > 0);
  const starved = report.goals.filter((g) => g.status === 'starved');

  const movers = topMovers([
    ...report.goals.map((g) => ({ name: g.title, seconds: g.seconds, previousSeconds: g.previousSeconds })),
    ...report.tags.map((t) => ({ name: t.tag, seconds: t.seconds, previousSeconds: t.previousSeconds })),
  ]);

  return (
    <View>
      {/* ── The answer ─────────────────────────────────────────────────────
          Two sentences. The second is the point of the screen: one number,
          no chart, and the thing a person actually wants to know. */}
      <View style={{ paddingBottom: Space.xl }}>
        <Text style={{
          color: Colors.textBright, fontSize: 44, lineHeight: 48,
          fontFamily: Font.editorialBold, letterSpacing: -0.5,
        }}>
          {formatSeconds(totals.seconds)}
        </Text>
        <Text style={{ color: Colors.text, fontSize: 14, marginTop: Space.sm }}>
          across {totals.sessions} session{totals.sessions === 1 ? '' : 's'} on{' '}
          {totals.activeDays} day{totals.activeDays === 1 ? '' : 's'}
        </Text>
        <DeltaText current={totals.seconds} previous={previous.seconds} style={{ marginTop: Space.xs }} />

        {intent.goalLinkedShare !== null && (
          <View style={{ marginTop: Space.lg }}>
            <Rule />
            <Text style={{
              color: Colors.textBright, fontSize: 15, lineHeight: 22, marginTop: Space.md,
            }}>
              <Text style={{ fontFamily: Font.mono, fontWeight: '700' }}>
                {pct(intent.goalLinkedShare)}
              </Text>
              {' '}of it went to work you had linked to a goal.
            </Text>
            {intent.unlinkedSeconds > 0 && (
              <Text style={{ color: Colors.text, fontSize: 12.5, marginTop: Space.xs }}>
                {formatSeconds(intent.unlinkedSeconds)} was not attached to one.
              </Text>
            )}
          </View>
        )}

        <Text style={{ color: Colors.subtext, fontSize: 11, marginTop: Space.md, fontFamily: Font.mono }}>
          {report.range.from} → {report.range.to}
        </Text>
      </View>

      {/* ── 1. Goals ───────────────────────────────────────────────────── */}
      <SectionTitle note={starved.length ? `${starved.length} need time` : undefined}>
        Goals
      </SectionTitle>
      {report.goals.length === 0 ? (
        <Text style={{ color: Colors.text, fontSize: 13, paddingVertical: Space.md }}>
          No goals yet. Grouping tasks into one is what lets this screen tell you whether
          your time went where you meant it to.
        </Text>
      ) : (
        report.goals.map((goal, i) => (
          <View key={goal.goalId}>
            {i > 0 && <Rule />}
            <LedgerRow
              title={goal.title}
              seconds={goal.seconds}
              share={goal.share}
              tint={goal.status === 'starved' ? Colors.warning : undefined}
              subtitle={goal.sessions > 0 ? `${goal.sessions} session${goal.sessions === 1 ? '' : 's'}` : null}
              trailing={
                goal.status === 'starved' ? (
                  <Text style={{ color: Colors.warning, fontSize: 12, marginTop: Space.sm }}>
                    {starvedLine(goal, today)}
                  </Text>
                ) : goal.status === 'idle' ? (
                  <Text style={{ color: Colors.subtext, fontSize: 12, marginTop: Space.sm }}>
                    No time this {noun}.
                  </Text>
                ) : (
                  <DeltaText
                    current={goal.seconds}
                    previous={goal.previousSeconds}
                    style={{ marginTop: Space.sm }}
                  />
                )
              }
            />
          </View>
        ))
      )}

      {/* ── 2. Tasks ───────────────────────────────────────────────────── */}
      {report.tasks.length > 0 && (
        <>
          <SectionTitle note={`top ${report.tasks.length}`}>Tasks</SectionTitle>
          {report.tasks.map((task, i) => (
            <View key={task.taskId ?? `t${i}`}>
              {i > 0 && <Rule />}
              <LedgerRow
                title={task.title}
                seconds={task.seconds}
                subtitle={[task.goalTitle, task.wasRecurring ? 'habit' : null]
                  .filter(Boolean).join(' · ') || null}
              />
            </View>
          ))}
          {report.unattributedSeconds > 0 && (
            <>
              <Rule />
              <LedgerRow
                title="Not attached to a task"
                seconds={report.unattributedSeconds}
                subtitle="free-form timer sessions"
              />
            </>
          )}
        </>
      )}

      {/* ── 3. Trends ──────────────────────────────────────────────────────
          Sentences, not a chart. A trend that needs a multi-series line to be
          legible is not one anybody can act on. */}
      {movers.length > 0 && (
        <>
          <SectionTitle>Trends</SectionTitle>
          {movers.map((m) => (
            <Text
              key={m.name}
              style={{ color: Colors.textBright, fontSize: 14, lineHeight: 21, marginBottom: Space.sm }}
            >
              {moverSentence(m, noun)}
            </Text>
          ))}
        </>
      )}

      {/* ── 4. Patterns ────────────────────────────────────────────────── */}
      <SectionTitle>When you work</SectionTitle>
      <WeekdayStrip byWeekday={report.patterns.byWeekday} Colors={Colors} />
      {report.patterns.peakHour && (
        <Text style={{ color: Colors.textBright, fontSize: 14, lineHeight: 21, marginTop: Space.lg }}>
          You focus most around{' '}
          <Text style={{ fontFamily: Font.mono, fontWeight: '700' }}>
            {report.patterns.peakHour.label}
          </Text>
          .
        </Text>
      )}
      {report.approxShare > 0.05 && (
        <Text style={{ color: Colors.subtext, fontSize: 11, lineHeight: 16, marginTop: Space.sm }}>
          {pct(report.approxShare)} of this time was recorded before Ascend stored your
          timezone. Its day and hour are worked out from your current one, which is
          right unless you have moved since.
        </Text>
      )}

      {/* ── 5. Tags — secondary, below the fold ────────────────────────── */}
      {report.tags.length > 0 && (
        <>
          <SectionTitle>Tags</SectionTitle>
          <AppPressable
            onPress={onToggleTags}
            accessibilityRole="button"
            accessibilityState={{ expanded: showTags }}
            scaleOnPress={false}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: Space.md, minHeight: 44,
            }}
          >
            <Text style={{ color: Colors.text, fontSize: 14 }}>
              {report.tags.length} categor{report.tags.length === 1 ? 'y' : 'ies'}
            </Text>
            <Ionicons
              name={showTags ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={Colors.subtext}
            />
          </AppPressable>

          {showTags && report.tags.map((tag, i) => (
            <View key={tag.tag}>
              {i > 0 && <Rule />}
              <AppPressable
                onLongPress={() => onLongPressTag(tag.tag)}
                accessibilityRole="button"
                accessibilityLabel={`${tag.tag}. Long press to change its colour or icon.`}
                scaleOnPress={false}
              >
                <LedgerRow
                  title={tag.tag}
                  seconds={tag.seconds}
                  share={tag.share}
                  subtitle={`${pct(tag.share)} of tagged time`}
                  trailing={
                    <DeltaText
                      current={tag.seconds}
                      previous={tag.previousSeconds}
                      style={{ marginTop: Space.sm }}
                    />
                  }
                />
              </AppPressable>
            </View>
          ))}
        </>
      )}

      {/* One honest line about concentration, kept from the old screen. It only
          means something now that "Untagged" is no longer inflated by the
          archived-task bug. */}
      {goalsWithTime.length > 1 && report.tags[0] && report.tags[0].share > 0.7 && (
        <Text style={{ color: Colors.text, fontSize: 12.5, lineHeight: 18, marginTop: Space.lg }}>
          {report.tags[0].tag} took {pct(report.tags[0].share)} of your tagged time this {noun}.
        </Text>
      )}
    </View>
  );
}
