import { useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import {
  heatmapCells, activeDayShare, weekdayAverages, peakWindow, hourLabel, shiftKey,
} from '../../lib/timeAnalytics';
import { useTimeReportRange, type TimeHistoryState } from '../../hooks/useTimeReport';
import { useGamificationStore } from '../../stores/gamificationStore';
import YearHeatmap from './YearHeatmap';
import { HourBars, WeekdayAverageBars } from './charts';
import { SectionTitle, SkeletonBlocks, ErrorRetry, Notice } from './parts';

/**
 * Activity: when the work happens. A year of days, the run you are on, then
 * the hours and weekdays that carry the most focus over the last 12 months.
 *
 * The run figures are the user's streak as stored on their account, the same
 * numbers the rest of the app shows; there is deliberately no second streak
 * calculation here to disagree with them.
 */

const PATTERN_DAYS = 365;

export default function ActivityLens({ history, today }: { history: TimeHistoryState; today: string }) {
  const Colors = useTheme();
  const from = shiftKey(today, -(PATTERN_DAYS - 1));
  const year = useTimeReportRange(from, today);
  const currentStreak = useGamificationStore((s) => s.currentStreak);
  const longestStreak = useGamificationStore((s) => s.longestStreak);

  const cells = useMemo(
    () => (history.history ? heatmapCells(history.history.daily, today) : []),
    [history.history, today],
  );

  const refresh = () => { history.reload(); year.reload(); };
  const refreshing = (history.loading && !!history.history) || (year.loading && !!year.report);

  const share = history.history
    ? activeDayShare(history.history.allTime.activeDays, history.history.allTime.firstDate, today)
    : null;

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: Space.lg, paddingBottom: Space.page }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
    >
      <SectionTitle>Your year</SectionTitle>
      {!history.history && history.loading && <SkeletonBlocks heights={[120]} />}
      {!history.history && !history.loading && history.error && (
        <ErrorRetry title="Could not load your year" body={history.error} onRetry={history.reload} />
      )}
      {history.history && <YearHeatmap cells={cells} />}

      {/* ── Runs ──────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', marginTop: Space.section, gap: Space.lg }}>
        <Stat value={`${currentStreak}`} unit={currentStreak === 1 ? 'day' : 'days'} label="current run" />
        <Stat value={`${longestStreak}`} unit={longestStreak === 1 ? 'day' : 'days'} label="longest run" />
        <Stat value={share === null ? '–' : `${Math.round(share * 100)}`} unit="%" label="days with focus" />
      </View>

      {/* ── Patterns ──────────────────────────────────────────────────── */}
      {!year.report && year.loading && <SkeletonBlocks heights={[80, 160]} />}
      {!year.report && !year.loading && year.error && (
        <ErrorRetry title="Could not load your patterns" body={year.error} onRetry={year.reload} />
      )}
      {year.report && (year.report.totals.sessions === 0 ? (
        <Notice title="No focus in the last year yet." body="Your hours and weekdays show up here once you have a few sessions." />
      ) : (
        <Patterns report={year.report} from={from} to={today} />
      ))}
    </ScrollView>
  );
}

function Patterns({ report, from, to }: {
  report: NonNullable<ReturnType<typeof useTimeReportRange>['report']>;
  from: string;
  to: string;
}) {
  const Colors = useTheme();
  const peak = peakWindow(report.patterns.byHour);
  const averages = weekdayAverages(report.patterns.byWeekday, from, to);
  return (
    <>
      <SectionTitle note="last 12 months">Time of day</SectionTitle>
      <HourBars byHour={report.patterns.byHour} />
      {peak && (
        <Text style={{ color: Colors.textBright, fontSize: 14, lineHeight: 21, marginTop: Space.md }}>
          You focus most between{' '}
          <Text style={{ fontFamily: Font.mono, fontWeight: '700' }}>
            {hourLabel(peak.start)}–{hourLabel(peak.start + 2)}
          </Text>
          .
        </Text>
      )}

      <SectionTitle note="average per day">Weekdays</SectionTitle>
      <WeekdayAverageBars averages={averages} />

      {report.approxShare > 0.05 && (
        <Text style={{ color: Colors.text, fontSize: 11, lineHeight: 16, marginTop: Space.lg }}>
          {Math.round(report.approxShare * 100)}% of this time was recorded before Ascend stored your timezone.
          Its hour is worked out from your current one.
        </Text>
      )}
    </>
  );
}

function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  const Colors = useTheme();
  return (
    <View style={{ flex: 1 }} accessible accessibilityLabel={`${label}: ${value} ${unit}`}>
      <Text style={{ color: Colors.textBright, fontSize: 26, fontFamily: Font.display }}>
        {value}
        <Text style={{ fontSize: 14, color: Colors.text, fontFamily: Font.body }}> {unit}</Text>
      </Text>
      <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
