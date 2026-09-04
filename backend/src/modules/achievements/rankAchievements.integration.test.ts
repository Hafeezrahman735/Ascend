import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { loadAchievementCatalogue } from '../../lib/achievementCatalogue';
import { RANK_THRESHOLDS } from '../../lib/rank';
import { achievements } from '../../lib/achievementSeedData';

/**
 * The two achievements that outlived the Level ladder.
 *
 * `level_5` and `level_10` were "Reach level 5/10". Level is gone, so rather
 * than delete them they now point at the equivalent RANK thresholds. Two things
 * have to hold, and neither is visible from reading the code:
 *
 *  1. The KEYS must not change. UserAchievement rows reference the Achievement
 *     row the seed upserts by key, so renaming would orphan every unlock people
 *     already earned — they would hold a row pointing at an achievement that no
 *     longer appears in the catalogue.
 *  2. They must stay REACHABLE, and not become trivially reachable. The old
 *     thresholds were level numbers (5, 10) compared against a level counter.
 *     Leave the thresholds at 5/10 while the counter becomes XP and every user
 *     unlocks both on their first session. Nothing errors either way — the
 *     numbers are just silently wrong, which is why this is a test and not a
 *     comment.
 *
 * The catalogue is seeded here because setup.integration.ts truncates every
 * table between tests, and it is seeded FROM lib/achievementSeedData.ts so
 * these assertions are about the real definitions rather than a copy.
 */

async function seedCatalogue() {
  for (const a of achievements) {
    await prisma.achievement.upsert({
      where: { key: a.key },
      update: { ...a },
      create: { ...a },
    });
  }
  await loadAchievementCatalogue();
}

function seedFor(key: string) {
  const found = achievements.find((a) => a.key === key);
  if (!found) throw new Error(`${key} is missing from the seed catalogue`);
  return found;
}

describe('rank achievements — seed definitions', () => {
  it('keeps the original keys, so existing unlocks are not orphaned', () => {
    expect(() => seedFor('level_5')).not.toThrow();
    expect(() => seedFor('level_10')).not.toThrow();
  });

  it('is categorised RANK with XP thresholds, not level numbers', () => {
    expect(seedFor('level_5').category).toBe('RANK');
    expect(seedFor('level_10').category).toBe('RANK');

    expect(seedFor('level_5').threshold).toBe(RANK_THRESHOLDS.Steady);
    expect(seedFor('level_10').threshold).toBe(RANK_THRESHOLDS.Champion);
  });

  it('has no achievement left on the retired LEVEL category', () => {
    expect(achievements.filter((a) => a.category === ('LEVEL' as never))).toHaveLength(0);
  });
});

describe('rank achievements — against the database', () => {
  beforeEach(async () => {
    await seedCatalogue();
  });

  it('reports progress as XP measured against the rank threshold', async () => {
    const user: TestUser = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { xp: 500 } });

    const res = await authed(user).get('/achievements');
    expect(res.status).toBe(200);

    const steady = res.body.data.find((a: { key: string }) => a.key === 'level_5');
    expect(steady.currentValue).toBe(500);
    expect(steady.threshold).toBe(RANK_THRESHOLDS.Steady);
    expect(steady.isUnlocked).toBe(false);
  });

  it('does NOT unlock for a brand new user', async () => {
    const user = await createUser();

    const res = await authed(user).get('/achievements');
    const unlockedKeys = res.body.data
      .filter((a: { isUnlocked: boolean }) => a.isUnlocked)
      .map((a: { key: string }) => a.key);

    expect(unlockedKeys).not.toContain('level_5');
    expect(unlockedKeys).not.toContain('level_10');
  });

  it('unlocks once XP reaches the rank threshold', async () => {
    const user = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { xp: RANK_THRESHOLDS.Steady } });

    const res = await authed(user).get('/achievements');
    const steady = res.body.data.find((a: { key: string }) => a.key === 'level_5');
    expect(steady.currentValue).toBeGreaterThanOrEqual(steady.threshold);
  });

  it('an unlock earned under the old Level rules survives the re-key', async () => {
    // A user who unlocked "Level Five" before this change holds a row pointing
    // at the Achievement by id. Re-pointing what that achievement MEANS must not
    // disturb it.
    const user = await createUser();
    const achievement = await prisma.achievement.findUnique({ where: { key: 'level_5' } });
    expect(achievement).not.toBeNull();

    await prisma.userAchievement.create({
      data: { userId: user.id, achievementId: achievement!.id },
    });

    const res = await authed(user).get('/achievements');
    const steady = res.body.data.find((a: { key: string }) => a.key === 'level_5');
    expect(steady.isUnlocked).toBe(true);
  });
});
