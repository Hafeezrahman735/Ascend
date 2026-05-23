import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { AnalyticsSummary } from '../../types';
import { Colors } from '../../constants/Colors';

export default function FriendProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFriendData();
  }, [id]);

  const loadFriendData = async () => {
    setIsLoading(true);
    try {
      const response = await api.get<AnalyticsSummary>(`/analytics/summary/${id}`);
      if (response.success && response.data) {
        setSummary(response.data);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg">
      <View className="px-6 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color={Colors.darkText} />
        </TouchableOpacity>
        <Text className="text-2xl font-bold text-dark-text dark:text-dark-text text-light-text">Friend</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <View className="px-6">
          <View className="items-center mb-8">
            <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-3">
              <Text className="text-primary text-3xl font-bold">?</Text>
            </View>
            <Text className="text-2xl font-bold text-dark-text dark:text-dark-text text-light-text">Friend</Text>
          </View>

          <View className="flex-row justify-between">
            <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-6 py-4 items-center flex-1 mr-2">
              <Text className="text-dark-text dark:text-dark-text text-light-text text-2xl font-bold">{summary?.totalSessions || 0}</Text>
              <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs">Sessions</Text>
            </View>
            <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-6 py-4 items-center flex-1 mx-2">
              <Text className="text-dark-text dark:text-dark-text text-light-text text-2xl font-bold">{summary?.totalHours || 0}</Text>
              <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs">Hours</Text>
            </View>
            <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl px-6 py-4 items-center flex-1 ml-2">
              <Text className="text-dark-text dark:text-dark-text text-light-text text-2xl font-bold">{summary?.currentStreak || 0}</Text>
              <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-xs">Streak</Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
