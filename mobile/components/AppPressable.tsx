import { forwardRef, useEffect } from 'react';
import {
  Pressable,
  ActivityIndicator,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../hooks/useTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Feedback has to land inside ~100ms to read as a response to the finger, so
// the press-in is quick and the release is allowed to settle a little slower.
const PRESS_IN_MS = 90;
const PRESS_OUT_MS = 140;

const PRESSED_SCALE = 0.97;
const PRESSED_OPACITY = 0.9;
const DISABLED_OPACITY = 0.4;

export interface AppPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /**
   * Renders a spinner in place of the children and blocks presses. The
   * container keeps its measured size, so a button does not collapse mid-flight
   * and shift everything under it.
   */
  loading?: boolean;
  /** Set false for large surfaces (cards, rows) where a scale reads as a wobble. */
  scaleOnPress?: boolean;
}

/**
 * The app's one interactive primitive.
 *
 * Before this, 287 TouchableOpacity call sites carried 18 explicit
 * activeOpacity values between them — the rest inherited React Native's
 * default 0.2, a hard dim, while four sites passed activeOpacity={1} and gave
 * no feedback at all. Same gesture, four different answers.
 *
 * The contract, in one place:
 *
 *   default   full colour
 *   pressed   scale 0.97 + opacity 0.9, ~90ms in / 140ms out
 *   disabled  opacity 0.4, presses blocked, announced to screen readers
 *   loading   spinner replaces content, size held, presses blocked
 *
 * Scale rather than a fade because a fade on a dark ground is nearly invisible,
 * and because it does not shift layout — the transform stays inside the
 * element's own bounds.
 */
const AppPressable = forwardRef<View, AppPressableProps>(function AppPressable(
  {
    style,
    disabled = false,
    loading = false,
    scaleOnPress = true,
    children,
    accessibilityState,
    ...rest
  },
  ref,
) {
  const Colors = useTheme();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const inert = disabled || loading;

  // The disabled level lives in the same shared value the press uses, not in a
  // separate style entry — the animated style is applied last and would win
  // over anything the style array set, silently rendering disabled at full
  // strength.
  useEffect(() => {
    opacity.value = withTiming(inert ? DISABLED_OPACITY : 1, { duration: PRESS_OUT_MS });
    if (inert) scale.value = withTiming(1, { duration: PRESS_OUT_MS });
  }, [inert, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const press = (down: boolean) => {
    if (inert) return;
    const duration = down ? PRESS_IN_MS : PRESS_OUT_MS;
    if (scaleOnPress) {
      scale.value = withTiming(down ? PRESSED_SCALE : 1, { duration });
    }
    opacity.value = withTiming(down ? PRESSED_OPACITY : 1, { duration });
  };

  return (
    <AnimatedPressable
      ref={ref}
      disabled={inert}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      accessibilityState={{ disabled: inert, ...accessibilityState }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {loading ? (
        // Laid over the children rather than replacing them: the children still
        // measure, so the button holds its width and nothing below it moves.
        <>
          <View style={{ opacity: 0 }}>{children as React.ReactNode}</View>
          <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', top: 0, bottom: 0, left: 0, right: 0 }}>
            <ActivityIndicator size="small" color={Colors.textBright} />
          </View>
        </>
      ) : (
        (children as React.ReactNode)
      )}
    </AnimatedPressable>
  );
});

export default AppPressable;
