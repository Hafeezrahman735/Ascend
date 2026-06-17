import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LevelBadge from './LevelBadge';

interface UserRowProps {
  username: string;
  avatarUrl: string | null;
  level?: number;
  streak?: number;
  activeToday?: boolean;
  lastActive?: string | null;
  subtitle?: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  accentColor?: string;
  onPress?: () => void;
  onAction?: () => void;
}

export default function UserRow({
  username,
  avatarUrl,
  level,
  streak,
  activeToday,
  lastActive,
  subtitle,
  actionLabel,
  actionDisabled,
  accentColor,
  onPress,
  onAction,
}: UserRowProps) {
  const content = (
    <View className="flex-row items-center py-3 px-4">
      <View className="w-11 h-11 rounded-full bg-primary/20 items-center justify-center">
        <Text className="text-primary font-bold text-base">
          {username[0]?.toUpperCase() || '?'}
        </Text>
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-center">
          <Text className="text-white font-bold text-sm">{username}</Text>
          {level != null && (
            <View className="ml-2">
              <LevelBadge level={level} size="sm" />
            </View>
          )}
        </View>
        {subtitle ? (
          <Text className="text-gray-400 text-xs mt-0.5">{subtitle}</Text>
        ) : activeToday != null ? (
          <View className="flex-row items-center mt-0.5">
            <View
              className={`w-2 h-2 rounded-full mr-1.5 ${
                activeToday ? 'bg-green-400' : 'bg-gray-500'
              }`}
            />
            <Text className="text-gray-400 text-xs">
              {activeToday ? 'Active today' : 'Last seen today'}
            </Text>
          </View>
        ) : null}
      </View>
      {streak != null && streak > 1 && (
        <View className="flex-row items-center mr-3">
          <Ionicons name="flame" size={14} color="#F59E0B" />
          <Text className="text-amber-400 text-xs ml-0.5">{streak}</Text>
        </View>
      )}
      {actionLabel && (
        <TouchableOpacity
          className={`px-4 py-1.5 rounded-full ${
            actionDisabled
              ? 'bg-gray-700'
              : accentColor
              ? `bg-${accentColor}`
              : 'bg-primary'
          }`}
          disabled={actionDisabled}
          onPress={onAction}
        >
          <Text
            className={`text-xs font-bold ${
              actionDisabled ? 'text-gray-400' : 'text-white'
            }`}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} className="mx-4 mb-2 bg-dark-card rounded-2xl overflow-hidden">
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View className="mx-4 mb-2 bg-dark-card rounded-2xl overflow-hidden">
      {content}
    </View>
  );
}
