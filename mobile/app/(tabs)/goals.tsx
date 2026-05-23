import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { api } from '../../services/api';
import { GoalProgressResponse, Session, Task } from '../../types';
import { Colors } from '../../constants/Colors';
import { useTasksList, useTaskActions, useTasksLoading, useLiveTotalFocusMinutes } from '../../store/hooks';
import { useGamification } from '../../store/hooks';
import { xpForLevel, xpForNextLevel } from '../../lib/xp';
import LevelBadge from '../../components/LevelBadge';
import XPBar from '../../components/XPBar';
import AchievementCard from '../../components/AchievementCard';
import { tagColor } from '../../utils/tag';
import { calcDaysUntilDue } from '../../store/selectors/tasks';

function formatSecondsShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

function TaskForm({
  task, onSave, onClose, onDelete,
}: {
  task: Task | null;
  onSave: (data: { title: string; description?: string; dueDate?: string; tags: string[]; estimatedMinutes?: number }) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(task?.tags || []);
  const [estimatedMinutes, setEstimatedMinutes] = useState(task?.estimatedMinutes || 0);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && tags.length < 10 && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate: dueDate || undefined,
      tags,
      estimatedMinutes: estimatedMinutes > 0 ? estimatedMinutes : undefined,
    });
  };

  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerValue = dueDate ? new Date(dueDate + 'T00:00:00') : new Date();

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      setDueDate(`${y}-${m}-${d}`);
    }
  };

  const formatDisplayDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', options);
  };

  return (
    <View className="flex-1 p-6">
      <View className="flex-row items-center justify-between mb-6">
        <Text className="text-light-text dark:text-dark-text text-lg font-bold">
          {task ? 'Edit Task' : 'New Task'}
        </Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color={Colors.lightSubtext} />
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-1">Title *</Text>
        <TextInput
          className="bg-light-card dark:bg-dark-card rounded-xl px-4 py-3 text-light-text dark:text-dark-text mb-4"
          placeholder="What's the task?"
          placeholderTextColor="#666"
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />

        <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-1">Description</Text>
        <TextInput
          className="bg-light-card dark:bg-dark-card rounded-xl px-4 py-3 text-light-text dark:text-dark-text mb-4"
          placeholder="Optional description"
          placeholderTextColor="#666"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-2">Due Date</Text>
        <TouchableOpacity
          className="flex-row items-center justify-between bg-light-card dark:bg-dark-card rounded-xl px-4 py-3 mb-4"
          onPress={() => setShowDatePicker(true)}
        >
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={18} color={dueDate ? Colors.primary : Colors.lightSubtext} />
            <Text className={`ml-2 ${dueDate ? 'text-light-text dark:text-dark-text' : 'text-light-subtext dark:text-dark-subtext'}`}>
              {dueDate ? formatDisplayDate(dueDate) : 'Set due date'}
            </Text>
          </View>
          {dueDate && (
            <TouchableOpacity onPress={() => setDueDate('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={Colors.lightSubtext} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        {showDatePicker && (
          <DateTimePicker
            value={datePickerValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={handleDateChange}
            minimumDate={new Date()}
          />
        )}
        {showDatePicker && Platform.OS === 'ios' && (
          <TouchableOpacity
            className="bg-primary py-2 rounded-xl items-center mb-4"
            onPress={() => setShowDatePicker(false)}
          >
            <Text className="text-white font-bold text-sm">Done</Text>
          </TouchableOpacity>
        )}

        <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-1">Tags</Text>
        <TextInput
          className="bg-light-card dark:bg-dark-card rounded-xl px-4 py-3 text-light-text dark:text-dark-text mb-2"
          placeholder="Type a tag and press enter or comma"
          placeholderTextColor="#666"
          value={tagInput}
          onChangeText={(text) => {
            if (text.endsWith(',') || text.endsWith('\n')) {
              handleAddTag();
            } else {
              setTagInput(text);
            }
          }}
          onSubmitEditing={handleAddTag}
          blurOnSubmit={false}
        />
        {tags.length > 0 && (
          <View className="flex-row flex-wrap mb-4">
            {tags.map((tag) => (
              <TouchableOpacity
                key={tag}
                className="flex-row items-center px-2.5 py-1 rounded-full mr-2 mb-2"
                style={{ backgroundColor: tagColor(tag) + '30' }}
                onPress={() => handleRemoveTag(tag)}
              >
                <Text className="text-xs mr-1" style={{ color: tagColor(tag) }}>{tag}</Text>
                <Ionicons name="close-circle" size={14} color={tagColor(tag)} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-2">Estimated focus time</Text>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity
            className="w-8 h-8 rounded-full bg-light-card dark:bg-dark-card items-center justify-center"
            onPress={() => setEstimatedMinutes(Math.max(0, estimatedMinutes - 5))}
            style={{ opacity: estimatedMinutes <= 0 ? 0.3 : 1 }}
            disabled={estimatedMinutes <= 0}
          >
            <Text className="text-light-text dark:text-dark-text text-lg font-bold">−</Text>
          </TouchableOpacity>
          <Text className="text-light-text dark:text-dark-text text-base font-bold w-24 text-center">
            {estimatedMinutes > 0 ? `${estimatedMinutes} min` : 'not set'}
          </Text>
          <TouchableOpacity
            className="w-8 h-8 rounded-full bg-light-card dark:bg-dark-card items-center justify-center"
            onPress={() => setEstimatedMinutes(Math.min(240, estimatedMinutes + 5))}
            style={{ opacity: estimatedMinutes >= 240 ? 0.3 : 1 }}
            disabled={estimatedMinutes >= 240}
          >
            <Text className="text-light-text dark:text-dark-text text-lg font-bold">+</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View className="flex-row space-x-3">
        {task && onDelete && (
          <TouchableOpacity
            className="flex-1 py-3 rounded-xl items-center"
            style={{ backgroundColor: '#FF6B6B30' }}
            onPress={onDelete}
          >
            <Text className="text-error font-bold">Delete</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: title.trim() ? Colors.primary : '#333' }}
          onPress={handleSave}
          disabled={!title.trim()}
        >
          <Text className="text-white font-bold">Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TaskDetail({ task, onEdit, onClose }: { task: Task; onEdit: () => void; onClose: () => void }) {
  const daysWorked = new Set(task.sessionDates).size;
  const progress = task.estimatedMinutes
    ? Math.min(1, task.totalTimeOnTask / (task.estimatedMinutes * 60))
    : null;
  const progressPct = progress !== null ? Math.round(progress * 100) : null;

  return (
    <View className="flex-1 p-6">
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-1">
          <Text className="text-light-text dark:text-dark-text text-lg font-bold">{task.title}</Text>
          {task.tags && task.tags.length > 0 && (
            <View className="flex-row flex-wrap mt-1">
              {task.tags.map((tag) => (
                <View key={tag} className="px-2 py-0.5 rounded-full mr-1.5 mb-1" style={{ backgroundColor: tagColor(tag) + '30' }}>
                  <Text className="text-xs" style={{ color: tagColor(tag) }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color={Colors.lightSubtext} />
        </TouchableOpacity>
      </View>

      {task.dueDate && (
        <Text className={`text-xs mb-4 ${new Date(task.dueDate) < new Date() ? 'text-error' : 'text-light-subtext dark:text-dark-subtext'}`}>
          {new Date(task.dueDate) < new Date() ? 'Overdue: ' : 'Due '}{formatDate(task.dueDate)}
        </Text>
      )}

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Progress bar */}
        {progress !== null && (
          <View className="mb-4">
            <View className="flex-row justify-between mb-1">
              <Text className="text-light-subtext dark:text-dark-subtext text-xs">Progress</Text>
              <Text className="text-light-accent dark:text-accent text-xs font-bold">{progressPct!}%</Text>
            </View>
            <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: Colors.inactive }}>
              <View className="h-full rounded-full" style={{ width: `${progressPct!}%`, backgroundColor: Colors.accent }} />
            </View>
          </View>
        )}

        {/* Stats grid */}
        <View className="flex-row mb-4">
          <View className="flex-1 bg-light-card dark:bg-dark-card rounded-xl p-3 mr-2 items-center">
            <Text className="text-light-text dark:text-dark-text text-sm font-bold">{task.sessionsOnTask}</Text>
            <Text className="text-light-subtext dark:text-dark-subtext text-xs mt-1">Sessions</Text>
          </View>
          <View className="flex-1 bg-light-card dark:bg-dark-card rounded-xl p-3 mr-2 items-center">
            <Text className="text-light-text dark:text-dark-text text-sm font-bold">{formatSecondsShort(task.totalTimeOnTask)}</Text>
            <Text className="text-light-subtext dark:text-dark-subtext text-xs mt-1">Focus Time</Text>
          </View>
          <View className="flex-1 bg-light-card dark:bg-dark-card rounded-xl p-3 mr-2 items-center">
            <Text className="text-light-text dark:text-dark-text text-sm font-bold">{daysWorked}</Text>
            <Text className="text-light-subtext dark:text-dark-subtext text-xs mt-1">Days</Text>
          </View>
          <View className="flex-1 bg-light-card dark:bg-dark-card rounded-xl p-3 items-center">
            <Text className="text-light-text dark:text-dark-text text-sm font-bold">
              {task.dueDate ? calcDaysUntilDue(task) ?? '-' : '-'}
            </Text>
            <Text className="text-light-subtext dark:text-dark-subtext text-xs mt-1">Left</Text>
          </View>
        </View>

        {/* Estimation Accuracy */}
        {task.estimationAccuracy != null && task.estimatedMinutes && (
          <View className="bg-light-card dark:bg-dark-card rounded-xl p-4 mb-4">
            <Text className="text-light-text dark:text-dark-text text-sm">
              You estimated {task.estimatedMinutes}m — actual time is {formatSecondsShort(task.totalTimeOnTask)} ({task.estimationAccuracy}% accuracy)
            </Text>
          </View>
        )}

        {/* Session Dates */}
        {task.sessionDates.length > 0 && (
          <View className="bg-light-card dark:bg-dark-card rounded-xl p-4 mb-4">
            <Text className="text-light-subtext dark:text-dark-subtext text-xs mb-2">Session Dates</Text>
            <View className="flex-row flex-wrap gap-1">
              {[...new Set(task.sessionDates)].sort().reverse().map((d) => (
                <View key={d} className="px-2 py-1 rounded-md" style={{ backgroundColor: Colors.primaryDim + '40' }}>
                  <Text className="text-xs" style={{ color: Colors.primarySoft }}>{d}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        className="py-3 rounded-xl items-center mt-2"
        style={{ backgroundColor: Colors.primary }}
        onPress={onEdit}
      >
        <Text className="text-white font-bold">Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function GoalsScreen() {
  const [progress, setProgress] = useState<GoalProgressResponse | null>(null);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [achievementTab, setAchievementTab] = useState<'unlocked' | 'locked'>('unlocked');

  const tasks = useTasksList();
  const taskActions = useTaskActions();
  const isTasksLoading = useTasksLoading();
  const gamification = useGamification();
  const liveTotalFocusMinutes = useLiveTotalFocusMinutes();

  const [showTaskSheet, setShowTaskSheet] = useState(false);
  const [taskSheetMode, setTaskSheetMode] = useState<'create' | 'edit' | 'view'>('create');
  const [selectedSheetTask, setSelectedSheetTask] = useState<Task | null>(null);

  useEffect(() => {
    loadData();
    taskActions.fetchTasks();
    gamification.fetchProfile();
    gamification.fetchAchievements();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [progressRes] = await Promise.all([
        api.get<GoalProgressResponse>('/goals/progress'),
      ]);
      if (progressRes.success && progressRes.data) {
        setProgress(progressRes.data);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setSelectedSheetTask(null);
    setTaskSheetMode('create');
    setShowTaskSheet(true);
  };

  const openView = (task: Task) => {
    setSelectedSheetTask(task);
    setTaskSheetMode('view');
    setShowTaskSheet(true);
  };

  const openEdit = () => {
    setTaskSheetMode('edit');
  };

  const handleSave = async (data: { title: string; description?: string; dueDate?: string; tags: string[]; estimatedMinutes?: number }) => {
    setShowTaskSheet(false);
    setSelectedSheetTask(null);
    if (taskSheetMode === 'create') {
      await taskActions.createTask(data);
    } else if (selectedSheetTask) {
      await taskActions.updateTask(selectedSheetTask.id, data);
    }
  };

  const handleDelete = () => {
    if (!selectedSheetTask) return;
    Alert.alert('Delete Task', 'Are you sure you want to delete this task?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await taskActions.deleteTask(selectedSheetTask.id);
          setShowTaskSheet(false);
          setSelectedSheetTask(null);
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center">
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  const dailyProgress = progress?.daily;
  const weeklyProgress = progress?.weekly;
  const streak = progress?.streak;

  const dailyPercent = dailyProgress?.targetCount
    ? Math.min((dailyProgress?.progress || 0) / dailyProgress.targetCount, 1)
    : 0;

  return (
    <SafeAreaView className="flex-1 bg-light-bg dark:bg-dark-bg">
      <View className="px-6 py-4">
        <Text className="text-2xl font-bold text-light-text dark:text-dark-text">Goals</Text>
      </View>

      <FlatList
        data={[]}
        keyExtractor={(_item, index) => index.toString()}
        ListHeaderComponent={
          <View className="px-6 space-y-4">
            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-light-text dark:text-dark-text font-bold">Today's Goal</Text>
                <Ionicons name="today-outline" size={20} color={Colors.primary} />
              </View>

              <View className="flex-row items-center">
                <View className="w-20 h-20 rounded-full border-4 items-center justify-center" style={{ borderColor: Colors.primary }}>
                  <Text className="text-light-text dark:text-dark-text text-xl font-bold">
                    {dailyProgress?.sessionsCompleted || 0}
                  </Text>
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-light-text dark:text-dark-text text-lg font-bold">
                    {dailyProgress?.targetCount
                      ? `${dailyProgress.progress || 0} / ${dailyProgress.targetCount} Pomodoros`
                      : `${dailyProgress?.sessionsCompleted || 0} Pomodoros`}
                  </Text>
                  <View className="h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${dailyPercent * 100}%`,
                        backgroundColor: Colors.primary,
                      }}
                    />
                  </View>
                </View>
              </View>
            </View>

            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-light-text dark:text-dark-text font-bold">This Week</Text>
                <Ionicons name="calendar-outline" size={20} color={Colors.accent} />
              </View>
              <View className="flex-row justify-between">
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Sessions</Text>
                  <Text className="text-light-text dark:text-dark-text text-xl font-bold">
                    {weeklyProgress?.sessionsCompleted || 0}
                  </Text>
                </View>
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Focus Hours</Text>
                  <Text className="text-light-text dark:text-dark-text text-xl font-bold">
                    {weeklyProgress?.focusHours || 0}h
                  </Text>
                </View>
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Target</Text>
                  <Text className="text-light-text dark:text-dark-text text-xl font-bold">
                    {weeklyProgress?.targetHours || '-'}h
                  </Text>
                </View>
              </View>
            </View>

            {/* XP & LEVEL SECTION */}
            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-light-text dark:text-dark-text font-bold">Progress</Text>
                <Ionicons name="trending-up" size={20} color="#A855F7" />
              </View>
              <View className="flex-row items-center mb-3">
                <LevelBadge level={gamification.level} size="md" />
                <View className="ml-4 flex-1">
                  <XPBar
                    currentXP={gamification.xp}
                    xpForCurrent={xpForLevel(gamification.level)}
                    xpForNext={xpForNextLevel(gamification.xp)}
                    level={gamification.level}
                    height={10}
                  />
                </View>
              </View>
              <View className="flex-row justify-between mt-2">
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-xs">Sessions</Text>
                  <Text className="text-light-text dark:text-dark-text text-sm font-bold">{gamification.totalSessions}</Text>
                </View>
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-xs">Focus Time</Text>
                  <Text className="text-light-text dark:text-dark-text text-sm font-bold">{liveTotalFocusMinutes} min</Text>
                </View>
              </View>
            </View>

            {/* STREAK SECTION */}
            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-light-text dark:text-dark-text font-bold">Streak</Text>
                <Ionicons name="flame" size={24} color={Colors.warning} />
              </View>
              <View className="flex-row justify-between">
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Current</Text>
                  <Text className="text-light-text dark:text-dark-text text-2xl font-bold">
                    {gamification.currentStreak || streak?.current || 0}
                  </Text>
                </View>
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Longest</Text>
                  <Text className="text-light-text dark:text-dark-text text-2xl font-bold">
                    {gamification.longestStreak || streak?.longest || 0}
                  </Text>
                </View>
                <View>
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm">Since Last</Text>
                  <Text className="text-light-text dark:text-dark-text text-2xl font-bold">
                    {streak?.lastSessionDate
                      ? Math.floor(
                          (Date.now() - new Date(streak.lastSessionDate).getTime()) / 86400000,
                        )
                      : '-'}
                  </Text>
                </View>
              </View>
            </View>

            {recentSessions.length > 0 && (
              <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
                <Text className="text-light-text dark:text-dark-text font-bold mb-4">
                  Recent Sessions
                </Text>
                {recentSessions.map((session) => (
                  <View key={session.id} className="flex-row items-center py-2 border-b border-gray-800">
                    <View className="w-8 h-8 rounded-full bg-primary/20 items-center justify-center mr-3">
                      <Ionicons name="checkmark" size={16} color={Colors.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-light-text dark:text-dark-text text-sm">
                        {session.taskLabel || 'Focus session'}
                      </Text>
                      <Text className="text-light-subtext dark:text-dark-subtext text-xs">
                        {Math.round(session.durationSeconds / 60)} min
                      </Text>
                    </View>
                    <Text className="text-light-subtext dark:text-dark-subtext text-xs">
                      {new Date(session.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* TASKS SECTION */}
            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-light-text dark:text-dark-text font-bold">Tasks</Text>
                <TouchableOpacity
                  className="w-8 h-8 rounded-full items-center justify-center"
                  style={{ backgroundColor: Colors.primary }}
                  onPress={openCreate}
                >
                  <Ionicons name="add" size={20} color="white" />
                </TouchableOpacity>
              </View>

              {tasks.length === 0 ? (
                <Text className="text-light-subtext dark:text-dark-subtext text-sm text-center py-4">
                  No tasks yet. Tap + to create your first task.
                </Text>
              ) : (
                tasks.map((task) => (
                  <TouchableOpacity
                    key={task.id}
                    className="flex-row items-center py-3 border-b border-gray-800"
                    onPress={() => openView(task)}
                  >
                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-light-text dark:text-dark-text text-sm font-bold flex-shrink">
                          {task.title}
                        </Text>
                        {task.totalTimeOnTask > 0 && (
                          <Text className="text-light-subtext dark:text-dark-subtext text-xs ml-2">
                            {formatSecondsShort(task.totalTimeOnTask)}
                          </Text>
                        )}
                      </View>
                      {task.tags && task.tags.length > 0 && (
                        <View className="flex-row flex-wrap mt-1">
                          {task.tags.map((tag) => (
                            <View key={tag} className="px-2 py-0.5 rounded-full mr-1.5 mb-0.5" style={{ backgroundColor: tagColor(tag) + '30' }}>
                              <Text className="text-xs" style={{ color: tagColor(tag) }}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {task.dueDate && (
                        <Text className={`text-xs mt-0.5 ${new Date(task.dueDate) < new Date() ? 'text-error' : 'text-light-subtext dark:text-dark-subtext'}`}>
                          {new Date(task.dueDate) < new Date() ? 'Overdue: ' : 'Due '}{formatDate(task.dueDate)}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.lightSubtext} />
                  </TouchableOpacity>
                ))
              )}
            </View>

            {/* ACHIEVEMENTS SECTION */}
            <View className="bg-light-card dark:bg-dark-card rounded-2xl p-6">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-light-text dark:text-dark-text font-bold">Achievements</Text>
                <Ionicons name="trophy" size={20} color="#F59E0B" />
              </View>

              <View className="flex-row mb-4">
                <TouchableOpacity
                  className={`px-4 py-2 rounded-full mr-2 ${achievementTab === 'unlocked' ? 'bg-primary' : 'bg-gray-700'}`}
                  onPress={() => setAchievementTab('unlocked')}
                >
                  <Text className={`text-xs font-bold ${achievementTab === 'unlocked' ? 'text-white' : 'text-light-subtext dark:text-dark-subtext'}`}>
                    Unlocked ({gamification.achievements.filter((a) => a.isUnlocked).length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`px-4 py-2 rounded-full ${achievementTab === 'locked' ? 'bg-primary' : 'bg-gray-700'}`}
                  onPress={() => setAchievementTab('locked')}
                >
                  <Text className={`text-xs font-bold ${achievementTab === 'locked' ? 'text-white' : 'text-light-subtext dark:text-dark-subtext'}`}>
                    Locked ({gamification.achievements.filter((a) => !a.isUnlocked).length})
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="flex-row flex-wrap justify-between">
                {gamification.achievements.length === 0 ? (
                  <Text className="text-light-subtext dark:text-dark-subtext text-sm text-center py-4 w-full">
                    Complete a session to see achievements
                  </Text>
                ) : (
                  gamification.achievements
                    .filter((a) => achievementTab === 'unlocked' ? a.isUnlocked : !a.isUnlocked)
                    .slice(0, 6)
                    .map((a) => (
                      <View key={a.id} className="mb-3" style={{ width: '48%' }}>
                        <AchievementCard achievement={a} unlocked={a.isUnlocked} />
                      </View>
                    ))
                )}
              </View>
            </View>
          </View>
        }
        renderItem={() => null}
        contentContainerStyle={{ paddingBottom: 20 }}
      />

      <Modal
        visible={showTaskSheet}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowTaskSheet(false)}
      >
        <SafeAreaView className="flex-1 bg-light-bg dark:bg-dark-bg">
          {taskSheetMode === 'view' && selectedSheetTask ? (
            <TaskDetail
              task={selectedSheetTask}
              onEdit={openEdit}
              onClose={() => {
                setShowTaskSheet(false);
                setSelectedSheetTask(null);
              }}
            />
          ) : (
            <TaskForm
              task={taskSheetMode === 'edit' ? selectedSheetTask : null}
              onSave={handleSave}
              onClose={() => {
                setShowTaskSheet(false);
                setSelectedSheetTask(null);
              }}
              onDelete={taskSheetMode === 'edit' ? handleDelete : undefined}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
