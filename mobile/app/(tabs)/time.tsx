/**
 * The Time tab: where the hours went (design E1).
 *
 * The report itself is TimeAnalyticsView; this screen owns what sits around it
 * on a tab: the Breakdown period, the goal editor (the Goals lens has "Set a
 * plan", and the form is where planned time is set) and the tag sheet.
 *
 * Params, both optional: `lens` picks the lens to show, and `at` changes on
 * every request so asking for the same lens twice still applies. Today's Time
 * card sends both.
 */
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import TimeAnalyticsView, { type Lens } from '../../components/timeReport/TimeAnalyticsView';
import TagOverrideSheet from '../../components/timeReport/TagOverrideSheet';
import GoalEditor from '../../components/goals/GoalEditor';
import type { ReportPeriod } from '../../hooks/useTimeReport';
import type { TaskGoal } from '../../types';

const LENSES: readonly Lens[] = ['overview', 'activity', 'goals', 'breakdown'];

function asLens(value: string | undefined): Lens {
  return LENSES.find((l) => l === value) ?? 'overview';
}

export default function TimeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lens?: string; at?: string }>();
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const [overrideTag, setOverrideTag] = useState<string | null>(null);
  const [editingGoal, setEditingGoal] = useState<TaskGoal | null>(null);

  return (
    <>
      <TimeAnalyticsView
        initialLens={asLens(params.lens)}
        lensRequestKey={params.at}
        period={period}
        onPeriodChange={setPeriod}
        onLongPressTag={setOverrideTag}
        onEditGoal={setEditingGoal}
        onStartFocus={() => router.navigate('/(tabs)/focus')}
      />
      <GoalEditor goal={editingGoal} visible={editingGoal !== null} onClose={() => setEditingGoal(null)} />
      <TagOverrideSheet tag={overrideTag ?? ''} visible={!!overrideTag} onClose={() => setOverrideTag(null)} />
    </>
  );
}
