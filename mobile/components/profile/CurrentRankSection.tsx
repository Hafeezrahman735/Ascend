import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../hooks/useTheme';
import {
  RANK_ORDER, RANK_META, RANK_THRESHOLDS, getXpToNextRank, type RankTier,
} from '../../lib/rank';
import { sectionLabel, fmtXP } from './shared';
import { Font } from '../../constants/typography';

/**
 * "Current Rank" card: the tier you are on, the five-tier ladder, and what the
 * next tier costs.
 *
 * Extracted from app/(tabs)/goals.tsx, which was 1523 lines. Nothing about the
 * rendering changed in the move.
 *
 * NOTE: rank thresholds live in lib/rank.ts here and in backend/src/lib/rank.ts
 * on the server, which stamps authorRank onto every post and leaderboard row.
 * The two are kept honest by backend/src/lib/rank.drift.test.ts, which reads
 * this client's table and fails if the numbers diverge. Do not add a third copy
 * — serving the ladder from the profile payload is the eventual fix.
 */
function RankSection({
  xp,
  level,
  currentRank,
}: {
  xp: number;
  level: number;
  currentRank: RankTier;
}) {
  const Colors = useTheme();
  const { GOLD, BORDER_SOFT, GOLD_DIM } = Colors;
  const [tooltip, setTooltip] = useState<string | null>(null);
  const currentIdx = RANK_ORDER.indexOf(currentRank);
  const xpToNext = getXpToNextRank(xp);
  const nextRankIdx = currentIdx + 1;
  const nextRankTier: RankTier | null = nextRankIdx < RANK_ORDER.length ? RANK_ORDER[nextRankIdx] : null;

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
      <Text style={sectionLabel(Colors)}>Current Rank</Text>

      <View style={{
        backgroundColor: Colors.surface,
        borderRadius: 16, padding: 20,
        borderWidth: 1, borderColor: Colors.border,
        overflow: 'hidden',
      }}>
        {/* Gold glow */}
        <View style={{
          position: 'absolute', bottom: -40, right: -40,
          width: 140, height: 140, borderRadius: 70,
          backgroundColor: '#FFD70010',
        }} />

        {/* Rank name + icon */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{
              color: GOLD, fontSize: 28, fontWeight: '800', letterSpacing: 0.5,
            }}>
              {currentRank}
            </Text>
            <Text style={{ color: Colors.subtext, fontSize: 13, marginTop: 4, fontFamily: Font.mono }}>
              Level {level} · {fmtXP(xp)} XP
            </Text>
          </View>
          <Ionicons name={RANK_META[currentRank].icon} size={44} color={GOLD} />
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: BORDER_SOFT, marginVertical: 16 }} />

        {/* Tier chips */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {RANK_ORDER.map((tier, idx) => {
            const isPast    = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            return (
              <Pressable
                key={tier}
                onPress={() => setTooltip(tooltip === tier ? null : tier)}
                style={{ flex: 1, alignItems: 'center' }}
              >
                {isCurrent && (
                  <View style={{
                    backgroundColor: Colors.primary,
                    borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
                    marginBottom: 4,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 }}>
                      YOU
                    </Text>
                  </View>
                )}
                <View style={{
                  paddingVertical: 7, borderRadius: 10,
                  width: '100%', alignItems: 'center',
                  backgroundColor: isCurrent ? GOLD_DIM : Colors.raised,
                  borderWidth: 1,
                  borderColor: isCurrent ? `${GOLD}55` : Colors.border,
                  opacity: isPast ? 0.45 : 1,
                }}>
                  <Ionicons
                    name={RANK_META[tier].icon}
                    size={14}
                    color={isCurrent ? GOLD : Colors.subtext}
                  />
                  <Text style={{
                    fontSize: 9, marginTop: 3, fontWeight: '600',
                    color: isCurrent ? GOLD : Colors.subtext,
                    letterSpacing: 0.3,
                  }}>
                    {tier.slice(0, 3).toUpperCase()}
                  </Text>
                </View>

                {tooltip === tier && (
                  <View style={{
                    position: 'absolute', bottom: -36,
                    backgroundColor: Colors.raised,
                    borderWidth: 1, borderColor: Colors.border,
                    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
                    zIndex: 10, minWidth: 70, alignItems: 'center',
                  }}>
                    <Text style={{ color: Colors.text, fontSize: 10, fontFamily: Font.mono }}>
                      {fmtXP(RANK_THRESHOLDS[tier])} XP
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Next rank info */}
        {nextRankTier && (
          <View style={{
            flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'center', marginTop: 26,
          }}>
            <Text style={{ color: Colors.subtext, fontSize: 12 }}>
              Next: {nextRankTier}
            </Text>
            <Text style={{ color: Colors.text, fontSize: 12, fontFamily: Font.mono }}>
              {fmtXP(xpToNext)} XP needed
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default RankSection;
