import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useTheme } from '../hooks/useTheme';

interface RewardData {
  xpEarned: number;
  totalXP: number;
  level: number;
  leveledUp: boolean;
  newStreak: number;
  longestStreak: number;
  newlyUnlocked: { id: string; key: string; title: string; description: string; icon: string; xpReward: number; category: string; threshold: number; unlockedAt: string }[];
}

interface RewardModalProps {
  visible: boolean;
  reward: RewardData | null;
  onClose: () => void;
}

export default function RewardModal({ visible, reward, onClose }: RewardModalProps) {
  const Colors = useTheme();
  if (!visible || !reward) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(400).springify()}
      exiting={FadeOutDown.duration(300)}
      className="absolute inset-0 z-50 justify-center items-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
    >
      <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-3xl w-full max-w-sm p-6 items-center">
        <View className="w-16 h-16 rounded-full bg-primary/20 items-center justify-center mb-3">
          <Ionicons name="trophy" size={32} color={Colors.primary} />
        </View>

        <Text className="text-dark-text dark:text-dark-text text-light-text text-xl font-bold mb-1">
          Session Complete!
        </Text>

        {reward.leveledUp && (
          <View className="bg-accent/20 px-4 py-1 rounded-full mb-3">
            <Text className="text-accent font-bold text-sm">LEVEL UP! You're now level {reward.level}</Text>
          </View>
        )}

        <View className="flex-row justify-center space-x-8 my-4">
          <View className="items-center">
            <Text className="text-primary text-2xl font-bold">+{reward.xpEarned}</Text>
            <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs">XP Earned</Text>
          </View>
          <View className="items-center">
            <Text className="text-dark-text dark:text-dark-text text-light-text text-2xl font-bold">{reward.newStreak}</Text>
            <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs">Day Streak</Text>
          </View>
        </View>

        {reward.newlyUnlocked.length > 0 && (
          <View className="w-full mt-2">
            <Text className="text-dark-text dark:text-dark-text text-light-text font-semibold mb-2 text-center">
              Achievements Unlocked
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="pb-2">
              {reward.newlyUnlocked.map((a) => (
                <View key={a.id} className="items-center mx-2">
                  <View className="w-14 h-14 rounded-full bg-dark-bg items-center justify-center mb-1">
                    <Text className="text-2xl">{a.icon}</Text>
                  </View>
                  <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs text-center" style={{ maxWidth: 70 }} numberOfLines={2}>
                    {a.title}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <TouchableOpacity
          className="mt-6 bg-primary rounded-xl py-3 px-8"
          onPress={onClose}
        >
          <Text className="text-white font-bold text-base">Continue</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
