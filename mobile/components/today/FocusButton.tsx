/**
 * The full-width Focus button on Today (design DD2, DD6, DD7, eng R4).
 *
 * What it says comes from lib/startFocusTarget; what a tap does is the caller's.
 * Its own job is the live time in the session and break states, and that is
 * why it is a separate component:
 *
 *  - the time is derived from the timer's wall-clock anchors (startedAt and
 *    elapsedAtPause) on this component's own one-second interval. The store's
 *    `timeLeft` only advances while the Focus screen is mounted, which it is
 *    not after a cold relaunch that restored a session onto Today;
 *  - the per-second re-render stays inside this button instead of the whole
 *    Today screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useTimerStore } from '../../stores/timerStore';
import { useTheme } from '../../hooks/useTheme';
import { Font } from '../../constants/typography';
import { elapsedInPhase, getPhaseDuration } from '../../lib/phaseDuration';
import { formatClock } from '../../lib/clock';
import type { FocusButtonState } from '../../lib/startFocusTarget';

const HEIGHT = 52;
const TICK_MS = 1000;

/** Seconds shown in the session (elapsed) and break (left) states. */
function useLiveSeconds(state: FocusButtonState): number {
  const anchors = useTimerStore(
    useShallow((s) => ({
      startedAt: s.startedAt,
      elapsedAtPause: s.elapsedAtPause,
      phase: s.currentPhase,
      settings: s.settings,
      plannedFocusSeconds: s.plannedFocusSeconds,
      mode: s.mode,
    })),
  );
  const [now, setNow] = useState(() => Date.now());
  const ticking = (state.kind === 'session' || state.kind === 'break') && state.status === 'running';

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);

  const elapsed = elapsedInPhase(anchors.elapsedAtPause, anchors.startedAt, now);
  if (anchors.mode === 'stopwatch') return elapsed;
  const duration = getPhaseDuration(anchors.phase, anchors.settings, anchors.plannedFocusSeconds);
  return state.kind === 'break' ? Math.max(0, duration - elapsed) : Math.min(elapsed, duration);
}

function describe(state: FocusButtonState, seconds: number): { label: string; a11y: string } {
  const minutes = Math.floor(seconds / 60);
  switch (state.kind) {
    case 'target':
      return { label: `Focus on: ${state.title}`, a11y: `Focus on ${state.title}` };
    case 'addFirstTask':
      return { label: '+ Add your first task', a11y: 'Add your first task' };
    case 'openTimer':
      return { label: 'Open focus timer', a11y: 'Open focus timer' };
    case 'session':
      if (state.status === 'paused') {
        return {
          label: state.taskTitle ? `Resume · ${state.taskTitle}` : 'Resume',
          a11y: 'Resume, paused',
        };
      }
      return {
        label: state.taskTitle ? `Back to focus · ${state.taskTitle}` : 'Back to focus',
        a11y: `Back to focus, session running, ${minutes} minutes`,
      };
    case 'break':
      return { label: 'On a break', a11y: `On a break, ${minutes} minutes left` };
    case 'loading':
      return { label: '', a11y: 'Loading tasks' };
  }
}

export function FocusButton({ state, onPress }: { state: FocusButtonState; onPress: () => void }) {
  const Colors = useTheme();
  const seconds = useLiveSeconds(state);
  // One line, truncated (DD2); two once Dynamic Type makes one line too tight (DD12).
  const { fontScale } = useWindowDimensions();

  if (state.kind === 'loading') {
    return (
      <View
        accessible
        accessibilityLabel="Loading tasks"
        style={{ minHeight: HEIGHT, borderRadius: 14, backgroundColor: Colors.raised }}
      />
    );
  }

  const { label, a11y } = describe(state, seconds);
  const live = state.kind === 'session' || state.kind === 'break';
  const outlined = (state.kind === 'session' && state.status === 'paused') || state.kind === 'break';
  const filledColor = state.kind === 'session' ? Colors.accent : Colors.primary;
  const textColor = outlined ? Colors.accent : state.kind === 'session' ? Colors.bg : '#fff';
  const showTime = live && !(state.kind === 'session' && state.status === 'paused');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        minHeight: HEIGHT,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: outlined ? 'transparent' : filledColor,
        borderWidth: outlined ? 1.5 : 0,
        borderColor: Colors.accent,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {state.kind === 'target' && <Ionicons name="play" size={16} color={textColor} />}
      <Text
        numberOfLines={fontScale > 1.3 ? 2 : 1}
        style={{ flexShrink: 1, color: textColor, fontSize: 15, fontWeight: '700', textAlign: 'center' }}
      >
        {label}
      </Text>
      {showTime && (
        <Text style={{ color: textColor, fontFamily: Font.monoMedium, fontSize: 15 }}>
          {`· ${formatClock(seconds)}`}
        </Text>
      )}
    </Pressable>
  );
}
