import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Achievement } from '../types';
import { Colors } from '../constants/Colors';

interface AchievementCardProps {
  achievement: Achievement;
  unlocked: boolean;
}

export default function AchievementCard({ achievement, unlocked }: AchievementCardProps) {
  if (unlocked) {
    return (
      <View className="bg-light-card dark:bg-dark-card rounded-xl p-3 items-center justify-center" style={{ minHeight: 90 }}>
        <Text className="text-2xl mb-1">{achievement.icon}</Text>
        <Text className="text-light-text dark:text-dark-text text-xs font-bold text-center" numberOfLines={2}>
          {achievement.title}
        </Text>
        <Text className="text-light-subtext dark:text-dark-subtext text-xs text-center mt-0.5" numberOfLines={2}>
          {achievement.description}
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-light-card dark:bg-dark-card rounded-xl p-3 items-center justify-center opacity-50" style={{ minHeight: 90 }}>
      <View className="w-10 h-10 rounded-full bg-gray-700 items-center justify-center mb-1">
        <Ionicons name="lock-closed" size={16} color={Colors.lightSubtext} />
      </View>
      <Text className="text-light-text dark:text-dark-text text-xs font-bold text-center" numberOfLines={2}>
        {achievement.title}
      </Text>
      <Text className="text-light-subtext dark:text-dark-subtext text-xs text-center mt-0.5" numberOfLines={2}>
        {achievement.description}
      </Text>
    </View>
  );
}
