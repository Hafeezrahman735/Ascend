import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { getLocalDateString } from '../../utils/date';
import { weekRange, weekBars, compactHours, monthYearLabel } from '../../lib/timeAnalytics';
import { useTimeReportRange, useTimeHistory } from '../../hooks/useTimeReport';
import { useTimerStore } from '../../stores/timerStore';
import { useGoalStore } from '../../stores/goalStore';
import { WeekBars } from './charts';
import { DeltaText, ShareBar, SkeletonBlocks } from './parts';
import type { Lens } from './TimeAnalyticsView';

/**
 * The Time card on Today: this week at a glance, and the all-time climb in one
 * line. Everything that needs reading twice lives on the Time tab.
 *
 * It reads the same routes as the full screen (/time-report for the week,
 * /time-report/history for all time), so the card and the screen one tap away
 * cannot disagree, which is how the card before the last one came to be
 * replaced.
 */

export default function TimeCard({ onOpen }: { onOpen: (lens: Lens) => void }) {
  const Colors = useTheme();
  // Today stays mounted as a tab, so the day and the numbers are refreshed each
  // time it regains focus (a session just finished on Focus, or a new day).
  const [today, setToday] = useState(() => getLocalDateString());
  const week = weekRange(today);
  const { report, loading, error, reload: reloadWeek } = useTimeReportRange(week.from, week.to);
  const { history, reload: reloadHistory } = useTimeHistory();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setToday(getLocalDateString());
      reloadWeek();
      reloadHistory();
    }, [reloadWeek, reloadHistory]),
  );
  const targetSeconds = useTimerStore((s) => s.settings.dailyFocusMinutes) * 60;
  const behind = useGoalStore((s) => s.goals.filter(
    (g) => !g.isArchived && !g.isCompleted && g.timePace.status === 'behind',
  ).length);

  if (!report) {
    if (loading) return <SkeletonBlocks heights={[36, 96]} />;
    return (
      <Text style={{ color: Colors.text, fontSize: 12, textAlign: 'center', paddingVertical: Space.lg }}>
        {error ?? 'Could not load this week.'}
      </Text>
    );
  }

  const bars = weekBars(report.series.daily, week.from, today);

  return (
    <AppPressable
      onPress={() => onOpen('overview')}
      scaleOnPress={false}
      accessibilityRole="button"
      accessibilityLabel={`This week ${formatSeconds(report.totals.seconds)}. Open time analytics.`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
        <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800' }}>
          {formatSeconds(report.totals.seconds)}
        </Text>
        <DeltaText current={report.totals.seconds} previous={report.previous.seconds} />
      </View>
      <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2, marginBottom: Space.md }}>
        this week · {report.totals.sessions} session{report.totals.sessions === 1 ? '' : 's'}
      </Text>

      <WeekBars bars={bars} targetSeconds={targetSeconds} height={72} />

      {report.intent.goalLinkedShare !== null && (
        <View style={{ marginTop: Space.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ color: Colors.text, fontSize: 12 }}>Linked to a goal</Text>
            <Text style={{ color: Colors.textBright, fontSize: 12, fontWeight: '700', fontFamily: Font.mono }}>
              {Math.round(report.intent.goalLinkedShare * 100)}%
            </Text>
          </View>
          <ShareBar share={report.intent.goalLinkedShare} color={Colors.accent} />
        </View>
      )}

      {history && history.allTime.sessions > 0 && (
        <Text style={{ color: Colors.text, fontSize: 12, marginTop: Space.lg }}>
          <Text style={{ color: Colors.textBright, fontFamily: Font.mono, fontWeight: '700' }}>
            {compactHours(history.allTime.seconds)}
          </Text>
          {' '}all time{history.allTime.firstDate ? ` · since ${monthYearLabel(history.allTime.firstDate)}` : ''}
        </Text>
      )}

      {behind > 0 && (
        <AppPressable
          onPress={() => onOpen('goals')}
          accessibilityRole="button"
          scaleOnPress={false}
          style={{ marginTop: Space.md, minHeight: 32, justifyContent: 'center' }}
        >
          <Text style={{ color: Colors.warning, fontSize: 12 }}>
            {behind} goal{behind === 1 ? '' : 's'} behind pace →
          </Text>
        </AppPressable>
      )}
    </AppPressable>
  );
}
