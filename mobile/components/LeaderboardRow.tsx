import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LeaderboardEntry } from '../types';
import { useTheme } from '../hooks/useTheme';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  rank: number;
  type: 'weekly_xp' | 'longest_streak';
  isMe: boolean;
}

function getRankStyle(rank: number, fallbackColor: string) {
  if (rank === 1) return { bg: '#FFD70015', border: '#FFD70040', icon: 'trophy', color: '#FFD700' };
  if (rank === 2) return { bg: '#C0C0C015', border: '#C0C0C040', icon: 'trophy', color: '#C0C0C0' };
  if (rank === 3) return { bg: '#CD7F3215', border: '#CD7F3240', icon: 'trophy', color: '#CD7F32' };
  if (rank <= 10) return { bg: '#3B82F608', border: '#3B82F620', icon: null, color: '#3B82F6' };
  return { bg: 'transparent', border: 'transparent', icon: null, color: fallbackColor };
}

export default function LeaderboardRow({
  entry,
  rank,
  type,
  isMe,
}: LeaderboardRowProps) {
  const Colors = useTheme();
  const rankStyle = getRankStyle(rank, Colors.subtext);
  // Mirrors what the leaderboard endpoints actually return: /social/leaderboard/streak
  // sends currentStreak, /social/leaderboard/weekly sends totalSeconds (not minutes).
  const valueText = type === 'longest_streak'
    ? `${entry.currentStreak ?? 0} 🔥`
    : `${Math.floor((entry.totalSeconds ?? 0) / 60)} min`;

  return (
    <View
      className={`mx-4 mb-2 rounded-2xl p-4 flex-row items-center ${
        isMe ? 'bg-primary/10 border border-primary/30' : 'bg-dark-card'
      }`}
      style={rank <= 10 && !isMe ? {
        backgroundColor: rankStyle.bg,
        borderWidth: 0.5,
        borderColor: rankStyle.border,
      } : undefined}
    >
      <View className="w-8 items-center">
        {rankStyle.icon ? (
          <Ionicons name={rankStyle.icon as 'trophy'} size={18} color={rankStyle.color} />
        ) : (
          <Text className="text-gray-400 font-bold text-sm">#{rank}</Text>
        )}
      </View>
      <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center mx-3">
        <Text className="text-primary font-bold">
          {entry.username[0]?.toUpperCase() || '?'}
        </Text>
      </View>
      <View className="flex-1 flex-row items-center">
        <Text className="text-white font-bold text-sm">
          {entry.username}
          {isMe ? ' (You)' : ''}
        </Text>
      </View>
      <Text className="text-white font-bold text-sm">{valueText}</Text>
    </View>
  );
}
