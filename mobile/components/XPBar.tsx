import { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
} from 'react-native-reanimated';

interface XPBarProps {
  currentXP: number;
  xpForCurrent: number;
  xpForNext: number;
  level: number;
  animated?: boolean;
  showLabels?: boolean;
  height?: number;
}

const AnimatedView = Animated.createAnimatedComponent(View);

export default function XPBar({
  currentXP,
  xpForCurrent,
  xpForNext,
  level,
  animated = false,
  showLabels = true,
  height = 8,
}: XPBarProps) {
  const range = xpForNext - xpForCurrent;
  const progress = range > 0 ? (currentXP - xpForCurrent) / range : 0;
  const clamped = Math.min(1, Math.max(0, progress));

  const width = useSharedValue(animated ? 0 : clamped);

  useEffect(() => {
    if (animated) {
      width.value = withTiming(clamped, { duration: 800 });
    } else {
      width.value = clamped;
    }
  }, [clamped, animated]);

  const animatedStyle = useAnimatedProps(() => ({
    width: `${width.value * 100}%`,
  }));

  return (
    <View>
      {showLabels && (
        <View className="flex-row justify-between mb-1">
          <Text className="text-light-subtext dark:text-dark-subtext text-xs">
            Level {level}
          </Text>
          <Text className="text-light-subtext dark:text-dark-subtext text-xs">
            {currentXP} / {xpForNext} XP
          </Text>
        </View>
      )}
      <View
        className="rounded-full overflow-hidden bg-gray-700"
        style={{ height }}
      >
        {animated ? (
          <AnimatedView
            className="h-full rounded-full"
            style={[{ backgroundColor: '#A855F7' }, animatedStyle]}
          />
        ) : (
          <View
            className="h-full rounded-full"
            style={{ width: `${clamped * 100}%`, backgroundColor: '#A855F7' }}
          />
        )}
      </View>
    </View>
  );
}
