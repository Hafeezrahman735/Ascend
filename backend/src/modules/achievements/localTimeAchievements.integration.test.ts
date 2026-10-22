import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { loadAchievementCatalogue } from '../../lib/achievementCatalogue';
import { achievements } from '../../lib/achievementSeedData';
import { localPartsOf } from '../../lib/localParts';
import { handleSessionCompleted } from './handler';

/**
 * Early Bird, Night Owl, Speed Runner and Marathon run on the USER'S clock.
 *
 * They read the server's clock (getHours / setHours(0)), which is UTC on
 * Railway: a Chicago user's 7pm session counted as "before 8am", and an
 * evening's sessions were split across two "days".
 *
 * The handler runs from an event fired after the response is sent, so the
 * boundary cases call it directly and await it — a real handler against a
 * real database, with nothing left racing the assertion. The route cases
 * prove the zone actually reaches it.
 */

const MIN = 60;

async function seedCatalogue() {
  for (const a of achievements) {
    await prisma.achievement.upsert({ where: { key: a.key }, update: { ...a }, create: { ...a } });
  }
  await loadAchievementCatalogue();
}

beforeEach(seedCatalogue);

async function unlockedKeys(user: TestUser): Promise<string[]> {
  const rows = await prisma.userAchievement.findMany({
    where: { userId: user.id },
    include: { achievement: { select: { key: true } } },
  });
  return rows.map((r) => r.achievement.key);
}

/** Runs the handler for one session completed at `iso` in `timeZone`. */
async function completeAt(user: TestUser, iso: string, timeZone: string | null) {
  const completedAt = new Date(iso);
  await handleSessionCompleted({
    userId: user.id,
    sessionId: `s-${iso}`,
    type: 'focus',
    durationSeconds: 25 * MIN,
    taskLabel: null,
    taskId: null,
    completedAt: completedAt.toISOString(),
    localDate: localPartsOf(completedAt, timeZone ?? 'UTC').dateKey,
    timeZone,
  });
}

describe('Early Bird — before 08:00 local', () => {
  it('unlocks at 07:59 in Tokyo', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-20T22:59:00Z', 'Asia/Tokyo');
    expect(await unlockedKeys(user)).toContain('early-bird');
  });

  it('does not unlock at 08:00 in Tokyo', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-20T23:00:00Z', 'Asia/Tokyo');
    expect(await unlockedKeys(user)).not.toContain('early-bird');
  });

  it('does not unlock for a Chicago 7pm session (00:00 UTC) — the reported bug', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-22T00:00:00Z', 'America/Chicago');
    expect(await unlockedKeys(user)).not.toContain('early-bird');
  });

  it('unlocks at 07:30 in Chicago, which is 12:30 UTC', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-21T12:30:00Z', 'America/Chicago');
    expect(await unlockedKeys(user)).toContain('early-bird');
  });

  it('is not awarded on a guess when the client sent no zone', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-21T05:00:00Z', null);
    expect(await unlockedKeys(user)).not.toContain('early-bird');
  });
});

describe('Night Owl — 22:00 local or later', () => {
  it('unlocks at 22:00 in Honolulu', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-21T08:00:00Z', 'Pacific/Honolulu');
    expect(await unlockedKeys(user)).toContain('night-owl');
  });

  it('does not unlock at 21:59 in Honolulu', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-21T07:59:00Z', 'Pacific/Honolulu');
    expect(await unlockedKeys(user)).not.toContain('night-owl');
  });

  it('does not unlock for a Tokyo morning that is 22:00 UTC', async () => {
    const user = await createUser();
    await completeAt(user, '2026-10-20T22:30:00Z', 'Asia/Tokyo');
    expect(await unlockedKeys(user)).not.toContain('night-owl');
  });
});

describe('Speed Runner and Marathon — one LOCAL day', () => {
  /** Inserts focus sessions stamped with the given local date. */
  async function sessionsOn(user: TestUser, localDate: string, count: number, minutes: number) {
    await prisma.session.createMany({
      data: Array.from({ length: count }, () => ({
        userId: user.id,
        type: 'focus',
        durationSeconds: minutes * MIN,
        completedAt: new Date(),
        localDate,
      })),
    });
  }

  const handlerFor = (user: TestUser, localDate: string) =>
    handleSessionCompleted({
      userId: user.id,
      sessionId: 'last',
      type: 'focus',
      durationSeconds: 25 * MIN,
      taskLabel: null,
      taskId: null,
      completedAt: new Date().toISOString(),
      localDate,
      timeZone: 'America/Chicago',
    });

  it('unlocks Speed Runner on 8 sessions in one local day', async () => {
    const user = await createUser();
    await sessionsOn(user, '2026-10-21', 8, 25);
    await handlerFor(user, '2026-10-21');
    expect(await unlockedKeys(user)).toContain('speed-runner');
  });

  it('does not count sessions from a different local day toward it', async () => {
    // 4 + 4 on two local dates. On a UTC server clock a US evening could put
    // these on one "day"; on the user's calendar they are two.
    const user = await createUser();
    await sessionsOn(user, '2026-10-20', 4, 25);
    await sessionsOn(user, '2026-10-21', 4, 25);
    await handlerFor(user, '2026-10-21');
    expect(await unlockedKeys(user)).not.toContain('speed-runner');
  });

  it('unlocks Marathon on 4 hours in one local day, and not on 3h59m', async () => {
    const short = await createUser();
    await sessionsOn(short, '2026-10-21', 1, 239);
    await handlerFor(short, '2026-10-21');
    expect(await unlockedKeys(short)).not.toContain('marathon');

    const long = await createUser();
    await sessionsOn(long, '2026-10-21', 2, 120);
    await handlerFor(long, '2026-10-21');
    expect(await unlockedKeys(long)).toContain('marathon');
  });
});

describe('POST /timer/complete — the zone reaches the achievement check', () => {
  /** The most recent instant, within the last day, at hh:mm UTC. */
  function lastUtc(hh: number, mm: number): Date {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm));
    if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  async function completeViaRoute(user: TestUser, completedAt: Date, tz: string) {
    const res = await authed(user).post('/timer/complete').send({
      completedAt: completedAt.getTime(),
      localDate: localPartsOf(completedAt, tz).dateKey,
      tz,
      actualElapsedSeconds: 25 * MIN,
      plannedDurationSeconds: 25 * MIN,
    });
    expect(res.status).toBe(200);
  }

  it('unlocks Early Bird for a 07:30 Tokyo session', async () => {
    const user = await createUser();
    await completeViaRoute(user, lastUtc(22, 30), 'Asia/Tokyo');
    await vi.waitFor(async () => expect(await unlockedKeys(user)).toContain('early-bird'), { timeout: 10_000 });
  });

  it('unlocks Night Owl for a 22:15 Honolulu session', async () => {
    const user = await createUser();
    await completeViaRoute(user, lastUtc(8, 15), 'Pacific/Honolulu');
    await vi.waitFor(async () => expect(await unlockedKeys(user)).toContain('night-owl'), { timeout: 10_000 });
  });
});
