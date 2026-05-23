import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FeedEvent } from '../types';
import { Colors } from '../constants/Colors';
import LevelBadge from './LevelBadge';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface FeedCardProps {
  event: FeedEvent;
}

export default function FeedCard({ event }: FeedCardProps) {
  const { eventType, payload, username, createdAt } = event;

  switch (eventType) {
    case 'session_completed':
      return (
        <View className="mx-4 mb-3 bg-dark-card rounded-2xl p-4">
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center mr-3">
              <Text className="text-primary font-bold">
                {username[0]?.toUpperCase() || '?'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-white font-medium">
                {username}
              </Text>
              <Text className="text-gray-400 text-xs">
                completed a {payload.durationMinutes || 0}min focus session
              </Text>
            </View>
            <View className="items-end">
              {payload.xpEarned != null && (
                <View className="bg-purple-500/20 px-2 py-0.5 rounded-full mb-1">
                  <Text className="text-purple-400 text-xs font-bold">
                    +{payload.xpEarned} XP
                  </Text>
                </View>
              )}
              {payload.streak != null && payload.streak > 1 && (
                <View className="flex-row items-center">
                  <Ionicons name="flame" size={12} color="#F59E0B" />
                  <Text className="text-amber-400 text-xs ml-0.5">{payload.streak}</Text>
                </View>
              )}
            </View>
          </View>
          {payload.taskTitle && (
            <Text className="text-gray-400 text-sm mt-2 ml-[52px]">
              Working on: {payload.taskTitle}
            </Text>
          )}
          <Text className="text-gray-500 text-xs mt-2 ml-[52px]">
            {relativeTime(createdAt)}
          </Text>
        </View>
      );

    case 'achievement_unlocked':
      return (
        <View className="mx-4 mb-3 bg-dark-card rounded-2xl p-4">
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-full bg-yellow-500/20 items-center justify-center mr-3">
              <Text className="text-2xl">{payload.achievementIcon || '🏆'}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-white font-medium">{username}</Text>
              {payload.achievementTitle && (
                <Text className="text-gray-400 text-xs">
                  unlocked {payload.achievementTitle}
                </Text>
              )}
              {payload.achievementDescription && (
                <Text className="text-gray-500 text-xs mt-0.5">
                  {payload.achievementDescription}
                </Text>
              )}
            </View>
          </View>
          <Text className="text-gray-500 text-xs mt-2 ml-[52px]">
            {relativeTime(createdAt)}
          </Text>
        </View>
      );

    case 'streak_milestone':
      return (
        <View className="mx-4 mb-3 rounded-2xl p-4" style={{ backgroundColor: '#7C3AED20' }}>
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-full bg-orange-500/20 items-center justify-center mr-3">
              <Ionicons name="flame" size={22} color="#F59E0B" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-medium">{username}</Text>
              <Text className="text-orange-400 text-sm font-bold">
                hit a 🔥 {payload.streakDays} day streak!
              </Text>
              <Text className="text-gray-400 text-xs mt-0.5">
                That's {Math.floor((payload.streakDays || 0) / 7)} weeks of consistency
              </Text>
            </View>
          </View>
          <Text className="text-gray-500 text-xs mt-2 ml-[52px]">
            {relativeTime(createdAt)}
          </Text>
        </View>
      );

    case 'level_up':
      return (
        <View className="mx-4 mb-3 bg-dark-card rounded-2xl p-4">
          <View className="flex-row items-center">
            <View className="mr-3">
              <LevelBadge level={payload.newLevel || 1} size="sm" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-medium">{username}</Text>
              <Text className="text-purple-400 text-sm font-bold">
                reached Level {payload.newLevel} — {payload.levelTitle}!
              </Text>
            </View>
          </View>
          <Text className="text-gray-500 text-xs mt-2 ml-[52px]">
            {relativeTime(createdAt)}
          </Text>
        </View>
      );

    default:
      return null;
  }
}
