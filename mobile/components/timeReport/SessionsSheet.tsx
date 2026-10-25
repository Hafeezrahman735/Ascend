import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../AppPressable';
import { BottomSheet, SCREEN_H } from '../SheetPrimitives';
import { formatSeconds } from '../../lib/taskMetrics';
import { dayLabel } from '../../lib/timeAnalytics';
import { useSessionPages, type SessionsQuery } from '../../hooks/useTimeReport';
import type { TimeSessionsPage } from '../../types';
import { Rule } from './parts';

/**
 * The sessions behind one total: tap a goal or task row anywhere in the time
 * screens and this lists every session it adds up, newest first.
 *
 * The header total comes from the same route as the rows (and the server
 * guarantees it equals the row that was tapped), so the sheet can never show
 * a figure that disagrees with what opened it.
 */

export interface SessionsTarget extends SessionsQuery {
  title: string;
  /** Under the title, e.g. the date range. */
  subtitle: string;
}

type Row = TimeSessionsPage['sessions'][number];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SessionRow({ row, showTask }: { row: Row; showTask: boolean }) {
  const Colors = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: Space.md, gap: Space.md }}
      accessible
      accessibilityLabel={`${dayLabel(row.localDate)} at ${timeOf(row.completedAt)}, ${formatSeconds(row.durationSeconds)}${row.taskTitle ? `, ${row.taskTitle}` : ''}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>
          {dayLabel(row.localDate)}
          <Text style={{ color: Colors.text, fontWeight: '400' }}>
            {'  '}{timeOf(row.completedAt)}{row.approximateDay ? ' ~' : ''}
          </Text>
        </Text>
        {showTask && (
          <Text numberOfLines={1} style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>
            {row.taskTitle ?? 'Timer, no task'}{row.wasRecurring ? ' · habit' : ''}
          </Text>
        )}
      </View>
      <Text style={{
        color: Colors.textBright, fontSize: 14, fontFamily: Font.mono, fontVariant: ['tabular-nums'],
      }}>
        {formatSeconds(row.durationSeconds)}
      </Text>
    </View>
  );
}

export default function SessionsSheet({ target, onClose }: {
  target: SessionsTarget | null;
  onClose: () => void;
}) {
  const Colors = useTheme();
  const pages = useSessionPages(target);
  // A task's own list does not need the task name on every row.
  const showTask = target?.by === 'goal' || target?.key === null;

  return (
    <BottomSheet visible={target !== null} onClose={onClose} sheetHeight={SCREEN_H * 0.75}>
      <View style={{ paddingHorizontal: Space.xl, paddingBottom: Space.md }}>
        <Text numberOfLines={2} style={{ color: Colors.textBright, fontSize: 18, fontFamily: Font.display }}>
          {target?.title}
        </Text>
        <Text style={{ color: Colors.text, fontSize: 12, marginTop: 2 }}>{target?.subtitle}</Text>
        {pages.totals && (
          <Text style={{ color: Colors.textBright, fontSize: 13, fontFamily: Font.mono, marginTop: Space.sm }}>
            {formatSeconds(pages.totals.seconds)} · {pages.totals.sessions} session{pages.totals.sessions === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      <Rule />

      {pages.loading && <ActivityIndicator color={Colors.primary} style={{ marginVertical: Space.page }} />}

      {pages.error && pages.sessions.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: Space.xxl, gap: Space.md }}>
          <Text style={{ color: Colors.text, fontSize: 13 }}>{pages.error}</Text>
          <AppPressable
            onPress={pages.retry}
            accessibilityRole="button"
            style={{
              paddingHorizontal: Space.xl, paddingVertical: Space.sm, minHeight: 44, justifyContent: 'center',
              borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
            }}
          >
            <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '600' }}>Try again</Text>
          </AppPressable>
        </View>
      )}

      {!pages.loading && !pages.error && pages.sessions.length === 0 && (
        <Text style={{ color: Colors.text, fontSize: 13, textAlign: 'center', paddingVertical: Space.xxl }}>
          No sessions in this range.
        </Text>
      )}

      {pages.sessions.length > 0 && (
        <FlatList
          data={pages.sessions}
          style={{ flexShrink: 1 }}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <SessionRow row={item} showTask={showTask} />}
          ItemSeparatorComponent={Rule}
          contentContainerStyle={{ paddingHorizontal: Space.xl, paddingBottom: Space.page }}
          onEndReached={pages.loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            <View style={{ paddingVertical: Space.lg, alignItems: 'center' }}>
              {pages.loadingMore && <ActivityIndicator color={Colors.primary} />}
              {pages.error && pages.hasMore && (
                <AppPressable onPress={pages.retry} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>Could not load more. Try again</Text>
                </AppPressable>
              )}
              {pages.sessions.some((s) => s.approximateDay) && (
                <Text style={{ color: Colors.text, fontSize: 11, textAlign: 'center', marginTop: Space.sm }}>
                  ~ recorded before Ascend stored timezones; the day is worked out from your current one.
                </Text>
              )}
            </View>
          }
        />
      )}
    </BottomSheet>
  );
}
