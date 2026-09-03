import { View, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import type { OrderedAchievement } from '../../lib/achievementOrder';
import { sectionLabel, fmtDate } from './shared';
import { Font } from '../../constants/typography';

/**
 * The full achievements grid — every achievement, earned and unearned, two
 * columns, each with its progress toward unlocking.
 *
 * This used to live inside the profile screen's Awards tab. It moved out to
 * become the destination behind "View All": the profile now shows a compact row
 * and this screen answers "how far am I on everything", which is the question a
 * grid is actually good at.
 */

// ─── Achievement Card ─────────────────────────────────────────────────────────

function AchievementItem({ achievement }: { achievement: OrderedAchievement }) {
  const Colors = useTheme();
  const { GOLD, TRACE } = Colors;
  const { isUnlocked, unlockedAt, progress, icon, name, description, isGold, threshold, currentValue } = achievement;
  const hasProgress = !isUnlocked && progress > 0;

  // Uses the server's currentValue rather than back-computing it from the
  // progress fraction, so the number shown is the actual counter.
  const progressLabel = () => (threshold > 0 ? `${currentValue} / ${threshold}` : '');

  return (
    <View style={{
      backgroundColor: Colors.surface,
      borderRadius: 14, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border,
      opacity: (!isUnlocked && progress === 0) ? 0.45 : 1,
      flex: 1,
    }}>
      {/* Top accent bar */}
      {isUnlocked && (
        <View style={{
          height: 2,
          backgroundColor: isGold ? GOLD : Colors.primary,
        }} />
      )}

      <View style={{ padding: 14 }}>
        <Text style={{ fontSize: 28, marginBottom: 8 }}>{icon}</Text>

        <Text style={{
          color: Colors.textBright, fontSize: 13, fontWeight: '700',
          marginBottom: 3,
        }} numberOfLines={1}>
          {name}
        </Text>

        <Text style={{
          color: Colors.subtext, fontSize: 11, lineHeight: 15,
        }} numberOfLines={2}>
          {description}
        </Text>

        {isUnlocked && (
          <Text style={{
            color: isGold ? GOLD : TRACE,
            fontSize: 11, fontWeight: '600', marginTop: 10,
          }}>
            ✓ Earned · {fmtDate(unlockedAt)}
          </Text>
        )}

        {hasProgress && (
          <View style={{ marginTop: 10 }}>
            <View style={{
              height: 4, backgroundColor: Colors.inactive,
              borderRadius: 2, overflow: 'hidden',
            }}>
              <View style={{
                height: 4, width: `${Math.min(1, progress) * 100}%`,
                backgroundColor: Colors.primary, borderRadius: 2,
              }} />
            </View>
            {typeof threshold === 'number' && (
              <Text style={{
                color: Colors.subtext, fontSize: 10,
                marginTop: 4, fontFamily: Font.mono,
              }}>
                {progressLabel()}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Achievements Section ─────────────────────────────────────────────────────

function AchievementsSection({
  achievements,
  allUnlocked,
}: {
  achievements: OrderedAchievement[];
  allUnlocked: boolean;
}) {
  const Colors = useTheme();
  const { GOLD_DIM, GOLD } = Colors;
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel(Colors)}>Achievements</Text>

      {allUnlocked && (
        <View style={{
          backgroundColor: GOLD_DIM,
          borderRadius: 12, padding: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginBottom: 14, borderWidth: 1, borderColor: `${GOLD}33`,
        }}>
          <Text style={{ fontSize: 20 }}>🏅</Text>
          <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700' }}>
            All achievements unlocked
          </Text>
        </View>
      )}

      {/* 2-column grid */}
      <View style={{ gap: 10 }}>
        {Array.from({ length: Math.ceil(achievements.length / 2) }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row', gap: 10 }}>
            {achievements.slice(row * 2, row * 2 + 2).map(a => (
              <AchievementItem key={a.key} achievement={a} />
            ))}
            {/* Fill empty cell if odd */}
            {row * 2 + 1 >= achievements.length && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

export { AchievementItem };
export default AchievementsSection;
