import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import type { CalendarItem, Note, TaskGoal } from '../../types';
import { formatDeadlineLabel, parseLocalDate } from '../../utils/date';
import {
  getCalendarStyles, formatMinutes, formatSeconds, itemTimeRange, itemTitle, itemIsDone,
  isPastEvent, calendarItemKey, typeColor,
} from './shared';

/**
 * The calendar's shared list pieces: one item row, and day rows that fold open.
 *
 * Plan's "rest of the week" and Week's day lanes are the same control with a
 * different strip across the top (a load bar on Plan, a time track on Week), so
 * both are built from DayRowList; Day's Anytime and notes lists use the same
 * CalendarItemRow. One row, one rule for taps (eng review D1, D5, D10):
 *
 *   event / task / recurring task  → tap opens its sheet
 *   to-do note                     → checkbox ticks it, the text opens the sheet
 *   plain note                     → tap opens the sheet
 *   goal deadline / Google / Apple → not tappable (no sheet to open here)
 */

/** How long a just-saved task's row stays tinted (design DR3). */
const HIGHLIGHT_MS = 1500;
const HIGHLIGHT_FADE_MS = 400;
/** The checkbox's own hit area: 44pt tall, wider than the glyph. */
const CHECKBOX_HIT = { width: 36, minHeight: 44 } as const;

/** A task just saved from the calendar: its day row opens and its row tints. */
export interface PlanHighlight {
  date: string;
  taskId: string;
}

