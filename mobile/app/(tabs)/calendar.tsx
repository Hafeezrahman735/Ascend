import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCalendarStore } from '../../stores/calendarStore';
import { useUserSettingsStore } from '../../stores/userSettingsStore';
import { useTheme } from '../../hooks/useTheme';
import type { Note } from '../../types';
import {
  getLocalDateString, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  addDays, addMonths, parseLocalDate,
} from '../../utils/date';
import {
  getCalendarStyles, groupItemsByDate, VIEW_MODES, type CalendarViewMode,
} from '../../components/calendar/shared';
import MonthView from '../../components/calendar/MonthView';
import WeekView from '../../components/calendar/WeekView';
import DayView from '../../components/calendar/DayView';
import StatsView from '../../components/calendar/StatsView';
import SessionHeatGrid from '../../components/calendar/SessionHeatGrid';

/**
 * Calendar tab — owns the view mode, the anchored date, and the fetch for the
 * visible range. Rendering lives in components/calendar/.
 */
export default function CalendarScreen() {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);

  // Week ranges follow the user's 'week starts on' setting.
  const weekStartsOn = useUserSettingsStore((s) => s.weekStartDay);

  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  const {
    items, stats, isLoading, isLoadingStats, error, syncWarning,
    fetchRange, fetchStats, createNote, updateNote, deleteNote,
  } = useCalendarStore();

  // The visible range is derived from the mode, so every view fetches exactly
  // what it renders and nothing more.
  const { start, end } = useMemo(() => {
    if (viewMode === 'day') {
      const day = getLocalDateString(anchorDate);
      return { start: day, end: day };
    }
    if (viewMode === 'month') {
      return {
        start: getLocalDateString(startOfMonth(anchorDate)),
        end: getLocalDateString(endOfMonth(anchorDate)),
      };
    }
    // Week view and Stats both operate on the anchored week.
    return {
      start: getLocalDateString(startOfWeek(anchorDate, weekStartsOn)),
      end: getLocalDateString(endOfWeek(anchorDate, weekStartsOn)),
    };
  }, [viewMode, anchorDate, weekStartsOn]);

  // Month view needs stats too — the focus heat grid is driven by
  // stats.sessionsPerDay, not by the scheduled items in `fetchRange`.
  const needsStats = viewMode === 'stats' || viewMode === 'month';

  useEffect(() => {
    if (viewMode !== 'stats') fetchRange(start, end);
    if (needsStats) fetchStats(start, end);
  }, [viewMode, needsStats, start, end, fetchRange, fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      viewMode !== 'stats' ? fetchRange(start, end) : Promise.resolve(),
      needsStats ? fetchStats(start, end) : Promise.resolve(),
    ]);
    setRefreshing(false);
  }, [viewMode, needsStats, start, end, fetchRange, fetchStats]);

  const itemsByDate = useMemo(() => groupItemsByDate(items), [items]);

  const step = useCallback((direction: 1 | -1) => {
    setAnchorDate((prev) => {
      if (viewMode === 'day') return addDays(prev, direction);
      if (viewMode === 'month') return addMonths(prev, direction);
      return addDays(prev, direction * 7);
    });
  }, [viewMode]);

  const headerLabel = useMemo(() => {
    if (viewMode === 'day') {
      return anchorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
    if (viewMode === 'month') {
      return anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const from = startOfWeek(anchorDate, weekStartsOn);
    const to = endOfWeek(anchorDate, weekStartsOn);
    return `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }, [viewMode, anchorDate]);

  const openDay = useCallback((date: string) => {
    setAnchorDate(parseLocalDate(date));
    setViewMode('day');
  }, []);

  const toggleNote = useCallback(
    (note: Note) => updateNote(note.id, { isCompleted: !note.isCompleted }),
    [updateNote],
  );

  const handleAddNote = useCallback(async () => {
    const content = noteDraft.trim();
    if (!content) return;
    setNoteDraft('');
    // Pinned to the focused day so it appears where the user typed it.
    await createNote({ content, date: getLocalDateString(anchorDate), isTodo: true });
  }, [noteDraft, anchorDate, createNote]);

  const handleDeleteNote = useCallback((note: Note) => {
    Alert.alert('Delete note?', note.content.slice(0, 80), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteNote(note.id) },
    ]);
  }, [deleteNote]);

  const showSpinner = (isLoading || isLoadingStats) && items.length === 0 && !stats;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top']}>
      <View style={styles.segment}>
        {VIEW_MODES.map((mode) => (
          <TouchableOpacity
            key={mode.key}
            onPress={() => setViewMode(mode.key)}
            style={[styles.segmentItem, viewMode === mode.key && { backgroundColor: Colors.primary }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === mode.key }}
          >
            <Text style={[styles.segmentText, viewMode === mode.key && { color: '#fff', fontWeight: '700' }]}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => step(-1)} style={styles.navBtn} hitSlop={8} accessibilityLabel="Previous">
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAnchorDate(new Date())} style={{ flex: 1 }} accessibilityLabel="Jump to today">
          <Text style={styles.navLabel} numberOfLines={1}>{headerLabel}</Text>
          <Text style={styles.navToday}>Tap for today</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => step(1)} style={styles.navBtn} hitSlop={8} accessibilityLabel="Next">
          <Ionicons name="chevron-forward" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {syncWarning && (
        <View style={styles.warnBanner}>
          <Ionicons name="warning-outline" size={14} color={Colors.ROSE} />
          <Text style={styles.warnText}>{syncWarning}</Text>
        </View>
      )}
      {error && (
        <View style={styles.warnBanner}>
          <Ionicons name="alert-circle-outline" size={14} color={Colors.ROSE} />
          <Text style={styles.warnText}>{error}</Text>
        </View>
      )}

      {showSpinner ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {viewMode === 'month' && (
            <>
              <MonthView anchorDate={anchorDate} itemsByDate={itemsByDate} onDayPress={openDay} />
              {/* Focus intensity, moved over from the Tasks tab's calendar.
                  MonthView above shows what's scheduled; this shows what actually
                  got done. */}
              <SessionHeatGrid
                anchorDate={anchorDate}
                sessionsPerDay={stats?.sessionsPerDay ?? {}}
                itemsByDate={itemsByDate}
                onDayPress={openDay}
              />
            </>
          )}
          {viewMode === 'week' && (
            <WeekView
              start={startOfWeek(anchorDate, weekStartsOn)}
              itemsByDate={itemsByDate}
              onDayPress={openDay}
              onToggleNote={toggleNote}
            />
          )}
          {viewMode === 'day' && (
            <DayView
              dateKey={getLocalDateString(anchorDate)}
              itemsByDate={itemsByDate}
              noteDraft={noteDraft}
              onNoteDraftChange={setNoteDraft}
              onAddNote={handleAddNote}
              onToggleNote={toggleNote}
              onDeleteNote={handleDeleteNote}
            />
          )}
          {viewMode === 'stats' && <StatsView stats={stats} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
