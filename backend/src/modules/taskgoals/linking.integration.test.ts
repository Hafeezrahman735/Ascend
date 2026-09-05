import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * Linking tasks to a goal.
 *
 * The first two tests in "the links it must not touch" are REGRESSION tests for
 * a bug that never shipped, and they are the reason this endpoint takes deltas
 * rather than a replacement set.
 *
 * The obvious design — client sends the desired set, server makes it so — loses
 * data here. loadGoalCounts counts COMPLETED tasks toward a goal, so a goal
 * reading "3 of 6" has three completed tasks carrying its taskGoalId. A picker
 * of OPEN tasks never shows them, so they would be absent from the payload, so
 * replace semantics would clear them and the goal would drop from 3/6 to 0/3 on
 * its first save. Archived recurring instances inherit their template's
 * taskGoalId and would go the same way.
 *
 * Both tests fail against replace semantics and pass against deltas. That is
 * the whole point of them.
 */

async function makeGoal(user: TestUser, title = 'Ship the thing') {
  const res = await authed(user).post('/task-goals').send({ title });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function makeTask(
  user: TestUser,
  overrides: { title?: string; isCompleted?: boolean; isArchived?: boolean; taskGoalId?: string } = {},
) {
  const created = await prisma.task.create({
    data: {
      userId: user.id,
      title: overrides.title ?? 'A task',
      isCompleted: overrides.isCompleted ?? false,
      isArchived: overrides.isArchived ?? false,
      taskGoalId: overrides.taskGoalId ?? null,
      ...(overrides.isCompleted ? { completedAt: new Date() } : {}),
    },
  });
  return created.id;
}

const linkOf = async (taskId: string) =>
  (await prisma.task.findUnique({ where: { id: taskId }, select: { taskGoalId: true } }))?.taskGoalId;

describe('POST /task-goals/:id/tasks — the links it must not touch', () => {
  it('leaves a COMPLETED linked task alone when it is absent from the payload', async () => {
    // REGRESSION. This is the 3-of-6 goal: three done, three open. The client
    // sends only what its open-task picker showed.
    const user = await createUser();
    const goalId = await makeGoal(user);

    const done = await Promise.all([
      makeTask(user, { title: 'done 1', isCompleted: true, taskGoalId: goalId }),
      makeTask(user, { title: 'done 2', isCompleted: true, taskGoalId: goalId }),
    ]);
    const open = await makeTask(user, { title: 'open 1', taskGoalId: goalId });

    const res = await authed(user)
      .post(`/task-goals/${goalId}/tasks`)
      .send({ link: [open], unlink: [] });

    expect(res.status).toBe(200);
    for (const id of done) expect(await linkOf(id)).toBe(goalId);
    expect(res.body.data.linkedTaskCount).toBe(3);
    expect(res.body.data.completedTaskCount).toBe(2);
  });

  it('leaves an ARCHIVED recurring instance linked when it is absent from the payload', async () => {
    // REGRESSION. Recurring habits archive yesterday's instance every day and
    // each instance inherits the template's taskGoalId, so a habit's history is
    // a pile of archived rows no picker can show.
    const user = await createUser();
    const goalId = await makeGoal(user);

    const archived = await makeTask(user, {
      title: 'yesterday’s habit instance',
      isCompleted: true,
      isArchived: true,
      taskGoalId: goalId,
    });
    const open = await makeTask(user, { title: 'today', taskGoalId: goalId });

    await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [open] });

    expect(await linkOf(archived)).toBe(goalId);
  });

  it('cannot unlink a task that belongs to a DIFFERENT goal', async () => {
    // unlink is scoped to the goal the endpoint was called on, so a client
    // cannot reach across and sever someone else's link by id.
    const user = await createUser();
    const [goalA, goalB] = [await makeGoal(user, 'A'), await makeGoal(user, 'B')];
    const onB = await makeTask(user, { taskGoalId: goalB });

    const res = await authed(user).post(`/task-goals/${goalA}/tasks`).send({ unlink: [onB] });

    expect(res.status).toBe(200);
    expect(await linkOf(onB)).toBe(goalB);
  });
});

describe('POST /task-goals/:id/tasks — linking and unlinking', () => {
  it('links what it is given and unlinks what it is given', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    const toLink = await makeTask(user, { title: 'incoming' });
    const toDrop = await makeTask(user, { title: 'outgoing', taskGoalId: goalId });

    const res = await authed(user)
      .post(`/task-goals/${goalId}/tasks`)
      .send({ link: [toLink], unlink: [toDrop] });

    expect(res.status).toBe(200);
    expect(await linkOf(toLink)).toBe(goalId);
    expect(await linkOf(toDrop)).toBeNull();
    expect(res.body.data.linkedTaskCount).toBe(1);
  });

  it('treats empty arrays, and a missing body, as a no-op', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    const existing = await makeTask(user, { taskGoalId: goalId });

    const empty = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [], unlink: [] });
    const bare = await authed(user).post(`/task-goals/${goalId}/tasks`).send({});

    expect(empty.status).toBe(200);
    expect(bare.status).toBe(200);
    expect(await linkOf(existing)).toBe(goalId);
  });

  it('moves a task that already belongs to another goal, and recomputes both', async () => {
    // Task.taskGoalId holds one goal, so linking steals. The goal it left has
    // to be recomputed: losing an unfinished task can push it to 100%.
    const user = await createUser();
    const [from, to] = [await makeGoal(user, 'From'), await makeGoal(user, 'To')];
    await makeTask(user, { title: 'already done', isCompleted: true, taskGoalId: from });
    const moving = await makeTask(user, { title: 'the one that moves', taskGoalId: from });

    await authed(user).post(`/task-goals/${to}/tasks`).send({ link: [moving] });

    expect(await linkOf(moving)).toBe(to);

    // "From" is now 1 of 1 — it completed by losing its only open task.
    const fromGoal = await prisma.taskGoal.findUnique({ where: { id: from } });
    expect(fromGoal?.isCompleted).toBe(true);
  });

  it('completes the goal when the task linked in is already done', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    const done = await makeTask(user, { isCompleted: true });

    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [done] });

    expect(res.body.data.overallProgress).toBe(1);
    const goal = await prisma.taskGoal.findUnique({ where: { id: goalId } });
    expect(goal?.isCompleted).toBe(true);
  });
});

