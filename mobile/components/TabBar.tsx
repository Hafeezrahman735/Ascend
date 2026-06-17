import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

interface Tab {
  key: string;
  label: string;
  badge?: number;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export default function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <View className="flex-row px-4 py-2 border-b border-gray-800">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
        <View className="flex-row">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                className="relative mr-6 py-2"
                onPress={() => onTabChange(tab.key)}
              >
                <View className="flex-row items-center">
                  <Text
                    className={`text-sm font-semibold ${
                      isActive ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    {tab.label}
                  </Text>
                  {tab.badge != null && tab.badge > 0 && (
                    <View className="ml-1.5 bg-red-500 rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                      <Text className="text-white text-xs font-bold">
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </Text>
                    </View>
                  )}
                </View>
                {isActive && (
                  <View className="absolute -bottom-[1px] left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
