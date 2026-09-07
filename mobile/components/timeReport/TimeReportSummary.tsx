import { View, Text, ActivityIndicator } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { formatSeconds } from '../../lib/taskMetrics';
import { useTimeReport, REPORT_PERIODS, type ReportPeriod } from '../../hooks/useTimeReport';
import { WeekdayStrip, ShareBar, DeltaText } from './parts';

/**
 * The Time Tracker card on the Tasks tab: the report at a glance.
 *
 * ─── Why this fetches instead of computing locally ──────────────────────────
 *
 * It used to derive its own numbers from the AsyncStorage session cache, while
 * the full report aggregated on the server. Two sources, and they disagreed in
 * public: this card said 27m today and 1h 17m this month, the report said
 * nothing today and 50m this month. Same user, same sessions, same screen, one
 * tap apart.
 *
 * They now read the same endpoint, so they cannot drift. The cost is a request
 * on the Tasks tab, which is real — mitigated by keeping the previous answer on
 * screen while a new one loads, so switching period never blanks the card.
 *
 * ─── What belongs here versus in the full report ────────────────────────────
 *
 * Here: shapes you can read without stopping — where the week's time fell, how
 * much of it was aimed at a goal, which three tags took it. No tables, no
 * ledger, nothing that needs reading twice. Everything that needs a sentence to
 * explain it lives behind "See more".
 */

/** Tags shown before the card starts competing with the full report. */
const TOP_TAGS = 3;

export default function TimeReportSummary({
  period, onPeriodChange, onSeeMore,
}: {
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  onSeeMore: () => void;
}) {
  const Colors = useTheme();
  const { report, loading, error } = useTimeReport(period);

  return (
    <View>
      {/* Period switcher — the same five the full report offers, and the same
          state, so "See more" always opens the period you were looking at. */}
      <View style={{
        flexDirection: 'row', marginBottom: Space.md,
        backgroundColor: Colors.raised, borderRadius: Radius.sm, padding: 3,
      }}>
        {REPORT_PERIODS.map(({ key, label }) => (
          <AppPressable
            key={key}
            onPress={() => onPeriodChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: period === key }}
            scaleOnPress={false}
            style={{
              flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center',
              backgroundColor: period === key ? Colors.primary : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: period === key ? '#fff' : Colors.text, fontSize: 11, fontWeight: '700' }}
            >
              {label}
            </Text>
          </AppPressable>
        ))}
      </View>

      {loading && !report && (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: Space.xxl }} />
      )}

      {!loading && error && !report && (
        <Text style={{ color: Colors.text, fontSize: 12, textAlign: 'center', paddingVertical: Space.lg }}>
          {error}
        </Text>
      )}

      {report && (
        <>
          {/* Headline + direction of travel */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.md }}>
            <Text style={{ color: Colors.textBright, fontSize: 28, fontWeight: '800' }}>
              {formatSeconds(report.totals.seconds)}
            </Text>
            <DeltaText current={report.totals.seconds} previous={report.previous.seconds} />
          </View>
          <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>
            focus time · {report.totals.sessions} session{report.totals.sessions === 1 ? '' : 's'}
            {report.totals.activeDays > 0 ? ` · ${report.totals.activeDays} day${report.totals.activeDays === 1 ? '' : 's'}` : ''}
          </Text>

          {report.totals.sessions === 0 ? (
            <Text style={{ color: Colors.subtext, fontSize: 12, paddingVertical: Space.lg, textAlign: 'center' }}>
              No focus time logged in this period.
            </Text>
          ) : (
            <>
              {/* Graph 1 — where the week's time actually fell. */}
              <View style={{ marginTop: Space.lg }}>
                <WeekdayStrip byWeekday={report.patterns.byWeekday} Colors={Colors} />
              </View>

              {/* Graph 2 — the intent number, as one bar. Answers "was that
                  where I wanted my time to go" without a sentence. */}
              {report.intent.goalLinkedShare !== null && (
                <View style={{ marginTop: Space.lg }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ color: Colors.text, fontSize: 12 }}>Aimed at a goal</Text>
                    <Text style={{
                      color: Colors.textBright, fontSize: 12, fontWeight: '700', fontFamily: Font.mono,
                    }}>
                      {Math.round(report.intent.goalLinkedShare * 100)}%
                    </Text>
                  </View>
                  <ShareBar share={report.intent.goalLinkedShare} color={Colors.accent} />
                </View>
              )}

              {/* Graph 3 — the top few categories as proportions. */}
              {report.tags.length > 0 && (
                <View style={{ marginTop: Space.lg, gap: Space.md }}>
                  {report.tags.slice(0, TOP_TAGS).map((tag) => (
                    <View key={tag.tag}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Text numberOfLines={1} style={{ flex: 1, color: Colors.text, fontSize: 12 }}>
                          {tag.tag}
                        </Text>
                        <Text style={{
                          color: Colors.textBright, fontSize: 12, fontFamily: Font.mono,
                        }}>
                          {formatSeconds(tag.seconds)}
                        </Text>
                      </View>
                      <ShareBar share={tag.share} />
                    </View>
                  ))}
                </View>
              )}

              {/* One sentence, because a peak hour is not a shape. */}
              {report.patterns.peakHour && (
                <Text style={{ color: Colors.text, fontSize: 12, marginTop: Space.lg }}>
                  You focus most around{' '}
                  <Text style={{ fontFamily: Font.mono, fontWeight: '700', color: Colors.textBright }}>
                    {report.patterns.peakHour.label}
                  </Text>
                  .
                </Text>
              )}

              {/* The one thing worth interrupting a glance for. */}
              {report.goals.some((g) => g.status === 'starved') && (
                <AppPressable
                  onPress={onSeeMore}
                  accessibilityRole="button"
                  scaleOnPress={false}
                  style={{ marginTop: Space.md, minHeight: 32, justifyContent: 'center' }}
                >
                  <Text style={{ color: Colors.warning, fontSize: 12 }}>
                    {report.goals.filter((g) => g.status === 'starved').length} goal
                    {report.goals.filter((g) => g.status === 'starved').length === 1 ? '' : 's'} running
                    out of time →
                  </Text>
                </AppPressable>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
