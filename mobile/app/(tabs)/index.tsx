import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Dimensions, Modal, ScrollView, Alert, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTimerStore } from '../../stores/timerStore';
import { getPhaseDuration } from '../../lib/phaseDuration';
import { getSessionPlan } from '../../lib/sessionPlan';
import { cancelAllTimerNotifications } from '../../services/notifications';
import { useTaskStore } from '../../stores/taskStore';
import { useAuthStore } from '../../stores/authStore';
import { useAppForeground } from '../../hooks/useAppState';
import { useTheme } from '../../hooks/useTheme';
import { Space, Radius } from '../../constants/spacing';
import { Font } from '../../constants/typography';
import AppPressable from '../../components/AppPressable';

const { width } = Dimensions.get('window');

const STROKE_WIDTH = 8;
const DOT_RADIUS = 5;
const RADIUS = Math.min(width * 0.46, 140);
const SVG_PADDING = 12;
const SIZE = (RADIUS + STROKE_WIDTH / 2 + DOT_RADIUS) * 2 + SVG_PADDING * 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Ring glow ────────────────────────────────────────────────────────────────
// The only glow left on this screen that changes, and the only one carrying
// meaning: it is the timer's status light. Bright while something is counting,
// dim when nothing is. Everything else on the screen stopped emitting light —
// static furniture that glows is decoration, and this screen has to be able to
// disappear during a session.
const RING_GLOW_RUNNING = 0.2;
const RING_GLOW_IDLE = 0.08;
const RING_GLOW_FADE_MS = 420;

// Android ignores shadowOpacity and reads elevation instead, so the same two
// states are expressed on both scales rather than letting one platform lose the
// distinction entirely.
const RING_ELEVATION_RUNNING = 12;
const RING_ELEVATION_IDLE = 5;

function StepperRow({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const Colors = useTheme();
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    }}>
      <Text style={{ color: Colors.text, fontSize: 15 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppPressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: Colors.darkBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="remove" size={18} color={Colors.text} />
        </AppPressable>
        <Text style={{
          color: Colors.textBright,
          fontSize: 18,
          fontWeight: '700',
          marginHorizontal: 16,
          width: 36,
          textAlign: 'center',
        }}>
          {value}
        </Text>
        <AppPressable
          onPress={() => onChange(Math.min(max, value + step))}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: Colors.darkBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={18} color={Colors.text} />
        </AppPressable>
      </View>
    </View>
  );
}