describe('POST /task-goals/:id/tasks — rejections', () => {
  it('rejects an id that is in both link and unlink', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);
    const task = await makeTask(user);

    const res = await authed(user)
      .post(`/task-goals/${goalId}/tasks`)
      .send({ link: [task], unlink: [task] });

    expect(res.status).toBe(400);
    expect(await linkOf(task)).toBeNull();
  });

  it('rejects the whole request when one task belongs to someone else, writing nothing', async () => {
    const [user, stranger] = [await createUser(), await createUser()];
    const goalId = await makeGoal(user);
    const mine = await makeTask(user, { title: 'mine' });
    const theirs = await makeTask(stranger, { title: 'theirs' });

    const res = await authed(user)
      .post(`/task-goals/${goalId}/tasks`)
      .send({ link: [mine, theirs] });

    expect(res.status).toBe(404);
    // All-or-nothing: the legitimate id must not have been written either.
    expect(await linkOf(mine)).toBeNull();
    expect(await linkOf(theirs)).toBeNull();
  });

  it('404s on a goal belonging to someone else', async () => {
    const [user, stranger] = [await createUser(), await createUser()];
    const theirGoal = await makeGoal(stranger);
    const mine = await makeTask(user);

    const res = await authed(user).post(`/task-goals/${theirGoal}/tasks`).send({ link: [mine] });

    expect(res.status).toBe(404);
    expect(await linkOf(mine)).toBeNull();
  });
});

describe('POST /task-goals — creating with tasks is atomic', () => {
  it('creates the goal and links the tasks in one call', async () => {
    const user = await createUser();
    const ids = await Promise.all([makeTask(user), makeTask(user), makeTask(user)]);

    const res = await authed(user).post('/task-goals').send({ title: 'Thesis', taskIds: ids });

    expect(res.status).toBe(201);
    expect(res.body.data.linkedTaskCount).toBe(3);
    for (const id of ids) expect(await linkOf(id)).toBe(res.body.data.id);
  });

  it('creates NO goal when one of the taskIds belongs to someone else', async () => {
    // The reason creation is one request: a create-then-attach flow would have
    // left a goal behind with none of the tasks the user picked.
    const [user, stranger] = [await createUser(), await createUser()];
    const mine = await makeTask(user);
    const theirs = await makeTask(stranger);

    const res = await authed(user)
      .post('/task-goals')
      .send({ title: 'Doomed', taskIds: [mine, theirs] });

    expect(res.status).toBe(404);
    expect(await prisma.taskGoal.count({ where: { userId: user.id } })).toBe(0);
    expect(await linkOf(mine)).toBeNull();
  });

  it('completes on creation when every task linked in is already done', async () => {
    const user = await createUser();
    const done = await makeTask(user, { isCompleted: true });

    const res = await authed(user).post('/task-goals').send({ title: 'Already there', taskIds: [done] });

    expect(res.body.data.overallProgress).toBe(1);
    const goal = await prisma.taskGoal.findUnique({ where: { id: res.body.data.id } });
    expect(goal?.isCompleted).toBe(true);
  });
});

describe('the retired session fields are accepted, never rejected', () => {
  /**
   * This app cannot force-update its clients. An older binary on someone's
   * phone keeps sending targetSessions forever, and a 400 would leave that
   * person permanently unable to save a goal. The fields are stored and ignored.
   */
  it('accepts targetSessions on create and ignores it for progress', async () => {
    const user = await createUser();

    const res = await authed(user)
      .post('/task-goals')
      .send({ title: 'From an old build', targetSessions: 20, progressMode: 'both' });

    expect(res.status).toBe(201);
    expect(res.body.data.progressMode).toBe('tasks');
    expect(res.body.data.sessionProgress).toBeNull();
    expect(res.body.data.overallProgress).toBe(0);
  });

  it('accepts targetSessions on update', async () => {
    const user = await createUser();
    const goalId = await makeGoal(user);

    const res = await authed(user)
      .patch(`/task-goals/${goalId}`)
      .send({ targetSessions: 12, progressMode: 'sessions' });

    expect(res.status).toBe(200);
    expect(res.body.data.progressMode).toBe('tasks');
  });

  it('a goal with a session target is measured on its tasks alone', async () => {
    // The old blend would have put this at (1.0 + 0/20) / 2 = 0.5.
    const user = await createUser();
    const create = await authed(user)
      .post('/task-goals')
      .send({ title: 'Old shape', targetSessions: 20 });
    const goalId = create.body.data.id;

    const done = await makeTask(user, { isCompleted: true });
    const res = await authed(user).post(`/task-goals/${goalId}/tasks`).send({ link: [done] });

    expect(res.body.data.overallProgress).toBe(1);
  });
});