export function dayName(dateKey: string, style: 'short' | 'long' = 'short'): string {
  return parseLocalDate(dateKey).toLocaleDateString(undefined, style === 'short'
    ? { weekday: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric' });
}

export function hoursLabel(minutes: number): string {
  return formatSeconds(minutes * 60);
}

/** Whether a tap on this item opens a sheet (events, notes and tasks do). */
function opensSheet(item: CalendarItem): boolean {
  return item.type === 'event' || item.type === 'note' || item.type === 'task' || item.type === 'habit_instance';
}

function itemKindLabel(item: CalendarItem): string {
  switch (item.type) {
    case 'note': return (item.data as Note).isTodo ? 'To-do' : 'Note';
    case 'habit_instance': return 'Recurring task';
    case 'task': return 'Task';
    case 'goal_deadline': return 'Goal deadline';
    default: return 'Event';
  }
}

/**
 * The right-hand label: when it starts if it has a time, otherwise whatever is
 * worth saying — all-day for an event, how long is left for a goal deadline.
 */
function itemMeta(item: CalendarItem): string | null {
  const range = itemTimeRange(item);
  if (range) return formatMinutes(range.start);
  if (item.type === 'event' || item.type === 'external_google' || item.type === 'external_apple') return 'All day';
  if (item.type === 'goal_deadline') return formatDeadlineLabel((item.data as TaskGoal).deadline);
  return null;
}

/** A row tinted for a moment after its task was just saved here (DR3). */
function HighlightTint({ active }: { active: boolean }) {
  const Colors = useTheme();
  // Lazy state, not a ref: the value is created once and read during render.
  const [opacity] = useState(() => new Animated.Value(active ? 1 : 0));
  useEffect(() => {
    if (!active) return;
    opacity.setValue(1);
    const anim = Animated.timing(opacity, {
      toValue: 0, duration: HIGHLIGHT_FADE_MS, delay: HIGHLIGHT_MS - HIGHLIGHT_FADE_MS,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [active, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: 0, bottom: 0, left: -6, right: -6,
        borderRadius: 8, backgroundColor: Colors.primaryDim, opacity,
      }}
    />
  );
}

/** One calendar entry, identical on Plan, Week and Day. */
export function CalendarItemRow({ item, onPress, onToggleNote, highlighted = false, trailing }: {
  item: CalendarItem;
  /** Opens the item's sheet. Only called for items that have one. */
  onPress: (item: CalendarItem) => void;
  /** Ticks a to-do note. */
  onToggleNote: (note: Note) => void;
  highlighted?: boolean;
  /** Extra figure before the meta, e.g. a task's "52m/1h30" on Week. */
  trailing?: string | null;
}) {
  const Colors = useTheme();
  const styles = useMemo(() => getCalendarStyles(Colors), [Colors]);
  const done = itemIsDone(item);
  const past = isPastEvent(item, new Date());
  const meta = itemMeta(item);
  const note = item.type === 'note' ? (item.data as Note) : null;
  const label = `${itemKindLabel(item)}: ${itemTitle(item)}${meta ? `, ${meta}` : ''}${trailing ? `, ${trailing} focused` : ''}${done ? ', done' : ''}${past ? ', past' : ''}`;

  const text = (
    <>
      {!note?.isTodo && <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: typeColor(item.type, Colors), minHeight: 16 }} />}
      <Text
        style={{ flex: 1, fontSize: 13, color: done ? Colors.subtext : Colors.text, textDecorationLine: done ? 'line-through' : 'none' }}
        numberOfLines={2}
      >
        {itemTitle(item)}
      </Text>
      {item.type === 'habit_instance' && <Ionicons name="repeat" size={12} color={Colors.subtext} />}
      {trailing ? <Text style={{ fontSize: 11, color: Colors.primarySoft, fontVariant: ['tabular-nums'] }}>{trailing}</Text> : null}
      {meta ? <Text style={{ fontSize: 11, color: Colors.subtext }}>{meta}</Text> : null}
    </>
  );
  const rowStyle = [styles.itemRow, { minHeight: 44 }, past && { opacity: 0.55 }];

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <HighlightTint active={highlighted} />
      {note?.isTodo && (
        <TouchableOpacity
          onPress={() => onToggleNote(note)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: note.isCompleted }}
          accessibilityLabel={`${note.isCompleted ? 'Untick' : 'Tick'} ${note.content.slice(0, 60)}`}
          style={[CHECKBOX_HIT, { justifyContent: 'center' }]}
        >
          <Ionicons
            name={note.isCompleted ? 'checkbox' : 'square-outline'}
            size={18}
            color={note.isCompleted ? Colors.accent : Colors.subtext}
          />
        </TouchableOpacity>
      )}
      {opensSheet(item) ? (
        <TouchableOpacity
          onPress={() => onPress(item)}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[rowStyle, { flex: 1 }]}
        >
          {text}
        </TouchableOpacity>
      ) : (
        <View style={[rowStyle, { flex: 1 }]} accessible accessibilityLabel={label}>{text}</View>
      )}
    </View>
  );
}

/** What a day row needs: its day and everything on it. */
export interface DayRowData {
  key: string;
  items: CalendarItem[];
}

interface DayRowProps<R extends DayRowData> {
  row: R;
  expanded: boolean;
  expandable: boolean;
  onToggle: () => void;
  onItemPress: (item: CalendarItem) => void;
  onToggleNote: (note: Note) => void;
  onOpenDay: (date: string) => void;
  highlight: PlanHighlight | null;
  renderSummary: (row: R) => ReactNode;
  a11ySummary: (row: R) => string;
  renderExpandedHeader?: (row: R) => ReactNode;
  itemTrailing?: (item: CalendarItem, row: R) => string | null;
  expandedIndent: number;
}

