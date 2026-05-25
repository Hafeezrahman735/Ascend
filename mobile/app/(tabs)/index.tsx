import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Dimensions, Modal, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTimerStore } from '../../stores/timerStore';
import { useTaskStore } from '../../stores/taskStore';
import { Colors } from '../../constants/Colors';

const { width } = Dimensions.get('window');

const STROKE_WIDTH = 8;
const DOT_RADIUS = 5;
const RADIUS = Math.min(width * 0.22, 105);
const SVG_PADDING = 12;
const SIZE = (RADIUS + STROKE_WIDTH / 2 + DOT_RADIUS) * 2 + SVG_PADDING * 2;
const CX = SIZE / 2;
const CY = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function StepperRow({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
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
        <TouchableOpacity
          onPress={() => onChange(Math.max(min, value - step))}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: Colors.darkBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="remove" size={18} color={Colors.text} />
        </TouchableOpacity>
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
        <TouchableOpacity
          onPress={() => onChange(Math.min(max, value + step))}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: Colors.darkBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={18} color={Colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TimerScreen() {
  const status = useTimerStore((s) => s.status);
  const currentPhase = useTimerStore((s) => s.currentPhase);
  const timeLeft = useTimerStore((s) => s.timeLeft);
  const pomodoroRounds = useTimerStore((s) => s.pomodoroRounds);
  const globalSessions = useTimerStore((s) => s.globalSessions);
  const globalTotalTime = useTimerStore((s) => s.globalTotalTime);
  const settings = useTimerStore((s) => s.settings);
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const skip = useTimerStore((s) => s.skip);
  const tick = useTimerStore((s) => s.tick);
  const hydrate = useTimerStore((s) => s.hydrate);
  const setWorkDuration = useTimerStore((s) => s.setWorkDuration);
  const setShortBreakDuration = useTimerStore((s) => s.setShortBreakDuration);
  const setLongBreakDuration = useTimerStore((s) => s.setLongBreakDuration);

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (status === 'running') {
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

    // Focus session just completed: was running focus, now break idle
    if (prevStatus === 'running' && prevPhase === 'focus' && status === 'break') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Focus Complete! 🎯', 'Great work. Start your break when ready.');
    }

    // Break just completed: was running a break, now focus idle
    if (prevStatus === 'running' && prevPhase !== 'focus' && status === 'idle' && currentPhase === 'focus') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert('Break Over', 'Ready for another focus session?');
    }

    prevStatusRef.current = status;
    prevPhaseRef.current = currentPhase;
  }, [status, currentPhase]);

  const currentPhaseDuration =
    currentPhase === 'longBreak'
      ? settings.longBreakDuration
      : currentPhase === 'shortBreak'
      ? settings.shortBreakDuration
      : settings.workDuration;

  const progress = useSharedValue(currentPhaseDuration > 0 ? timeLeft / currentPhaseDuration : 1);

  useEffect(() => {
    const newProgress = currentPhaseDuration > 0 ? timeLeft / currentPhaseDuration : 1;
    progress.value = withTiming(newProgress, { duration: 400 });
  }, [timeLeft, currentPhaseDuration]);

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

  const phaseLabel =
    currentPhase === 'longBreak'
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

  const formatGlobalTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${mins}m`;
  };

  const minutes = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const seconds = (timeLeft % 60).toString().padStart(2, '0');

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
          <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '500', letterSpacing: 0.5, opacity: 0.8 }}>
            Stay focused, stay unstoppable
          </Text>
        </View>

        {/* MAIN TIMER RING */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{
            width: SIZE,
            height: SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: Colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.35,
            shadowRadius: 24,
            elevation: 12,
          }}>
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
              <Circle
                cx={CX}
                cy={CY}
                r={DOT_RADIUS + 3}
                fill={Colors.accent}
                opacity={0.15}
              />
              <AnimatedCircle
                r={DOT_RADIUS}
                fill={Colors.accent}
                animatedProps={dotProps}
              />
            </Svg>

            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <Text style={{
                fontSize: 48,
                fontWeight: '700',
                color: Colors.textBright,
                fontVariant: ['tabular-nums'],
                letterSpacing: 2,
              }}>
                {`${minutes}:${seconds}`}
              </Text>
              <Text style={{
                color: Colors.text,
                fontSize: 11,
                fontWeight: '600',
                letterSpacing: 2.5,
                marginTop: 6,
                opacity: 0.7,
              }}>
                {phaseLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* BREAK PROGRESS BLOCKS */}
        <View style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: 10,
        }}>
          {Array.from({ length: totalBreakBlocks }).map((_, i) => (
            <View
              key={i}
              style={{
                width: i < completedDots ? 10 : 8,
                height: i < completedDots ? 10 : 8,
                borderRadius: 5,
                backgroundColor: i < completedDots ? Colors.accent : Colors.inactive,
                marginHorizontal: 5,
                shadowColor: i < completedDots ? Colors.accent : 'transparent',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: i < completedDots ? 0.6 : 0,
                shadowRadius: 6,
                elevation: i < completedDots ? 4 : 0,
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
          <TouchableOpacity
            onPress={handleSkip}
            activeOpacity={0.7}
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
            <Ionicons name="play-skip-forward" size={20} color={Colors.text} />
          </TouchableOpacity>

          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity
              onPress={isRunning ? handlePause : isPaused ? handleResume : handleStart}
              activeOpacity={0.8}
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: Colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: Colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 18,
                elevation: 14,
              }}
            >
              <Ionicons
                name={isRunning ? 'pause' : 'play'}
                size={32}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text style={{
              color: Colors.text,
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 1.8,
              opacity: 0.6,
              marginTop: 6,
            }}>
              {isRunning ? 'PAUSE' : isPaused ? 'RESUME' : 'START'}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => {
              setDraftFocus(Math.round(settings.workDuration / 60));
              setDraftShort(Math.round(settings.shortBreakDuration / 60));
              setDraftLong(Math.round(settings.longBreakDuration / 60));
              setShowDurationModal(true);
            }}
            activeOpacity={0.7}
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
          </TouchableOpacity>
        </View>

        {/* TASK CARD */}
        <TouchableOpacity
          onPress={() => setShowTaskPicker(true)}
          activeOpacity={0.7}
          style={{
            backgroundColor: 'rgba(16, 16, 58, 0.75)',
            borderRadius: 22,
            borderWidth: 1,
            borderColor: Colors.border,
            padding: 16,
            marginTop: 14,
            shadowColor: Colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.1,
            shadowRadius: 14,
            elevation: 4,
          }}
        >
          <Text style={{
            color: Colors.text,
            fontSize: 9,
            fontWeight: '700',
            letterSpacing: 1.8,
            opacity: 0.5,
            marginBottom: 4,
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
        </TouchableOpacity>

        {/* STATS SECTION */}
        <View style={{
          flexDirection: 'row',
          marginTop: 12,
          marginBottom: 6,
        }}>
          <View style={{
            flex: 1,
            backgroundColor: Colors.darkCard,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: Colors.border,
            paddingVertical: 16,
            paddingHorizontal: 12,
            alignItems: 'center',
            marginRight: 6,
          }}>
            <Text style={{ color: Colors.accent, fontSize: 24, fontWeight: '700' }}>
              {formatGlobalTime(globalTotalTime)}
            </Text>
            <Text style={{
              color: Colors.text,
              fontSize: 9,
              fontWeight: '600',
              letterSpacing: 0.5,
              opacity: 0.5,
              marginTop: 4,
              textAlign: 'center',
            }}>
              Focus Time Today
              
            </Text>
          </View>

          <View style={{
            flex: 1,
            backgroundColor: Colors.darkCard,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: Colors.border,
            paddingVertical: 16,
            paddingHorizontal: 12,
            alignItems: 'center',
            marginLeft: 6,
          }}>
            <Text style={{ color: Colors.textBright, fontSize: 24, fontWeight: '700' }}>
              {globalSessions}
            </Text>
            <Text style={{
              color: Colors.text,
              fontSize: 9,
              fontWeight: '600',
              letterSpacing: 0.5,
              opacity: 0.5,
              marginTop: 4,
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
                <Text style={{ color: Colors.text, opacity: 0.5, textAlign: 'center', paddingVertical: 24 }}>
                  No tasks available
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 300 }}>
                  {tasks.filter((t) => !t.isArchived && !t.isCompleted).map((task) => {
                    const isSelected = task.id === selectedTaskId;
                    return (
                      <TouchableOpacity
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
                          <Text style={{ color: Colors.text, fontSize: 12, opacity: 0.5, marginLeft: 8 }}>
                            {task.estimatedMinutes}m
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={{ flexDirection: 'row', marginTop: 16 }}>
                {selectedTaskId ? (
                  <TouchableOpacity
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
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
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
                </TouchableOpacity>
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

              <View style={{ flexDirection: 'row', marginTop: 24 }}>
                <TouchableOpacity
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
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setWorkDuration(draftFocus);
                    setShortBreakDuration(draftShort);
                    setLongBreakDuration(draftLong);
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
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

    </SafeAreaView>
  );
}
