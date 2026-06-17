import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Share, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { Achievement } from '../../types';
import { useTheme } from '../../hooks/useTheme';
import * as Haptics from 'expo-haptics';

export default function AchievementDetailScreen() {
  const Colors = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAchievements();
  }, [id]);

  const loadAchievements = async () => {
    setIsLoading(true);
    try {
      const response = await api.get<Achievement[]>(`/achievements/${id}`);
      if (response.success && response.data) {
        setAchievements(response.data);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const handleShare = async (achievement: Achievement) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await Share.share({
        message: `I just unlocked "${achievement.title}" 🏆 on Ascend!`,
        title: 'Achievement Unlocked!',
      });
    } catch {}
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center">
        <ActivityIndicator color={Colors.primary} />
      </SafeAreaView>
    );
  }

  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <SafeAreaView className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg">
      <View className="px-6 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color={Colors.darkText} />
        </TouchableOpacity>
        <Text className="text-2xl font-bold text-dark-text dark:text-dark-text text-light-text">Achievements</Text>
      </View>

      <FlatList
        data={achievements}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          unlocked.length > 0 ? (
            <View className="px-6 mb-4">
              <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mb-3">
                Unlocked ({unlocked.length})
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View className={`mx-6 mb-3 rounded-2xl p-5 ${item.unlocked ? 'bg-dark-card dark:bg-dark-card bg-light-card border border-accent/30' : 'bg-dark-card/50 opacity-50'}`}>
            <View className="flex-row items-center">
              <View className="w-14 h-14 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center mr-4">
                <Text className="text-3xl">{item.unlocked ? item.icon : '🔒'}</Text>
              </View>
              <View className="flex-1">
                <Text className={`text-lg font-bold ${item.unlocked ? 'text-dark-text dark:text-dark-text text-light-text' : 'text-gray-500'}`}>
                  {item.title}
                </Text>
                <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-sm">
                  {item.unlocked ? item.description : 'Keep going to unlock!'}
                </Text>
                {item.unlocked && item.unlockedAt && (
                  <Text className="text-accent text-xs mt-1">
                    Unlocked {new Date(item.unlockedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              {item.unlocked && (
                <TouchableOpacity
                  className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center"
                  onPress={() => handleShare(item)}
                >
                  <Ionicons name="share-social" size={20} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListFooterComponent={
          locked.length > 0 ? (
            <View className="px-6 mt-4 mb-8">
              <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mb-3">
                Locked ({locked.length})
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
