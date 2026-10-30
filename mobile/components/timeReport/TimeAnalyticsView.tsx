import { useCallback, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import { Space } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { getLocalDateString } from '../../utils/date';
import { useTimeHistory, type ReportPeriod } from '../../hooks/useTimeReport';
import type { TaskGoal } from '../../types';
import OverviewLens from './OverviewLens';
import ActivityLens from './ActivityLens';
import GoalsLens from './GoalsLens';
import BreakdownLens from './BreakdownLens';
import SessionsSheet, { type SessionsTarget } from './SessionsSheet';

/**
 * The time screen: four lenses on the same sessions.
 *
 *   Overview   the climb, this week against the daily target, planned goals
 *   Activity   a year of days, runs, hours and weekdays
 *   Goals      planned vs done, with pace
 *   Breakdown  a period by goal, task or category, each row drilling down
 *
 * It replaces the sentence-led "Concept 2A" report on purpose: the owner asked
 * for graphs and tables of growth, so the restraint rule that screen lived by
 * ("at most one chart per section") no longer applies. What carries over is
 * the rule that matters more: every number traces to a stored session or to a
 * field the user set. Nothing is estimated and shown as if it were measured.
 *
 * The all-time history is fetched once here and shared by the two lenses that
 * read it, so switching between them is instant.
 *
 * It is the Time tab, and tabs stay mounted. So each time it regains focus it
 * re-reads the local day, refetches the history and remounts the open lens
 * (which refetches its own data): a session finished on Focus, or a day that
 * rolled over while the app sat in the background, shows on return.
 */

export type Lens = 'overview' | 'activity' | 'goals' | 'breakdown';

const LENSES: { key: Lens; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'activity', label: 'Activity' },
  { key: 'goals', label: 'Goals' },
  { key: 'breakdown', label: 'Breakdown' },
];

export default function TimeAnalyticsView({
  initialLens = 'overview', lensRequestKey, period, onPeriodChange, onBack, onLongPressTag, onEditGoal, onStartFocus,
}: {
  initialLens?: Lens;
  /**
   * Changes each time something asks for `initialLens` (a tap on Today's Time
   * card), so asking for the lens already showing still switches back to it
   * after the user moved to another one.
   */
  lensRequestKey?: string;
  /** The Breakdown period. Owned by the Time tab so it survives switching lenses. */
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  /** Shows a back arrow when given; the Time tab has none. */
  onBack?: () => void;
  onLongPressTag: (tag: string) => void;
  onEditGoal: (goal: TaskGoal) => void;
  /** The empty state's one action. */
  onStartFocus: () => void;
}) {
  const Colors = useTheme();
  const [lens, setLens] = useState<Lens>(initialLens);
  const [appliedRequest, setAppliedRequest] = useState(lensRequestKey);
  if (lensRequestKey !== appliedRequest) {
    setAppliedRequest(lensRequestKey);
    setLens(initialLens);
  }
  const [drill, setDrill] = useState<SessionsTarget | null>(null);
  const history = useTimeHistory();
  // The day is held, not read per render, so a screen open across midnight does
  // not shift under the user; it moves to the new day on the next focus.
  const [today, setToday] = useState(() => getLocalDateString());
  const [visit, setVisit] = useState(0);
  const firstFocus = useRef(true);
  const reloadHistory = history.reload;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setToday(getLocalDateString());
      reloadHistory();
      setVisit((v) => v + 1);
    }, [reloadHistory]),
  );

  const neverFocused = history.history?.allTime.sessions === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.lg, paddingVertical: Space.md }}>
        {onBack && (
          <AppPressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            style={{ marginRight: Space.md, padding: Space.xs }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </AppPressable>
        )}
        <Text accessibilityRole="header" style={{ color: Colors.textBright, fontSize: 18, fontFamily: Font.display }}>Time</Text>
      </View>

      {neverFocused ? <NoSessionsYet onStartFocus={onStartFocus} /> : (<>

      {/* Underline tabs: the lens is a view of the same data, not a filter on it. */}
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', paddingHorizontal: Space.lg, borderBottomWidth: 1, borderBottomColor: Colors.border }}
      >
        {LENSES.map(({ key, label }) => {
          const selected = lens === key;
          return (
            <AppPressable
              key={key}
              onPress={() => setLens(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              scaleOnPress={false}
              style={{
                flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44,
                borderBottomWidth: 2, borderBottomColor: selected ? Colors.primary : 'transparent', marginBottom: -1,
              }}
            >
              <Text numberOfLines={1} style={{
                color: selected ? Colors.textBright : Colors.text, fontSize: 13, fontWeight: selected ? '700' : '500',
              }}>
                {label}
              </Text>
            </AppPressable>
          );
        })}
      </View>

      <View key={visit} style={{ flex: 1 }}>
        {lens === 'overview' && (
          <OverviewLens history={history} today={today} onOpenGoals={() => setLens('goals')} onDrill={setDrill} />
        )}
        {lens === 'activity' && <ActivityLens history={history} today={today} />}
        {lens === 'goals' && <GoalsLens today={today} onEditGoal={onEditGoal} onDrill={setDrill} />}
        {lens === 'breakdown' && (
          <BreakdownLens period={period} onPeriodChange={onPeriodChange} onDrill={setDrill} onLongPressTag={onLongPressTag} />
        )}
      </View>
      </>)}

      <SessionsSheet target={drill} onClose={() => setDrill(null)} />
    </SafeAreaView>
  );
}

/** Nobody has focused yet, so there is nothing to chart (design DD10). */
function NoSessionsYet({ onStartFocus }: { onStartFocus: () => void }) {
  const Colors = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xxl, gap: Space.md }}>
      <Ionicons name="time-outline" size={36} color={Colors.primarySoft} />
      <Text style={{ color: Colors.textBright, fontSize: 20, fontFamily: Font.display, textAlign: 'center' }}>
        Where your hours go
      </Text>
      <Text style={{ color: Colors.text, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
        Your focus sessions show up here by task, goal and day.
      </Text>
      <AppPressable
        onPress={onStartFocus}
        accessibilityRole="button"
        style={{ marginTop: Space.sm, backgroundColor: Colors.primary, borderRadius: 14, paddingHorizontal: Space.xl, minHeight: 48, justifyContent: 'center' }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Start a focus session</Text>
      </AppPressable>
    </View>
  );
}
