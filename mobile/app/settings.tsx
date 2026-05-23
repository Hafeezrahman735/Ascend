import { useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

export default function SettingsScreen() {
  const router = useRouter();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [shortBreakMinutes, setShortBreakMinutes] = useState(5);
  const [longBreakMinutes, setLongBreakMinutes] = useState(15);

  return (
    <SafeAreaView className="flex-1 bg-dark-bg dark:bg-dark-bg bg-light-bg">
      <View className="px-6 py-4 flex-row items-center">
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <Ionicons name="arrow-back" size={24} color={Colors.darkText} />
        </TouchableOpacity>
        <Text className="text-2xl font-bold text-dark-text dark:text-dark-text text-light-text">Settings</Text>
      </View>

      <View className="px-6 space-y-6">
        <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl p-5">
          <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mb-4">Notifications</Text>
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Push Notifications</Text>
            <Switch
              value={pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ false: '#333', true: Colors.primary }}
              thumbColor="white"
            />
          </View>
          <View className="flex-row items-center justify-between py-3 border-t border-gray-800">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Sound</Text>
            <Switch
              value={soundEnabled}
              onValueChange={setSoundEnabled}
              trackColor={{ false: '#333', true: Colors.primary }}
              thumbColor="white"
            />
          </View>
          <View className="flex-row items-center justify-between py-3 border-t border-gray-800">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Haptic Feedback</Text>
            <Switch
              value={hapticEnabled}
              onValueChange={setHapticEnabled}
              trackColor={{ false: '#333', true: Colors.primary }}
              thumbColor="white"
            />
          </View>
        </View>

        <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl p-5">
          <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mb-4">Timer Duration</Text>
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Focus (minutes)</Text>
            <View className="flex-row items-center">
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setFocusMinutes(Math.max(1, focusMinutes - 1))}
              >
                <Ionicons name="remove" size={18} color={Colors.darkText} />
              </TouchableOpacity>
              <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mx-4 w-8 text-center">{focusMinutes}</Text>
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setFocusMinutes(Math.min(120, focusMinutes + 1))}
              >
                <Ionicons name="add" size={18} color={Colors.darkText} />
              </TouchableOpacity>
            </View>
          </View>
          <View className="flex-row items-center justify-between py-3 border-t border-gray-800">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Short Break</Text>
            <View className="flex-row items-center">
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setShortBreakMinutes(Math.max(1, shortBreakMinutes - 1))}
              >
                <Ionicons name="remove" size={18} color={Colors.darkText} />
              </TouchableOpacity>
              <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mx-4 w-8 text-center">{shortBreakMinutes}</Text>
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setShortBreakMinutes(Math.min(30, shortBreakMinutes + 1))}
              >
                <Ionicons name="add" size={18} color={Colors.darkText} />
              </TouchableOpacity>
            </View>
          </View>
          <View className="flex-row items-center justify-between py-3 border-t border-gray-800">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Long Break</Text>
            <View className="flex-row items-center">
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setLongBreakMinutes(Math.max(1, longBreakMinutes - 1))}
              >
                <Ionicons name="remove" size={18} color={Colors.darkText} />
              </TouchableOpacity>
              <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mx-4 w-8 text-center">{longBreakMinutes}</Text>
              <TouchableOpacity
                className="w-8 h-8 rounded-full bg-dark-bg dark:bg-dark-bg bg-light-bg items-center justify-center"
                onPress={() => setLongBreakMinutes(Math.min(60, longBreakMinutes + 1))}
              >
                <Ionicons name="add" size={18} color={Colors.darkText} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View className="bg-dark-card dark:bg-dark-card bg-light-card rounded-2xl p-5">
          <Text className="text-dark-text dark:text-dark-text text-light-text font-bold mb-4">Account</Text>
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-dark-text dark:text-dark-text text-light-text">Privacy</Text>
            <Text className="text-accent">Public</Text>
          </View>
        </View>

        <Text className="text-dark-subtext dark:text-dark-subtext text-light-subtext text-center text-xs mt-8">
          Pomodoro v1.0.0
        </Text>
      </View>
    </SafeAreaView>
  );
}
