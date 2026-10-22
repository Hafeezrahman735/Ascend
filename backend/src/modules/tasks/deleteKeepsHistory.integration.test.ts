import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';
import { localPartsOf } from '../../lib/localParts';

/**
 * DELETE /tasks/:id archives the task and keeps its focus history.
 *
 * It used to delete every session logged on the task and subtract that time
 * from the user's all-time totals, so one tap erased hours of real work from
 * the time tracker, the leaderboard and the profile. Deleting a habit already
 * kept its sessions; now a one-off task does too (product decision,
 * 2026-10-22).
 */

const MIN = 60;

async function createTask(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/tasks').send(body);
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

async function logSession(user: TestUser, taskId: string, minutes: number) {
  const res = await authed(user).post('/timer/complete').send({
    completedAt: Date.now(),
    localDate: localPartsOf(new Date(), 'UTC').dateKey,
    tz: 'UTC',
    actualElapsedSeconds: minutes * MIN,
    plannedDurationSeconds: minutes * MIN,
    taskId,
  });
  expect(res.status).toBe(200);
}

const totals = (user: TestUser) =>
  prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totalFocusTime: true, totalSessions: true } });

describe('DELETE /tasks/:id — focus history is kept', () => {
  it('archives the task and leaves its sessions and the all-time totals alone', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Write report', tags: ['work'] });
    await logSession(user, taskId, 25);
    await logSession(user, taskId, 20);
    const before = await totals(user);

    const res = await authed(user).delete(`/tasks/${taskId}`);

    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { taskId } })).toBe(2);
    expect(await totals(user)).toEqual(before);
    expect(before.totalFocusTime).toBe(45 * MIN);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.isArchived).toBe(true);
  });

  it('removes the task from the task list', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Gone from the list' });

    await authed(user).delete(`/tasks/${taskId}`);

    const list = await authed(user).get('/tasks');
    expect(list.body.data.map((t: { id: string }) => t.id)).not.toContain(taskId);
  });

  it('keeps the time in the time tracker, under the tag it was logged with', async () => {
    const user = await createUser();
    const taskId = await createTask(user, { title: 'Design review', tags: ['design'] });
    await logSession(user, taskId, 30);

    await authed(user).delete(`/tasks/${taskId}`);

    const today = localPartsOf(new Date(), 'UTC').dateKey;
    const res = await authed(user).get(`/time-report?from=${today}&to=${today}&tz=UTC`);
    expect(res.status).toBe(200);
    expect(res.body.data.totals.seconds).toBe(30 * MIN);
    expect(res.body.data.tags.find((t: { tag: string }) => t.tag === 'design')?.seconds).toBe(30 * MIN);
  });

  it('keeps the time on the goal the task was linked to', async () => {
    const user = await createUser();
    const goal = await authed(user).post('/task-goals').send({ title: 'Launch' });
    const goalId = goal.body.data.id as string;
    const taskId = await createTask(user, { title: 'Landing page', taskGoalId: goalId });
    await logSession(user, taskId, 25);

    await authed(user).delete(`/tasks/${taskId}`);

    const goals = await authed(user).get('/task-goals');
    const after = goals.body.data.find((g: { id: string }) => g.id === goalId);
    expect(after.totalFocusSeconds).toBe(25 * MIN);
    // The task itself no longer counts toward the goal's task tally.
    expect(after.linkedTaskCount).toBe(0);
  });

  it('404s on someone else’s task and changes nothing', async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const taskId = await createTask(owner, { title: 'Mine' });
    await logSession(owner, taskId, 25);

    const res = await authed(intruder).delete(`/tasks/${taskId}`);

    expect(res.status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).isArchived).toBe(false);
    expect(await prisma.session.count({ where: { taskId } })).toBe(1);
  });

  it('404s on a task that does not exist', async () => {
    const user = await createUser();
    const res = await authed(user).delete('/tasks/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});
