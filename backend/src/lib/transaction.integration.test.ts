import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createUser, authed, type TestUser } from '../test/factories';
import { prisma } from './prisma';
import { runInTransaction } from './transaction';
import { awardXp } from './gamification';
import { syncGoalCompletion } from './goalProgress';
import { GOAL_COMPLETION_XP } from './xp';
import { loadAchievementCatalogue } from './achievementCatalogue';
import { achievements } from './achievementSeedData';
import { eventBus, EventTypes, type FeedCreateEvent } from '../middleware/eventBus';

/**
 * The scoring helpers inside one transaction (recurring-tasks T1).
 *
 * A recurring completion will write its log row, XP, tasksCompleted and goal
 * state in a single transaction. That only works if awardXp, checkAchievements
 * and syncGoalCompletion do every read and write through the transaction's
 * client and hold their events until commit. Three things must hold:
 *
 *  1. A write earlier in the transaction is visible to the goal check, so a
 *     tick that finishes a goal completes it in the same request.
 *  2. A rollback undoes everything, achievement unlocks included, and no
 *     event escapes for work that never committed.
 *  3. Nothing reaches for the global client while the transaction holds the
 *     user's row, which would wait on that lock until the transaction timed out.
 */

/** Short, so a helper that strays onto the global client fails fast, not at 5s. */
const TX_OPTIONS = { timeout: 3000 };

async function seedCatalogue() {
  for (const a of achievements) {
    await prisma.achievement.upsert({ where: { key: a.key }, update: { ...a }, create: { ...a } });
  }
  await loadAchievementCatalogue();
}

async function createGoalWithTask(user: TestUser) {
  const goal = await authed(user).post('/task-goals').send({ title: 'Ship portfolio' });
  expect(goal.status).toBe(201);
  const task = await authed(user).post('/tasks').send({ title: 'Write case study', taskGoalId: goal.body.data.id });
  expect(task.status).toBe(200);
  return { goalId: goal.body.data.id as string, taskId: task.body.data.id as string };
}

/** Lock the user's row the way a completion transaction will. */
async function lockUser(db: Prisma.TransactionClient, userId: string) {
  await db.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

/**
 * The activity log is written by a fire-and-forget listener. Waiting for its
 * rows keeps that write from racing the next test's table clear.
 */
async function waitForActivity(userId: string, count: number) {
  await vi.waitFor(async () => {
    expect(await prisma.feedEvent.count({ where: { userId } })).toBe(count);
  });
}

class Rollback extends Error {}

let feed: FeedCreateEvent[] = [];
const recordFeed = (event: FeedCreateEvent) => feed.push(event);

beforeEach(async () => {
  await seedCatalogue();
  feed = [];
  eventBus.on(EventTypes.FEED_CREATE, recordFeed);
});

afterEach(() => {
  eventBus.off(EventTypes.FEED_CREATE, recordFeed);
});

describe('scoring helpers inside a transaction', () => {
  it('completes a goal from a write made earlier in the same transaction', async () => {
    const user = await createUser();
    const { goalId, taskId } = await createGoalWithTask(user);

    await runInTransaction(async (effects) => {
      await lockUser(effects.db, user.id);
      await effects.db.task.update({ where: { id: taskId }, data: { isCompleted: true } });
      await syncGoalCompletion(user.id, [goalId], effects);

      // Held until commit: nothing announced while the work could still roll back.
      expect(feed).toEqual([]);
    }, TX_OPTIONS);

    const goal = await prisma.taskGoal.findUniqueOrThrow({ where: { id: goalId } });
    expect(goal.isCompleted).toBe(true);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.xp).toBe(GOAL_COMPLETION_XP);

    expect(feed.map((e) => e.eventType)).toContain('goal_completed');
    await waitForActivity(user.id, feed.length);
  });

  it('rolls back XP and an achievement unlock, and emits nothing', async () => {
    const user = await createUser();

    await expect(
      runInTransaction(async (effects) => {
        await lockUser(effects.db, user.id);
        const award = await awardXp(user.id, 10, { tasksCompletedDelta: 1, effects });
        expect(award?.newlyUnlocked.map((a) => a.key)).toContain('tasks_1');
        throw new Rollback();
      }, TX_OPTIONS),
    ).rejects.toBeInstanceOf(Rollback);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.xp).toBe(0);
    expect(stored.tasksCompleted).toBe(0);
    expect(await prisma.userAchievement.count({ where: { userId: user.id } })).toBe(0);
    expect(feed).toEqual([]);
  });

  it('sees an achievement unlocked earlier in the same transaction', async () => {
    const user = await createUser();
    const tasks1 = await prisma.achievement.findUniqueOrThrow({ where: { key: 'tasks_1' } });

    await runInTransaction(async (effects) => {
      // Stands in for a concurrent request that unlocked it a moment earlier.
      await effects.db.userAchievement.create({ data: { userId: user.id, achievementId: tasks1.id } });
      const award = await awardXp(user.id, 10, { tasksCompletedDelta: 1, effects });
      expect(award?.newlyUnlocked.map((a) => a.key)).not.toContain('tasks_1');
    }, TX_OPTIONS);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.tasksCompleted).toBe(1);
    await waitForActivity(user.id, feed.length);
  });

  it('leaves callers without a transaction unchanged', async () => {
    const user = await createUser();

    const award = await awardXp(user.id, 10, { tasksCompletedDelta: 1 });

    expect(award?.newlyUnlocked.map((a) => a.key)).toContain('tasks_1');
    expect(feed.map((e) => e.eventType)).toContain('achievement_unlocked');
    await waitForActivity(user.id, feed.length);
  });
});