export default function TimerScreen() {
  const Colors = useTheme();
  const status = useTimerStore((s) => s.status);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  const timeLeft = useTimerStore((s) => s.timeLeft);
  const pomodoroRounds = useTimerStore((s) => s.pomodoroRounds);
  const globalSessions = useTimerStore((s) => s.globalSessions);
  const globalTotalTime = useTimerStore((s) => s.globalTotalTime);
  const settings = useTimerStore((s) => s.settings);
  const plannedFocusSeconds = useTimerStore((s) => s.plannedFocusSeconds);
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const skip = useTimerStore((s) => s.skip);
  const tick = useTimerStore((s) => s.tick);
  const setWorkDuration = useTimerStore((s) => s.setWorkDuration);
  const setShortBreakDuration = useTimerStore((s) => s.setShortBreakDuration);
  const setLongBreakDuration = useTimerStore((s) => s.setLongBreakDuration);
  const mode = useTimerStore((s) => s.mode);
  const stopwatchElapsed = useTimerStore((s) => s.stopwatchElapsed);
  const setMode = useTimerStore((s) => s.setMode);
  const startStopwatch = useTimerStore((s) => s.startStopwatch);
  const pauseStopwatch = useTimerStore((s) => s.pauseStopwatch);

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => {
    const userId = useAuthStore.getState().user?.id ?? '';
    useTimerStore.getState().hydrate(userId);
  }, []);

  useAppForeground(() => {
    // Snappy catch-up: a running segment's clock is wall-clock based, so on return
    // recompute timeLeft immediately (and auto-complete if it already hit 0 while
    // backgrounded) instead of waiting up to 1s for the next interval tick.
    if (useTimerStore.getState().status === 'running') {
      useTimerStore.getState().tick();
    }

    const today = new Date().toISOString().split('T')[0];
    const lastDate = useTimerStore.getState().lastSessionDate;
    if (lastDate && lastDate !== today) {
      const userId = useAuthStore.getState().user?.id;
      if (userId) useTimerStore.getState().hydrate(userId);
    }
  });

  // Tracks whether the app was backgrounded at any point during the current
  // running segment. If so, the OS notification is the completion surface and we
  // suppress the on-screen Alert — the Alert is only for fully-foreground runs.
  const backgroundedDuringRunRef = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && useTimerStore.getState().status === 'running') {
        backgroundedDuringRunRef.current = true;
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (status === 'running') {
      // Clear any existing interval before starting a new one — prevents stacking
      // if this effect fires more than once while status is already 'running'.
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        tickRef.current();
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  // Completion alerts — detect transitions via previous-value refs
  const prevStatusRef = useRef(status);
  const prevPhaseRef = useRef(currentPhase);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevPhase = prevPhaseRef.current;

    // A new running segment began — reset the backgrounded tracker so this run
    // starts fresh.
    if (prevStatus !== 'running' && status === 'running') {
      backgroundedDuringRunRef.current = false;
    }

    // Focus session just completed: was running focus, now break idle
    if (prevStatus === 'running' && prevPhase === 'focus' && status === 'break') {
      if (!backgroundedDuringRunRef.current) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Focus Complete! 🎯', 'Great work. Start your break when ready.');
      }
      backgroundedDuringRunRef.current = false;
    }

    // Break just completed: was running a break, now focus idle
    if (prevStatus === 'running' && prevPhase !== 'focus' && status === 'idle' && currentPhase === 'focus') {
      if (!backgroundedDuringRunRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert('Break Over', 'Ready for another focus session?');
      }
      backgroundedDuringRunRef.current = false;
    }

    prevStatusRef.current = status;
    prevPhaseRef.current = currentPhase;
  }, [status, currentPhase]);

  const currentPhaseDuration = getPhaseDuration(currentPhase, settings, plannedFocusSeconds);

  const progress = useSharedValue(currentPhaseDuration > 0 ? timeLeft / currentPhaseDuration : 1);

  useEffect(() => {
    const newProgress = mode === 'stopwatch'
      ? 1
      : (currentPhaseDuration > 0 ? timeLeft / currentPhaseDuration : 1);
    progress.value = withTiming(newProgress, { duration: 400 });
  }, [timeLeft, currentPhaseDuration, mode]);

  const circleProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  const dotProps = useAnimatedProps(() => {
    const angle = progress.value * 2 * Math.PI;
    return {
      cx: CX - RADIUS * Math.sin(angle),
      cy: CY - RADIUS * Math.cos(angle),
    };
  });

  const handleStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    start();
  };

  const handlePause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pause();
  };

  const handleResume = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    resume();
  };

  const handleSkip = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    skip();
  };

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isStopwatch = mode === 'stopwatch';

  // Status light. `isRunning` covers the stopwatch too — it drives the same
  // store status — so counting up and counting down both read as "live".
  const ringGlow = useSharedValue(RING_GLOW_IDLE);
  const ringElevation = useSharedValue(RING_ELEVATION_IDLE);

  useEffect(() => {
    const opts = { duration: RING_GLOW_FADE_MS };
    ringGlow.value = withTiming(isRunning ? RING_GLOW_RUNNING : RING_GLOW_IDLE, opts);
    ringElevation.value = withTiming(
      isRunning ? RING_ELEVATION_RUNNING : RING_ELEVATION_IDLE,
      opts,
    );
  }, [isRunning, ringGlow, ringElevation]);

  const ringGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: ringGlow.value,
    elevation: ringElevation.value,
  }));

  const formatGlobalTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    if (mins >= 1) return `${mins}m`;
    return `${seconds}s`;
  };

  const handleStopwatchStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startStopwatch();
  };

  const handleStopwatchPause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const added = stopwatchElapsed;
    pauseStopwatch();
    if (added > 0) {
      Alert.alert('Focus time saved', `Added ${formatGlobalTime(added)} to your focus time.`);
    }
  };

  const handleStopwatchDiscard = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setMode('stopwatch'); // resets stopwatch to idle / 00:00 without saving
  };

  const phaseLabel = isStopwatch
    ? (isRunning ? 'STOPWATCH' : 'STOPWATCH · READY')
    : currentPhase === 'longBreak'
      ? 'LONG BREAK'
      : currentPhase === 'shortBreak'
      ? 'BREAK'
      : isRunning || isPaused
      ? 'FOCUS'
      : 'READY';

  // Show all dots filled when heading into a long break; otherwise show cycle progress
  const completedDots =
    currentPhase === 'longBreak'
      ? settings.sessionsUntilLong
      : pomodoroRounds % settings.sessionsUntilLong;
  const totalBreakBlocks = settings.sessionsUntilLong;

  // Derived on render, deliberately not stored. The value the running timer
  // uses is frozen separately in timerStore.plannedFocusSeconds; this is only
  // for display, so it is free to recompute when the task or the setting moves.
  const planBlocks = useMemo(() => {
    if (isStopwatch || !selectedTask?.estimatedMinutes) return null;
    const loggedMinutes = Math.round((selectedTask.totalTimeOnTask ?? 0) / 60);
    const remaining = selectedTask.estimatedMinutes - loggedMinutes;
    return getSessionPlan(remaining, Math.round(settings.workDuration / 60));
  }, [isStopwatch, selectedTask, settings.workDuration]);

  const planLabel = useMemo(() => {
    if (!planBlocks || planBlocks.length === 0) return null;
    if (planBlocks.length === 1) return `${planBlocks[0]} min`;
    const allSame = planBlocks.every((b) => b === planBlocks[0]);
    return allSame
      ? `${planBlocks.length} × ${planBlocks[0]} min`
      : `${planBlocks.join(' + ')} min`;
  }, [planBlocks]);

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const seconds = (timeLeft % 60).toString().padStart(2, '0');

  // Stopwatch counts up; show H:MM:SS past an hour, otherwise MM:SS.
  const swDisplay = stopwatchElapsed >= 3600
    ? `${Math.floor(stopwatchElapsed / 3600)}:${String(Math.floor((stopwatchElapsed % 3600) / 60)).padStart(2, '0')}:${String(stopwatchElapsed % 60).padStart(2, '0')}`
    : `${Math.floor(stopwatchElapsed / 60).toString().padStart(2, '0')}:${(stopwatchElapsed % 60).toString().padStart(2, '0')}`;
  const mainDisplay = isStopwatch ? swDisplay : `${minutes}:${seconds}`;

  const [showDurationModal, setShowDurationModal] = useState(false);
  const [draftFocus, setDraftFocus] = useState(0);
  const [draftShort, setDraftShort] = useState(0);
  const [draftLong, setDraftLong] = useState(0);
  const [showTaskPicker, setShowTaskPicker] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.darkBg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 4 }}>

        {/* HEADER */}
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '500', letterSpacing: 0.5 }}>
            Stay focused, stay unstoppable
          </Text>
        </View>

        {/* MAIN TIMER RING */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{
            width: SIZE,
            height: SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: Colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowRadius: 16,
          }, ringGlowStyle]}>
            <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
              <Circle
                cx={CX}
                cy={CY}
                r={RADIUS}
                stroke={Colors.inactive}
                strokeWidth={STROKE_WIDTH}
                fill="none"
              />
              <AnimatedCircle
                cx={CX}
                cy={CY}
                r={RADIUS}
                stroke={Colors.primary}
                strokeWidth={STROKE_WIDTH}
                fill="none"
                strokeDasharray={CIRCUMFERENCE}
                strokeLinecap="round"
                animatedProps={circleProps}
                transform={`
                  translate(${CX}, ${CY})
                  scale(-1, 1)
                  translate(${-CX}, ${-CY})
                  rotate(-90 ${CX} ${CY})
                `}
              />
              {/* Glow under the progress dot. It takes its position from the
                  same dotProps as the dot itself — without that it renders at
                  the SVG's centre, which put a faint green disc behind the time
                  readout and left the dot orbiting with no glow. Drawn first so
                  it sits beneath. */}
              <AnimatedCircle
                r={DOT_RADIUS + 3}
                fill={Colors.accent}
                opacity={0.15}
                animatedProps={dotProps}
              />
              <AnimatedCircle
                r={DOT_RADIUS}
                fill={Colors.accent}
                animatedProps={dotProps}
              />
            </Svg>

            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <Text style={{
                fontSize: isStopwatch && stopwatchElapsed >= 3600 ? 44 : 56,
                fontFamily: Font.display,
                color: Colors.textBright,
                fontVariant: ['tabular-nums'],
                // Space Grotesk's digits already carry the vertical rhythm the
                // old tracking was faking; 2 was pushing them apart.
                letterSpacing: 1,
              }}>
                {mainDisplay}
              </Text>
              <Text style={{
                color: Colors.text,
                fontSize: 12,
                fontWeight: '600',
                letterSpacing: 1,
                marginTop: Space.sm,
              }}>
                {phaseLabel}
              </Text>
            </View>
          </Animated.View>
        </View>

        {/* SEQUENCE ROW — the task plan when one is loaded, else the pomodoro cycle */}
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={planBlocks
            ? `Task plan, block 1 of ${planBlocks.length}, ${planLabel}`
            : `Pomodoro cycle, ${completedDots} of ${totalBreakBlocks} complete`}
          accessibilityValue={{ min: 0, max: planBlocks ? planBlocks.length : totalBreakBlocks, now: planBlocks ? 1 : completedDots }}
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            paddingVertical: 10,
          }}>
          {/* With a plan loaded this row shows THAT plan — one segment per
              remaining block, width proportional to its length — instead of the
              global pomodoro cycle. Two rows answering "how many blocks am I
              doing" with different numbers would be worse than either alone. */}
          {!isStopwatch && planBlocks
            ? planBlocks.map((minutes, i) => {
                const total = planBlocks.reduce((a, b) => a + b, 0);
                const isCurrent = i === 0;
                return (
                  <View
                    key={i}
                    style={{
                      width: Math.max(12, Math.round((minutes / total) * 180)),
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: isCurrent ? Colors.accent : Colors.inactive,
                      marginHorizontal: 3,
                    }}
                  />
                );
              })
            : !isStopwatch && Array.from({ length: totalBreakBlocks }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i < completedDots ? 28 : 20,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i < completedDots ? Colors.accent : Colors.inactive,
                    marginHorizontal: 3,
                  }}
                />
              ))}
        </View>

        {/* CONTROL BUTTONS */}
        <View style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: 8,
        }}>
          <AppPressable
            onPress={isStopwatch ? handleStopwatchDiscard : handleSkip}
            disabled={isStopwatch && stopwatchElapsed === 0 && !isRunning}
            style={{
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: Colors.darkCard,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: Colors.border,
              marginRight: 32,
            }}
          >
            <Ionicons name={isStopwatch ? 'refresh' : 'play-skip-forward'} size={20} color={Colors.text} />
          </AppPressable>

          <View style={{ alignItems: 'center' }}>
            <AppPressable
              onPress={
                isStopwatch
                  ? (isRunning ? handleStopwatchPause : handleStopwatchStart)
                  : (isRunning ? handlePause : isPaused ? handleResume : handleStart)
              }
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: Colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: Colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.25,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <Ionicons
                name={isRunning ? 'pause' : 'play'}
                size={32}
                color="#FFFFFF"
              />
            </AppPressable>
            <Text style={{
              color: Colors.text,
              fontSize: 12,
              fontWeight: '700',
              letterSpacing: 1,
              marginTop: Space.sm,
            }}>
              {isStopwatch
                ? (isRunning ? 'PAUSE & SAVE' : 'START')
                : (isRunning ? 'PAUSE' : isPaused ? 'RESUME' : 'START')}
            </Text>
          </View>

          <AppPressable
            onPress={() => {
              setDraftFocus(Math.round(settings.workDuration / 60));
              setDraftShort(Math.round(settings.shortBreakDuration / 60));
              setDraftLong(Math.round(settings.longBreakDuration / 60));
              setShowDurationModal(true);
            }}
            style={{
              width: 50,
              height: 50,
              borderRadius: 25,
              backgroundColor: Colors.darkCard,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: Colors.border,
              marginLeft: 32,
            }}
          >
            <Ionicons name="timer-outline" size={20} color={Colors.text} />
            {/* A plan is currently overriding this control. Without the marker the
                button silently shows a number the timer is not using. */}
            {planBlocks && (
              <View style={{
                position: 'absolute', top: 8, right: 8,
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: Colors.accent,
              }} />
            )}
          </AppPressable>
        </View>

        {/* TASK CARD */}
        <AppPressable
          onPress={() => setShowTaskPicker(true)}
          accessibilityRole="button"
          scaleOnPress={false}
          style={{
            backgroundColor: Colors.surface,
            borderRadius: Radius.xl,
            borderWidth: 1,
            borderColor: Colors.border,
            padding: Space.lg,
            marginTop: Space.lg,
          }}
        >
          <Text style={{
            color: Colors.text,
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 1,
            marginBottom: Space.xs,
          }}>
            CURRENT TASK
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{
              color: Colors.textBright,
              fontSize: 17,
              fontWeight: '600',
              flex: 1,
            }} numberOfLines={1}>
              {selectedTask?.title || 'Select a task'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.text} style={{ marginLeft: 8 }} />
          </View>

          {/* Say where the duration came from. Without this the timer silently
              changes length between task selections with nothing on screen to
              explain why — which reads as a bug rather than a feature. */}
          {selectedTask && !isStopwatch && (
            <Text
              style={{ color: Colors.text, fontSize: 12, marginTop: Space.sm }}
              numberOfLines={2}
            >
              {planLabel
                ? `From this task’s plan · ${planLabel}`
                : `Your default · ${Math.round(settings.workDuration / 60)} min`}
            </Text>
          )}

          {selectedTask?.estimatedMinutes ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
              <View style={{
                flex: 1,
                height: 6,
                backgroundColor: Colors.inactive,
                borderRadius: 3,
                overflow: 'hidden',
                marginRight: 10,
              }}>
                <View style={{
                  width: `${Math.min((selectedTask.totalTimeOnTask / (selectedTask.estimatedMinutes * 60)) * 100, 100)}%`,
                  height: '100%',
                  backgroundColor: Colors.accent,
                  borderRadius: 3,
                }} />
              </View>
              <Text style={{
                color: Colors.text,
                fontSize: 12,
                fontWeight: '600',
                width: 38,
                textAlign: 'right',
              }}>
                {Math.min(Math.round((selectedTask.totalTimeOnTask / (selectedTask.estimatedMinutes * 60)) * 100), 100)}%
              </Text>
            </View>
          ) : null}
        </AppPressable>

        {/* STATS SECTION */}
        <View style={{
          flexDirection: 'row',
          marginTop: 12,
          marginBottom: 6,
        }}>
          <View style={{
            flex: 1,
            backgroundColor: Colors.darkCard,
            borderRadius: Radius.lg,
            borderWidth: 1,
            borderColor: Colors.border,
            paddingVertical: Space.lg,
            paddingHorizontal: Space.md,
            alignItems: 'center',
            marginRight: 6,
          }}>
            <Text style={{ color: Colors.accent, fontSize: 24, fontWeight: '700' }}>
              {formatGlobalTime(globalTotalTime)}
            </Text>
            <Text style={{
              color: Colors.text,
              fontSize: 12,
              fontWeight: '600',
              letterSpacing: 0.5,
              marginTop: Space.xs,
              textAlign: 'center',
            }}>
              Focus Time Today

            </Text>
          </View>

          <View style={{
            flex: 1,
            backgroundColor: Colors.darkCard,
            borderRadius: Radius.lg,
            borderWidth: 1,
            borderColor: Colors.border,
            paddingVertical: Space.lg,
            paddingHorizontal: Space.md,
            alignItems: 'center',
            marginLeft: 6,
          }}>
            <Text style={{ color: Colors.textBright, fontSize: 24, fontWeight: '700' }}>
              {globalSessions}
            </Text>
            <Text style={{
              color: Colors.text,
              fontSize: 12,
              fontWeight: '600',
              letterSpacing: 0.5,
              marginTop: Space.xs,
              textAlign: 'center',
            }}>
              Sessions Completed
            </Text>
          </View>
        </View>

      </View>

        {/* TASK PICKER MODAL */}
        <Modal visible={showTaskPicker} transparent animationType="slide" onRequestClose={() => setShowTaskPicker(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
            <View style={{
              backgroundColor: Colors.darkCard,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: 40,
              maxHeight: '60%',
            }}>
              <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', marginBottom: 16 }}>
                Select Task
              </Text>

              {tasks.filter((t) => !t.isArchived && !t.isCompleted).length === 0 ? (
                <Text style={{ color: Colors.text, textAlign: 'center', paddingVertical: Space.xxl }}>
                  No tasks available
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 300 }}>
                  {tasks.filter((t) => !t.isArchived && !t.isCompleted).map((task) => {
                    const isSelected = task.id === selectedTaskId;
                    return (
                      <AppPressable
                        key={task.id}
                        onPress={() => {
                          selectTask(task.id);
                          setShowTaskPicker(false);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 14,
                          paddingHorizontal: 4,
                          borderBottomWidth: 1,
                          borderBottomColor: Colors.border,
                          opacity: isSelected ? 1 : 0.8,
                        }}
                      >
                        <Ionicons
                          name={isSelected ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={isSelected ? Colors.accent : Colors.text}
                          style={{ marginRight: 12 }}
                        />
                        <Text style={{
                          color: isSelected ? Colors.textBright : Colors.text,
                          fontSize: 15,
                          fontWeight: isSelected ? '600' : '400',
                          flex: 1,
                        }} numberOfLines={1}>
                          {task.title}
                        </Text>
                        {task.estimatedMinutes ? (
                          <Text style={{ color: Colors.text, fontSize: 12, marginLeft: Space.sm }}>
                            {task.estimatedMinutes}m
                          </Text>
                        ) : null}
                      </AppPressable>
                    );
                  })}
                </ScrollView>
              )}

              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                {selectedTaskId ? (
                  <AppPressable
                    onPress={() => {
                      selectTask(null);
                      setShowTaskPicker(false);
                    }}
                    style={{
                      flex: 1,
                      padding: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: Colors.border,
                      marginRight: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: Colors.text, fontWeight: '600' }}>Deselect</Text>
                  </AppPressable>
                ) : null}
                <AppPressable
                  onPress={() => setShowTaskPicker(false)}
                  style={{
                    flex: selectedTaskId ? 1 : undefined,
                    paddingHorizontal: selectedTaskId ? 14 : 24,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: Colors.darkBg,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: Colors.text, fontWeight: '600' }}>Cancel</Text>
                </AppPressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* DURATION MODAL */}
        <Modal visible={showDurationModal} transparent animationType="slide" onRequestClose={() => setShowDurationModal(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
            <View style={{
              backgroundColor: Colors.darkCard,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: 40,
            }}>
              <Text style={{ color: Colors.textBright, fontSize: 18, fontWeight: '700', marginBottom: 20 }}>
                Timer Duration
              </Text>

              <StepperRow
                label="Focus"
                value={draftFocus}
                min={1}
                max={480}
                step={1}
                onChange={setDraftFocus}
              />
              <StepperRow
                label="Short Break"
                value={draftShort}
                min={1}
                max={480}
                step={1}
                onChange={setDraftShort}
              />
              <StepperRow
                label="Long Break"
                value={draftLong}
                min={1}
                max={480}
                step={1}
                onChange={setDraftLong}
              />

              {/* Mode toggle — switch between the countdown timer and the count-up stopwatch */}
              <AppPressable
                onPress={() => {
                  setMode(isStopwatch ? 'pomodoro' : 'stopwatch');
                  setShowDurationModal(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 8,
                  paddingVertical: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: Colors.primary,
                  backgroundColor: Colors.primaryDim,
                }}
              >
                <Ionicons name={isStopwatch ? 'timer-outline' : 'stopwatch-outline'} size={18} color={Colors.primarySoft} style={{ marginRight: 8 }} />
                <Text style={{ color: Colors.primarySoft, fontWeight: '700' }}>
                  {isStopwatch ? 'Switch to Timer' : 'Switch to Stopwatch'}
                </Text>
              </AppPressable>

              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                <AppPressable
                  onPress={() => setShowDurationModal(false)}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: Colors.border,
                    marginRight: 8,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: Colors.text, fontWeight: '600' }}>Cancel</Text>
                </AppPressable>
                <AppPressable
                  onPress={() => {
                    setWorkDuration(draftFocus);
                    setShortBreakDuration(draftShort);
                    setLongBreakDuration(draftLong);
                    // New durations make any pending notification stale. Cancel it
                    // when not mid-session; a running timer keeps its original alarm.
                    if (useTimerStore.getState().status !== 'running') {
                      cancelAllTimerNotifications();
                    }
                    setShowDurationModal(false);
                  }}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: Colors.primary,
                    marginLeft: 8,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm</Text>
                </AppPressable>
              </View>
            </View>
          </View>
        </Modal>

    </SafeAreaView>
  );
}
