import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { useGamificationStore } from '../../stores/gamificationStore';

/**
 * The unlock moment.
 *
 * Mounted at the app root, not on the profile: sessions complete on the Timer
 * tab, so a profile-only celebration fires on a screen the user is not looking
 * at. It reads a queue rather than a single achievement because one session can
 * unlock several at once — the toast this replaces showed the first and dropped
 * the rest.
 *
 * Everything the plan builds toward converges here: this is the payoff for
 * earning something, so it gets a real surface rather than a 3-second toast.
 */
export default function UnlockOverlay() {
  const Colors = useTheme();
  const { GOLD, TRACE } = Colors;

  const queue = useGamificationStore((s) => s.unlockQueue);
  const dismissUnlock = useGamificationStore((s) => s.dismissUnlock);
  const shareUnlock = useGamificationStore((s) => s.shareUnlock);

  const current = queue[0];
  const remaining = Math.max(0, queue.length - 1);

  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'shared' | 'failed'>('idle');

  const scale = useSharedValue(0.85);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!current) return;
    // Reset per achievement so a queued second unlock animates in fresh.
    setShareState('idle');
    scale.value = 0.85;
    opacity.value = 0;
    scale.value = withSpring(1, { damping: 14, stiffness: 180 });
    opacity.value = withTiming(1, { duration: 180 });
  }, [current?.id]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!current) return null;

  const onShare = async () => {
    setShareState('sharing');
    const ok = await shareUnlock(current.id);
    setShareState(ok ? 'shared' : 'failed');
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={dismissUnlock} visible>
      <View style={{
        flex: 1, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 32,
      }}>
        <Animated.View style={[cardStyle, {
          width: '100%', maxWidth: 340,
          backgroundColor: Colors.surface,
          borderRadius: 24, paddingVertical: 32, paddingHorizontal: 24,
          borderWidth: 1, borderColor: `${GOLD}44`,
          alignItems: 'center',
        }]}>
          <Text style={{
            color: GOLD, fontSize: 11, fontWeight: '700',
            letterSpacing: 1.5, textTransform: 'uppercase',
          }}>
            Achievement unlocked
          </Text>

          <View style={{
            width: 96, height: 96, borderRadius: 48, marginTop: 20,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: Colors.raised,
            borderWidth: 2, borderColor: `${GOLD}66`,
          }}>
            <Text style={{ fontSize: 44 }}>{current.icon}</Text>
          </View>

          <Text style={{
            color: Colors.textBright, fontSize: 22, fontWeight: '800',
            marginTop: 18, textAlign: 'center',
          }}>
            {current.title}
          </Text>
          <Text style={{
            color: Colors.subtext, fontSize: 13, marginTop: 8,
            textAlign: 'center', lineHeight: 19,
          }}>
            {current.description}
          </Text>

          <View style={{
            marginTop: 16, paddingHorizontal: 14, paddingVertical: 6,
            borderRadius: 20, backgroundColor: Colors.traceDim,
          }}>
            <Text style={{ color: TRACE, fontSize: 13, fontWeight: '700' }}>
              +{current.xpReward} XP
            </Text>
          </View>

          {/* Share reuses PATCH /achievements/:id/share, which already backs the
              social feed. The copy names the consequence: this posts publicly. */}
          <Pressable
            onPress={onShare}
            disabled={shareState !== 'idle'}
            accessibilityRole="button"
            accessibilityLabel="Share this achievement to your feed"
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 24, minHeight: 44, width: '100%',
              borderRadius: 14, backgroundColor: Colors.primary,
              opacity: shareState === 'idle' ? 1 : 0.7,
            }}
          >
            {shareState === 'sharing' ? (
              <ActivityIndicator color={Colors.textBright} size="small" />
            ) : (
              <Ionicons
                name={shareState === 'shared' ? 'checkmark' : 'share-social-outline'}
                size={16}
                color={Colors.textBright}
              />
            )}
            <Text style={{ color: Colors.textBright, fontSize: 14, fontWeight: '700' }}>
              {shareState === 'shared' ? 'Shared to your feed'
                : shareState === 'failed' ? 'Could not share — tap to dismiss'
                : 'Share to feed'}
            </Text>
          </Pressable>

          <Pressable
            onPress={dismissUnlock}
            accessibilityRole="button"
            style={{ marginTop: 14, minHeight: 44, justifyContent: 'center', width: '100%' }}
          >
            <Text style={{
              color: Colors.subtext, fontSize: 13, fontWeight: '600', textAlign: 'center',
            }}>
              {remaining > 0 ? `Next (${remaining} more)` : 'Nice'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
