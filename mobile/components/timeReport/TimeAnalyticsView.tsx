import { useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
 */

export type Lens = 'overview' | 'activity' | 'goals' | 'breakdown';

const LENSES: { key: Lens; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'activity', label: 'Activity' },
  { key: 'goals', label: 'Goals' },
  { key: 'breakdown', label: 'Breakdown' },
];

export default function TimeAnalyticsView({
  initialLens = 'overview', period, onPeriodChange, onBack, onLongPressTag, onEditGoal,
}: {
  initialLens?: Lens;
  /** The Breakdown period. Owned by the Tasks screen so it survives leaving and coming back. */
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  onBack: () => void;
  onLongPressTag: (tag: string) => void;
  onEditGoal: (goal: TaskGoal) => void;
}) {
  const Colors = useTheme();
  const [lens, setLens] = useState<Lens>(initialLens);
  const [drill, setDrill] = useState<SessionsTarget | null>(null);
  const history = useTimeHistory();
  // Read once per mount: a screen left open across midnight keeps the day it
  // opened on until it is reopened, rather than shifting under the user.
  const [today] = useState(() => getLocalDateString());

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.lg, paddingVertical: Space.md }}>
        <AppPressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          style={{ marginRight: Space.md, padding: Space.xs }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </AppPressable>
        <Text style={{ color: Colors.textBright, fontSize: 18, fontFamily: Font.display }}>Time</Text>
      </View>

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

      <View style={{ flex: 1 }}>
        {lens === 'overview' && (
          <OverviewLens history={history} today={today} onOpenGoals={() => setLens('goals')} onDrill={setDrill} />
        )}
        {lens === 'activity' && <ActivityLens history={history} today={today} />}
        {lens === 'goals' && <GoalsLens today={today} onEditGoal={onEditGoal} onDrill={setDrill} />}
        {lens === 'breakdown' && (
          <BreakdownLens period={period} onPeriodChange={onPeriodChange} onDrill={setDrill} onLongPressTag={onLongPressTag} />
        )}
      </View>

      <SessionsSheet target={drill} onClose={() => setDrill(null)} />
    </SafeAreaView>
  );
}