function DayRow<R extends DayRowData>({
  row, expanded, expandable, onToggle, onItemPress, onToggleNote, onOpenDay, highlight,
  renderSummary, a11ySummary, renderExpandedHeader, itemTrailing, expandedIndent,
}: DayRowProps<R>) {
  const Colors = useTheme();
  const [turn] = useState(() => new Animated.Value(expanded ? 1 : 0));
  useEffect(() => {
    Animated.timing(turn, { toValue: expanded ? 1 : 0, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [expanded, turn]);
  const rotate = useMemo(
    () => turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }),
    [turn],
  );

  const header = (
    <>
      {renderSummary(row)}
      <Animated.View style={{ width: 14, alignItems: 'center', transform: [{ rotate }], opacity: expandable ? 1 : 0 }}>
        <Ionicons name="chevron-forward" size={13} color={Colors.subtext} />
      </Animated.View>
    </>
  );
  const headerStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 48 };

  return (
    <View>
      {expandable ? (
        <TouchableOpacity
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${a11ySummary(row)}, ${expanded ? 'expanded' : 'collapsed'}`}
          style={headerStyle}
        >
          {header}
        </TouchableOpacity>
      ) : (
        <View accessible accessibilityLabel={`${a11ySummary(row)}, nothing on this day`} style={[headerStyle, { opacity: 0.6 }]}>
          {header}
        </View>
      )}
      {expanded && expandable && (
        <View style={{ paddingLeft: expandedIndent, paddingBottom: 6 }}>
          {renderExpandedHeader?.(row)}
          {row.items.map((item) => (
            <CalendarItemRow
              key={calendarItemKey(item)}
              item={item}
              onPress={onItemPress}
              onToggleNote={onToggleNote}
              trailing={itemTrailing?.(item, row) ?? null}
              highlighted={!!highlight && highlight.date === row.key && (item.data as { id?: string }).id === highlight.taskId}
            />
          ))}
          <TouchableOpacity
            onPress={() => onOpenDay(row.key)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${dayName(row.key, 'long')} in Day view`}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: Colors.primarySoft, fontSize: 12, fontWeight: '700' }}>Open day ›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/**
 * Day rows that fold open. Every row starts folded (DR9); a save highlight
 * opens its own day (DR3). The parent keys this by week so each week starts
 * fresh.
 */
export function DayRowList<R extends DayRowData>({
  rows, highlight, onItemPress, onToggleNote, onOpenDay, renderSummary, a11ySummary,
  renderExpandedHeader, itemTrailing, isExpandable = (row) => row.items.length > 0, expandedIndent = 12,
}: {
  rows: R[];
  highlight: PlanHighlight | null;
  onItemPress: (item: CalendarItem) => void;
  onToggleNote: (note: Note) => void;
  onOpenDay: (date: string) => void;
  /** The strip across the folded row, left of the chevron. */
  renderSummary: (row: R) => ReactNode;
  /** What a screen reader says for the folded row, before "expanded/collapsed". */
  a11ySummary: (row: R) => string;
  /** Shown above the items when the row is open. */
  renderExpandedHeader?: (row: R) => ReactNode;
  /** A figure for an item's row, e.g. its focus. */
  itemTrailing?: (item: CalendarItem, row: R) => string | null;
  /** Defaults to "has items"; Week also opens a day that has only focus. */
  isExpandable?: (row: R) => boolean;
  /** Left inset of the open row's items, to line up under the strip. */
  expandedIndent?: number;
}) {
  const Colors = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Adjusted during render rather than in an effect: a new highlight opens its
  // day once, and the user can still collapse it afterwards.
  const [seenHighlight, setSeenHighlight] = useState<PlanHighlight | null>(null);
  if (highlight && highlight !== seenHighlight) {
    setSeenHighlight(highlight);
    if (rows.some((r) => r.key === highlight.date)) {
      setExpanded((prev) => new Set(prev).add(highlight.date));
    }
  }
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <>
      {rows.map((row, i) => (
        <View key={row.key} style={i > 0 ? { borderTopWidth: 1, borderTopColor: Colors.border } : null}>
          <DayRow
            row={row}
            expanded={expanded.has(row.key)}
            expandable={isExpandable(row)}
            onToggle={() => toggle(row.key)}
            onItemPress={onItemPress}
            onToggleNote={onToggleNote}
            onOpenDay={onOpenDay}
            highlight={highlight}
            renderSummary={renderSummary}
            a11ySummary={a11ySummary}
            renderExpandedHeader={renderExpandedHeader}
            itemTrailing={itemTrailing}
            expandedIndent={expandedIndent}
          />
        </View>
      ))}
    </>
  );
}
