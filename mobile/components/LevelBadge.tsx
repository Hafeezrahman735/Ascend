import { View, Text } from 'react-native';

interface LevelBadgeProps {
  level: number;
  size?: 'sm' | 'md' | 'lg';
}

const LEVEL_TITLES: Record<number, string> = {
  1: 'Beginner',
  2: 'Novice',
  3: 'Apprentice',
  4: 'Focused',
  5: 'Committed',
  6: 'Dedicated',
  7: 'Expert',
  8: 'Master',
  9: 'Elite',
  10: 'Legend',
};

function getLevelTitle(level: number): string {
  if (level >= 11) return 'Grandmaster';
  return LEVEL_TITLES[level] || 'Beginner';
}

function getLevelColor(level: number): { bg: string; text: string; border: string } {
  if (level >= 15) return { bg: '#FFD70020', text: '#FFD700', border: '#FFD700' };
  if (level >= 10) return { bg: '#A855F720', text: '#A855F7', border: '#A855F7' };
  if (level >= 5) return { bg: '#3B82F620', text: '#3B82F6', border: '#3B82F6' };
  return { bg: '#6B728020', text: '#9CA3AF', border: '#6B7280' };
}

export default function LevelBadge({ level, size = 'md' }: LevelBadgeProps) {
  const dims = size === 'sm' ? 36 : size === 'lg' ? 60 : 48;
  const font = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;
  const colors = getLevelColor(level);
  const title = getLevelTitle(level);
  const titleSize = size === 'sm' ? 10 : size === 'lg' ? 14 : 12;

  return (
    <View className="items-center">
      <View
        className="rounded-full items-center justify-center"
        style={{
          width: dims,
          height: dims,
          backgroundColor: colors.bg,
          borderWidth: 2,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.text, fontSize: font, fontWeight: 'bold' }}>
          {level}
        </Text>
      </View>
      {size !== 'sm' && (
        <Text className="text-light-subtext dark:text-dark-subtext mt-1" style={{ fontSize: titleSize }}>
          {title}
        </Text>
      )}
    </View>
  );
}
