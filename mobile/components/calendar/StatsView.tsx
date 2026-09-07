import { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '../../hooks/useTheme';
import type { CalendarStats } from '../../types';
import { getCalendarStyles, formatSeconds } from './shared';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const BAR_MAX_H = 74;

/**
 * Time-allocation panel.
 *
 * Charts are plain Views sized by ratio — the same approach the task analytics
 * screen already uses. No charting dependency is worth adding for three bar
 * charts.
 */
function StatCell({ label, value, sub, Colors, accent }: {
  label: string; value: string; sub: string; Colors: ThemeColors; accent?: boolean;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: accent ? Colors.AMBER : Colors.textBright, fontSize: 20, fontWeight: '800' }}>
        {value}
      </Text>
      <Text style={{ color: Colors.text, fontSize: 10, fontWeight: '600', marginTop: 2 }}>{label}</Text>
      <Text style={{ color: Colors.subtext, fontSize: 9 }}>{sub}</Text>
    </View>
  );
}

export default function StatsView({ stats }: { stats: CalendarStats | null }) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);

  const tagEntries = useMemo(
    () => (stats ? Object.entries(stats.byTag).sort((a, b) => b[1] - a[1]) : []),
    [stats],
  );

  if (!stats || stats.sessionCount === 0) {
    return (
      <View style={[styles.emptyBox, { marginHorizontal: 16, marginTop: 10 }]}>
        <Ionicons name="stats-chart-outline" size={26} color={Colors.subtext} />
        <Text style={{ color: Colors.subtext, marginTop: 6, fontSize: 13 }}>
          No focus time logged in this range yet
        </Text>
      </View>
    );
  }

  const maxTag = Math.max(...tagEntries.map(([, v]) => v), 1);
  const maxDay = Math.max(...DAY_KEYS.map((k) => stats.byDayOfWeek[k] ?? 0), 1);
  const outliers = stats.plannedVsActual.filter((p) => p.isOutlier);

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <View style={styles.statCard}>
        <Text style={styles.statHeading}>Total focus</Text>
        <Text style={{ color: Colors.primary, fontSize: 26, fontWeight: '800' }}>
          {formatSeconds(stats.totalSeconds)}
        </Text>
        <Text style={{ color: Colors.subtext, fontSize: 12 }}>
          {stats.sessionCount} session{stats.sessionCount === 1 ? '' : 's'}
        </Text>
      </View>

      {/* Consistency. Days studied and best day are scoped to the visible range;
          streaks are live user stats, labelled so the difference is obvious. */}
      <View style={styles.statCard}>
        <Text style={styles.statHeading}>Consistency</Text>
        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <StatCell label="Days worked" value={String(stats.daysStudied)} sub="in range" Colors={Colors} />
          <StatCell label="Best day" value={String(stats.bestDaySessions)} sub="sessions" Colors={Colors} />
          <StatCell label="Streak" value={`${stats.currentStreak}d`} sub="current" Colors={Colors} accent />
          <StatCell label="Longest" value={`${stats.longestStreak}d`} sub="all time" Colors={Colors} />
        </View>
      </View>

      <View style={styles.statCard}>
        <Text style={styles.statHeading}>Time by category</Text>
        {tagEntries.map(([tag, seconds]) => (
          <View key={tag} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={{ color: Colors.text, fontSize: 12 }} numberOfLines={1}>{tag}</Text>
              <Text style={{ color: Colors.subtext, fontSize: 11 }}>{formatSeconds(seconds)}</Text>
            </View>
            <View style={{ height: 6, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden' }}>
              <View
                style={{
                  width: `${(seconds / maxTag) * 100}%`,
                  height: '100%',
                  backgroundColor: Colors.primary,
                  borderRadius: 3,
                }}
              />
            </View>
          </View>
        ))}
        <Text style={{ color: Colors.subtext, fontSize: 10, marginTop: 8 }}>
          A session on a multi-tag task counts toward each of its tags.
        </Text>
      </View>

      <View style={styles.statCard}>
        <Text style={styles.statHeading}>By day of week</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 6, marginTop: 10 }}>
          {DAY_KEYS.map((key, i) => {
            const value = stats.byDayOfWeek[key] ?? 0;
            const height = Math.max((value / maxDay) * BAR_MAX_H, 3);
            return (
              <View key={key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: '65%',
                    height,
                    borderRadius: 3,
                    backgroundColor: value > 0 ? Colors.primary : Colors.inactive,
                    opacity: value > 0 ? 1 : 0.3,
                  }}
                />
                <Text style={{ color: Colors.subtext, fontSize: 10 }}>{DAY_LABELS[i]}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {stats.plannedVsActual.length > 0 && (
        <View style={styles.statCard}>
          <Text style={styles.statHeading}>Planned vs actual</Text>
          {outliers.length > 0 && (
            <Text style={{ color: Colors.ROSE, fontSize: 11, marginTop: 2 }}>
              {outliers.length} task{outliers.length === 1 ? '' : 's'} off estimate by more than 50%
            </Text>
          )}
          {stats.plannedVsActual.map((p) => (
            <View key={p.taskId} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: Colors.text, fontSize: 12, flex: 1 }} numberOfLines={1}>{p.title}</Text>
                <Text style={{ color: p.isOutlier ? Colors.ROSE : Colors.subtext, fontSize: 11, marginLeft: 8 }}>
                  {p.actualMinutes}m / {p.estimatedMinutes}m
                </Text>
              </View>
              <View style={{ height: 5, backgroundColor: Colors.inactive, borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                <View
                  style={{
                    width: `${Math.min(100, (p.ratio ?? 0) * 100)}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: p.isOutlier ? Colors.ROSE : Colors.accent,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
